import { and, eq, gte, inArray, lte } from "drizzle-orm";

import { db } from "@/infra/db";
import { customers, orders, whatsappMessages, whatsappSessions } from "@/infra/db/schema";
import { ABANDONED_ORDER_MINUTES } from "@/infra/payments/expire-orders";
import { sendCtaUrlButton } from "@/infra/whatsapp/client";
import { errorSummary } from "@/infra/whatsapp/log";
import { getBrazilianPhoneVariants } from "@/infra/whatsapp/phone";
import { checkoutUrl, getTenantId } from "@/infra/whatsapp/shared";

const MIN = 60_000;
/** O pedido já esperou pelo menos isto antes do lembrete (o cliente pode estar pagando agora). */
const REMIND_AFTER_MINUTES = 12;
const WINDOW_MS = 24 * 60 * MIN;
const MAX_PER_RUN = 20;

export function paymentReminderMessage(firstName: string | null, orderNumber: number, minutesLeft: number): string {
  const name = firstName ? ` ${firstName}` : "";
  return `Oi${name}! Seu pedido #${orderNumber} está reservado, falta só o pagamento 😉 Ele fica guardado por mais ${minutesLeft} min. É só tocar no botão abaixo para finalizar.`;
}

/**
 * Pedido online (PIX/cartão) sem pagamento há alguns minutos e ainda dentro do prazo de expiração: lembra o cliente
 * no WhatsApp com o link de pagamento. Só vale dentro das 24 h da última mensagem do cliente (texto livre, sem template).
 * Um lembrete por pedido (trava `recovery-pay:{pedido}`); respeita opt-out e atendimento humano.
 */
export async function runPaymentRecovery(now: Date = new Date()): Promise<{ sent: number; skipped: number }> {
  const tenantId = await getTenantId();
  if (!tenantId) return { sent: 0, skipped: 0 };

  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerId: orders.customerId,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, tenantId),
        eq(orders.status, "AWAITING_PAYMENT"),
        lte(orders.createdAt, new Date(now.getTime() - REMIND_AFTER_MINUTES * MIN)),
        gte(orders.createdAt, new Date(now.getTime() - (ABANDONED_ORDER_MINUTES - 3) * MIN)),
      ),
    )
    .limit(MAX_PER_RUN);

  let sent = 0;
  let skipped = 0;
  for (const order of rows) {
    try {
      const [customer] = await db.select().from(customers).where(eq(customers.id, order.customerId)).limit(1);
      if (!customer) continue;
      const candidates = getBrazilianPhoneVariants(customer.phone).filter((v) => v.startsWith("55"));
      const [session] = candidates.length
        ? await db.select().from(whatsappSessions).where(inArray(whatsappSessions.phone, candidates)).limit(1)
        : [];
      const insideWindow = !!session && now.getTime() - session.lastInteractionAt.getTime() <= WINDOW_MS;
      const paused = !!session?.botPausedUntil && session.botPausedUntil.getTime() > now.getTime();
      if (!session || !insideWindow || paused || session.marketingOptOutAt) {
        skipped++;
        continue;
      }

      const minutesLeft = Math.max(1, ABANDONED_ORDER_MINUTES - Math.floor((now.getTime() - order.createdAt.getTime()) / MIN));
      const text = paymentReminderMessage(customer.name.trim().split(/\s+/)[0] || null, order.orderNumber, minutesLeft);
      const key = `recovery-pay:${order.id}`;
      const claimed = await db
        .insert(whatsappMessages)
        .values({ wamid: key, phone: session.phone, role: "assistant", content: text, mediaType: "text" })
        .onConflictDoNothing({ target: whatsappMessages.wamid })
        .returning({ id: whatsappMessages.id });
      if (claimed.length === 0) continue; // já lembrado

      try {
        await sendCtaUrlButton(session.phone, text, "Pagar agora", checkoutUrl(order.id, session.phone));
        sent++;
      } catch (error) {
        await db.delete(whatsappMessages).where(eq(whatsappMessages.wamid, key)).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      console.error("[marketing] lembrete de pagamento falhou:", errorSummary(error));
    }
  }
  return { sent, skipped };
}
