import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/infra/db";
import { customers, orders } from "@/infra/db/schema";
import { recordTimelineEvent } from "@/infra/db/timeline";
import { cancelPendingCharges } from "@/infra/payments/asaas";

import { resetSession } from "./draft-flow";
import { requestHumanHandoff } from "./handoff";
import { getBrazilianPhoneVariants } from "./phone";
import { getTenantId } from "./shared";

/** Já pagos / em produção: cancelar exige uma pessoa (estorno, cozinha, entregador). */
const HANDOFF_STATUSES = ["RECEIVED", "PREPARING", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP"];

export type CancelUnpaidResult =
  | { ok: true; canceled: true; orderNumber: number }
  | { ok: false; handoff: true; error: string }
  | { ok: false; error: string };

/**
 * Cancela o pedido mais recente do cliente se ele ainda aguarda pagamento: pedido CANCELED, cobrança
 * removida no Asaas e sessão zerada. NÃO pausa o bot. Pedido já pago/em preparo/entrega => handoff humano.
 */
export async function cancelUnpaidOrderTool(input: { phone: string; reason: string }): Promise<CancelUnpaidResult> {
  const reason = input.reason.trim().slice(0, 200) || "Cancelado a pedido do cliente";

  const tenantId = await getTenantId();
  const variants = getBrazilianPhoneVariants(input.phone);
  if (!tenantId || variants.length === 0) return { ok: false, error: "Não encontrei pedido para cancelar." };

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), inArray(customers.phone, variants)))
    .limit(1);
  if (!customer) return { ok: false, error: "Não encontrei pedido para cancelar." };

  const [order] = await db
    .select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.customerId, customer.id)))
    .orderBy(desc(orders.createdAt))
    .limit(1);
  if (!order) return { ok: false, error: "Não encontrei pedido para cancelar." };

  if (HANDOFF_STATUSES.includes(order.status)) {
    await requestHumanHandoff(input.phone, `Cliente quer cancelar o pedido #${order.orderNumber} (${order.status}): ${reason}`);
    return {
      ok: false,
      handoff: true,
      error: `O pedido #${order.orderNumber} já foi pago/está em andamento: um atendente vai assumir o cancelamento.`,
    };
  }
  if (order.status !== "AWAITING_PAYMENT") {
    return { ok: false, error: "Não há pedido aguardando pagamento para cancelar." };
  }

  // A cobrança é removida no Asaas ANTES: se acabou de ser paga, o pedido não pode ser cancelado.
  const { blocked } = await cancelPendingCharges(order.id);
  if (blocked === "PAID") {
    await requestHumanHandoff(input.phone, `Pedido #${order.orderNumber} foi pago e o cliente pediu cancelamento: ${reason}`);
    return { ok: false, handoff: true, error: `O pedido #${order.orderNumber} já foi pago: um atendente vai assumir.` };
  }
  if (blocked) {
    return { ok: false, error: "Não consegui confirmar a cobrança agora. Tente novamente em instantes." };
  }

  const canceled = await db
    .update(orders)
    .set({ status: "CANCELED", cancelReason: `Cancelado pelo cliente no WhatsApp: ${reason}`, updatedAt: new Date() })
    .where(and(eq(orders.id, order.id), eq(orders.status, "AWAITING_PAYMENT")))
    .returning({ id: orders.id });
  if (canceled.length === 0) return { ok: false, error: "O pedido mudou de status. Tente novamente." };

  await recordTimelineEvent({
    orderId: order.id,
    type: "ORDER_CANCELED",
    title: "Pedido cancelado",
    description: `Cancelado pelo cliente no WhatsApp antes do pagamento. Motivo: ${reason}`,
    dedupeKey: `${order.id}:canceled`,
  });

  await resetSession(input.phone);
  return { ok: true, canceled: true, orderNumber: order.orderNumber };
}
