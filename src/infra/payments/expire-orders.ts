import { and, eq, inArray, lt, notExists, sql } from "drizzle-orm";

import { db } from "@/infra/db";
import { orders, payments } from "@/infra/db/schema";
import { recordTimelineEvent } from "@/infra/db/timeline";

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
  opts: { tenantId?: string; orderId?: string; customerId?: string; olderThanMinutes?: number } = {},
): Promise<number> {
  const cutoff = new Date(Date.now() - (opts.olderThanMinutes ?? ABANDONED_ORDER_MINUTES) * 60_000);

  const conditions = [
    eq(orders.status, "AWAITING_PAYMENT"),
    inArray(orders.paymentMethod, ["PIX", "CREDIT_CARD"]),
    lt(orders.createdAt, cutoff),
    ...(opts.tenantId ? [eq(orders.tenantId, opts.tenantId)] : []),
    ...(opts.orderId ? [eq(orders.id, opts.orderId)] : []),
    ...(opts.customerId ? [eq(orders.customerId, opts.customerId)] : []),
  ];

  const candidates = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(...conditions))
    .limit(100);
  if (candidates.length === 0) return 0;

  /* Só expira o que comprovadamente não tem cobrança viva: o Asaas é consultado/cancelado antes.
     Pago no Asaas => o pedido é liberado (settlePayment) e NÃO é cancelado. */
  const expirable: string[] = [];
  for (const { id } of candidates) {
    try {
      const { blocked } = await cancelPendingCharges(id);
      if (!blocked) expirable.push(id);
    } catch {
      /* falha inesperada: não cancela este pedido agora */
    }
  }
  if (expirable.length === 0) return 0;

  const canceled = await db
    .update(orders)
    .set({
      status: "CANCELED",
      cancelReason: "Pagamento não confirmado em 30 minutos.",
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(orders.id, expirable),
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

  // Aparece na linha do tempo do pedido (e no histórico do cliente).
  for (const { id } of canceled) {
    await recordTimelineEvent({
      orderId: id,
      type: "ORDER_CANCELED",
      title: "Pedido cancelado",
      description: "Cancelado automaticamente: pagamento não confirmado em 30 minutos.",
      dedupeKey: `${id}:canceled`,
    }).catch(() => undefined);
  }

  return canceled.length;
}
