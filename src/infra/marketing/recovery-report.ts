import { and, eq, gte, inArray, like, notInArray, sql } from "drizzle-orm";

import { db } from "@/infra/db";
import { marketingSends, orders, whatsappFollowups, whatsappMessages } from "@/infra/db/schema";

const DAY_MS = 24 * 60 * 60 * 1000;

export type RecoveryReport = {
  days: number;
  /** Convites a quem puxou conversa e não pediu (texto livre). */
  chatInvites: number;
  /** Lembretes de PIX/cartão pendente e quantos acabaram pagos. */
  paymentReminders: number;
  paymentRecovered: number;
  paymentRecoveredCents: number;
  /** Campanha de resgate (cupom pessoal): enviados e pedidos que usaram o cupom. */
  winbackSent: number;
  winbackOrders: number;
  winbackCents: number;
};

/** Resultado da recuperação nos últimos `days` dias (tudo medido por pedidos reais, sem estimativa). */
export async function getRecoveryReport(tenantId: string, days = 30): Promise<RecoveryReport> {
  const since = new Date(Date.now() - days * DAY_MS);

  const [chat] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(whatsappFollowups)
    .where(
      and(
        eq(whatsappFollowups.kind, "ABANDONED_CHAT"),
        eq(whatsappFollowups.status, "SENT"),
        gte(whatsappFollowups.sentAt, since),
      ),
    );

  const reminders = await db
    .select({ wamid: whatsappMessages.wamid })
    .from(whatsappMessages)
    .where(and(like(whatsappMessages.wamid, "recovery-pay:%"), gte(whatsappMessages.createdAt, since)));
  const orderIds = reminders.map((r) => (r.wamid ?? "").slice("recovery-pay:".length)).filter(Boolean);
  const recovered = orderIds.length
    ? await db
        .select({ total: orders.totalCents })
        .from(orders)
        .where(
          and(
            eq(orders.tenantId, tenantId),
            inArray(orders.id, orderIds),
            notInArray(orders.status, ["AWAITING_PAYMENT", "CANCELED"]),
          ),
        )
    : [];

  const sends = await db
    .select({ couponId: marketingSends.couponId })
    .from(marketingSends)
    .where(
      and(eq(marketingSends.tenantId, tenantId), eq(marketingSends.status, "SENT"), gte(marketingSends.createdAt, since)),
    );
  const couponIds = sends.map((s) => s.couponId).filter((id): id is string => !!id);
  const winbackOrders = couponIds.length
    ? await db
        .select({ total: orders.totalCents })
        .from(orders)
        .where(
          and(
            eq(orders.tenantId, tenantId),
            inArray(orders.couponId, couponIds),
            notInArray(orders.status, ["AWAITING_PAYMENT", "CANCELED"]),
          ),
        )
    : [];

  return {
    days,
    chatInvites: chat?.n ?? 0,
    paymentReminders: orderIds.length,
    paymentRecovered: recovered.length,
    paymentRecoveredCents: recovered.reduce((s, r) => s + r.total, 0),
    winbackSent: sends.length,
    winbackOrders: winbackOrders.length,
    winbackCents: winbackOrders.reduce((s, r) => s + r.total, 0),
  };
}
