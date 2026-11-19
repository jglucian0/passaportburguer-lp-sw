import { and, eq, ne, sql } from "drizzle-orm";
import { after } from "next/server";

import { consumeOrderCoupon } from "@/infra/coupons";
import { creditOrderMiles } from "@/infra/miles/miles";
import { db } from "@/infra/db";
import { orders, payments } from "@/infra/db/schema";
import { loadStoreSettings } from "@/infra/db/store-settings";
import { recordTimelineEvent } from "@/infra/db/timeline";
import { notifyPaymentConfirmed } from "@/infra/whatsapp/notifications";
import { sendOrderToSaipos } from "@/lib/saipos";
import { formatCents } from "@/lib/utils";

type BatchItem = Parameters<typeof db.batch>[0][number];

/**
 * Liquida um pagamento aprovado e libera o pedido para a cozinha, de forma idempotente.
 * Usada pela resposta síncrona do cartão e pelo webhook: quem chegar primeiro libera
 * (AWAITING_PAYMENT -> RECEIVED/PREPARING) e dispara o Saipos; o segundo só atualiza o
 * registro financeiro (o UPDATE do pedido não casa e nada é duplicado).
 * `extra` entra no mesmo lote atômico (ex.: vínculo do evento do webhook).
 */
export async function settlePayment(opts: {
  paymentId: string;
  orderId: string;
  tenantId: string;
  paidCents: number;
  status: "CONFIRMED" | "RECEIVED";
  extra?: BatchItem[];
}): Promise<{ released: boolean }> {
  const settings = await loadStoreSettings(opts.tenantId);
  const target = settings?.autoAcceptOrders ? "PREPARING" : "RECEIVED";

  const batch = [
    db
      .update(payments)
      .set({ status: opts.status, paidAt: sql`coalesce(${payments.paidAt}, now())` })
      // Um CONFIRMED atrasado nunca rebaixa um RECEIVED já gravado.
      .where(and(eq(payments.id, opts.paymentId), ne(payments.status, "RECEIVED"))),
    db
      .update(orders)
      .set({ status: target, updatedAt: new Date() })
      .where(
        and(
          eq(orders.id, opts.orderId),
          eq(orders.status, "AWAITING_PAYMENT"),
          eq(orders.totalCents, opts.paidCents),
        ),
      )
      .returning({ id: orders.id }),
    ...(opts.extra ?? []),
  ] as unknown as Parameters<typeof db.batch>[0];

  const results = (await db.batch(batch)) as unknown as unknown[];
  const released = ((results[1] as unknown[] | undefined)?.length ?? 0) > 0;
  if (released) {
    await recordTimelineEvent({
      orderId: opts.orderId,
      type: "PAYMENT_CONFIRMED",
      title: "Pagamento confirmado",
      description: `Pagamento online de ${formatCents(opts.paidCents)} confirmado.`,
      metadata: { paidCents: opts.paidCents, status: opts.status },
      dedupeKey: `${opts.orderId}:payment-confirmed`,
    });
    // Pagamento validado: o cupom do pedido é consumido (idempotente).
    await consumeOrderCoupon(opts.orderId).catch((error) =>
      console.error("[coupons] falha ao consumir cupom:", error instanceof Error ? error.message : "erro"),
    );
    // Pagamento validado: credita as milhas do pedido (idempotente; programa desligado = nada).
    await creditOrderMiles(opts.orderId).catch((error) =>
      console.error("[miles] falha ao creditar milhas:", error instanceof Error ? error.message : "erro"),
    );
    // Um único after(): Saipos e aviso no WhatsApp (só quem liberou o pedido avisa; o aviso também é idempotente).
    after(async () => {
      await Promise.allSettled([sendOrderToSaipos(opts.orderId), notifyPaymentConfirmed(opts.orderId)]);
    });
  }
  return { released };
}
