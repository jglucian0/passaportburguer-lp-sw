import { eq, inArray } from "drizzle-orm";

import { milesEarnedLine } from "@/infra/miles/miles";
import { db } from "@/infra/db";
import {
  customers,
  orders,
  whatsappMessages,
  whatsappSessions,
} from "@/infra/db/schema";

import { sendCtaUrlButton, sendTextMessage } from "./client";
import { signWhatsAppToken } from "./session-token";
import { getBrazilianPhoneVariants } from "./phone";
import { formatCents } from "@/lib/utils";

import { appUrl } from "./shared";
import { errorSummary } from "./log";

/** A Meta só aceita texto livre até 24h depois da última mensagem do cliente. */
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
export const REGISTRATION_TOKEN_MINUTES = 1440;

/**
 * Pedido "do WhatsApp" = o cliente do pedido tem sessão de conversa ativa.
 * O número de envio é o da própria sessão (como a Meta o entregou, com ou sem o 9º dígito).
 */
async function findChat(orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;
  const [customer] = await db.select().from(customers).where(eq(customers.id, order.customerId)).limit(1);
  if (!customer) return null;

  // customers.phone pode estar com/sem 9º dígito e a sessão guarda o wa_id da Meta: casa pelas variações.
  const candidates = getBrazilianPhoneVariants(customer.phone).filter((v) => v.startsWith("55"));
  if (candidates.length === 0) return null;
  const [session] = await db
    .select()
    .from(whatsappSessions)
    .where(inArray(whatsappSessions.phone, candidates))
    .limit(1);
  if (!session) return null;
  if (Date.now() - session.lastInteractionAt.getTime() > SESSION_WINDOW_MS) return null;
  return { order, customer, session };
}

/** Envio único por (pedido, tipo): o registro com wamid `notif:*` é ao mesmo tempo o histórico e a trava. */
async function claimNotification(phone: string, key: string, content: string): Promise<boolean> {
  const claimed = await db
    .insert(whatsappMessages)
    .values({ wamid: key, phone, role: "assistant", content, mediaType: "text" })
    .onConflictDoNothing({ target: whatsappMessages.wamid })
    .returning({ id: whatsappMessages.id });
  return claimed.length > 0;
}

const orderLabel = (n: number) => `#${n}`;

/** Pagamento aprovado: confirma no WhatsApp e, se o cadastro está incompleto, oferece completá-lo. */
export async function notifyPaymentConfirmed(orderId: string): Promise<void> {
  try {
    const chat = await findChat(orderId);
    if (!chat) return;
    const { order, customer, session } = chat;

    const text =
      order.deliveryType === "DELIVERY"
        ? `Pagamento confirmado! ✅ Seu pedido ${orderLabel(order.orderNumber)} já está na chapa no Passaporte Burguer. Avisaremos quando sair para entrega!`
        : `Pagamento confirmado! ✅ Seu pedido ${orderLabel(order.orderNumber)} já está na chapa no Passaporte Burguer. Avisaremos quando estiver pronto para retirada!`;

    const milesLine = await milesEarnedLine(orderId);
    const key = `notif:${orderId}:paid`;
    if (!(await claimNotification(session.phone, key, text + milesLine))) return; // já enviada
    try {
      await sendTextMessage(session.phone, text + milesLine);
    } catch (error) {
      await db.delete(whatsappMessages).where(eq(whatsappMessages.wamid, key)).catch(() => undefined);
      throw error;
    }

    await db
      .update(whatsappSessions)
      .set({ state: "COMPLETED", updatedAt: new Date() })
      .where(eq(whatsappSessions.phone, session.phone))
      .catch(() => undefined);

    /* Cadastro pós-pagamento (sem OTP: o telefone já foi provado pela conversa). */
    // Já tem CPF: o cadastro está resolvido (o endereço é salvo no próprio pedido), não convida de novo.
    if (customer.documentNumber) return;

    const token = signWhatsAppToken(
      { phone: session.phone, orderId, purpose: "COMPLETE_REGISTRATION" },
      REGISTRATION_TOKEN_MINUTES,
    );
    const url = `${appUrl()}/completar-cadastro?token=${encodeURIComponent(token)}`;
    await sendCtaUrlButton(
      session.phone,
      "Quer salvar seu endereço e CPF para pedir com 1 clique na próxima vez? Leva 15 segundos (sem precisar confirmar código):",
      "Completar cadastro",
      url,
    );
  } catch (error) {
    // Notificação nunca derruba a liquidação do pagamento.
    console.error("[whatsapp-notify] falha (pagamento):", errorSummary(error));
  }
}

/** Pedido com pagamento na entrega/retirada (Cardápio Rápido): confirma no WhatsApp que a cozinha já recebeu. */
export async function notifyOfflineOrderPlaced(orderId: string): Promise<void> {
  try {
    const chat = await findChat(orderId);
    if (!chat) return;
    const { order, session } = chat;

    const delivery = order.deliveryType === "DELIVERY";
    const payLabel =
      order.paymentMethod === "CASH"
        ? order.changeForCents
          ? `dinheiro (troco para ${formatCents(order.changeForCents)})`
          : "dinheiro (sem troco)"
        : "cartão na máquina";
    const status =
      order.status === "PREPARING"
        ? "já está na chapa"
        : "foi recebido e vai para a chapa assim que a cozinha confirmar";
    const text = `Pedido ${orderLabel(order.orderNumber)} confirmado! ✅ Seu pedido ${status} no Passaporte Burguer. Pagamento na ${delivery ? "entrega" : "retirada"}: ${payLabel}. Total ${formatCents(order.totalCents)}. Avisaremos quando ${delivery ? "sair para entrega" : "estiver pronto para retirada"}!`;

    const key = `notif:${orderId}:placed`;
    if (!(await claimNotification(session.phone, key, text))) return;
    try {
      await sendTextMessage(session.phone, text);
    } catch (error) {
      await db.delete(whatsappMessages).where(eq(whatsappMessages.wamid, key)).catch(() => undefined);
      throw error;
    }
    await db
      .update(whatsappSessions)
      .set({ state: "COMPLETED", updatedAt: new Date() })
      .where(eq(whatsappSessions.phone, session.phone))
      .catch(() => undefined);
  } catch (error) {
    console.error("[whatsapp-notify] falha (pedido offline):", errorSummary(error));
  }
}

/** Pedido de retirada / consumo no local ficou pronto (painel, KDS ou Saipos). */
export async function notifyReadyForPickup(orderId: string): Promise<void> {
  try {
    const chat = await findChat(orderId);
    if (!chat || chat.order.deliveryType !== "PICKUP" || chat.order.status !== "READY_FOR_PICKUP") return;
    const text = `Seu pedido ${orderLabel(chat.order.orderNumber)} está pronto! 🍔 Pode vir retirar no balcão do Passaporte Burguer.`;
    const key = `notif:${orderId}:ready`;
    if (!(await claimNotification(chat.session.phone, key, text))) return;
    try {
      await sendTextMessage(chat.session.phone, text);
    } catch (error) {
      await db.delete(whatsappMessages).where(eq(whatsappMessages.wamid, key)).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    console.error("[whatsapp-notify] falha (pronto para retirada):", errorSummary(error));
  }
}

/** Pedido saiu para entrega (painel ou Saipos). */
export async function notifyOutForDelivery(orderId: string): Promise<void> {
  try {
    const chat = await findChat(orderId);
    if (!chat || chat.order.deliveryType !== "DELIVERY" || chat.order.status !== "OUT_FOR_DELIVERY") return;
    const text = `Seu pedido ${orderLabel(chat.order.orderNumber)} saiu para entrega! 🛵 Já já chega aí.`;
    const key = `notif:${orderId}:out`;
    if (!(await claimNotification(chat.session.phone, key, text))) return;
    try {
      await sendTextMessage(chat.session.phone, text);
    } catch (error) {
      await db.delete(whatsappMessages).where(eq(whatsappMessages.wamid, key)).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    console.error("[whatsapp-notify] falha (entrega):", errorSummary(error));
  }
}
