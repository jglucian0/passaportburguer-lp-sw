import { and, eq, inArray, lt, notExists, sql } from "drizzle-orm";

import { db } from "@/infra/db";
import { orders, payments } from "@/infra/db/schema";

import { cancelPendingCharges } from "./asaas";

export const ABANDONED_ORDER_MINUTES = 30;

/**
 * Cancela pedidos online (PIX/cartão) que seguem em AWAITING_PAYMENT há mais de 30 minutos.
 *
 * Antes de cancelar, as cobranças pendentes são removidas no Asaas (o cliente não consegue
 * pagar um pedido cancelado). Se alguma cobrança não puder ser removida (ex.: acabou de ser paga),
 * o pedido NÃO é cancelado: o webhook decide.
 */
export async function expireAbandonedOrders(
  opts: { tenantId?: string; orderId?: string; olderThanMinutes?: number } = {},
): Promise<number> {
  const cutoff = new Date(Date.now() - (opts.olderThanMinutes ?? ABANDONED_ORDER_MINUTES) * 60_000);

  const conditions = [
    eq(orders.status, "AWAITING_PAYMENT"),
    inArray(orders.paymentMethod, ["PIX", "CREDIT_CARD"]),
    lt(orders.createdAt, cutoff),
    ...(opts.tenantId ? [eq(orders.tenantId, opts.tenantId)] : []),
    ...(opts.orderId ? [eq(orders.id, opts.orderId)] : []),
  ];

  const candidates = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(...conditions))
    .limit(100);
  if (candidates.length === 0) return 0;

  for (const { id } of candidates) {
    try {
      await cancelPendingCharges(id);
    } catch {
      /* mantém PENDING: o NOT EXISTS abaixo impede o cancelamento */
    }
  }

  const canceled = await db
    .update(orders)
    .set({
      status: "CANCELED",
      cancelReason: "Pagamento não confirmado em 30 minutos.",
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(
          orders.id,
          candidates.map((c) => c.id),
        ),
        eq(orders.status, "AWAITING_PAYMENT"),
        notExists(
          db
            .select({ one: sql`1` })
            .from(payments)
            .where(and(eq(payments.orderId, orders.id), inArray(payments.status, ["PENDING", "RISK_ANALYSIS"]))),
        ),
      ),
    )
    .returning({ id: orders.id });

  return canceled.length;
}
