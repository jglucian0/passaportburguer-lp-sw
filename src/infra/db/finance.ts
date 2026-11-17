import { and, count, eq, gte, lt, sql, sum } from "drizzle-orm";

import type { PaymentMethod } from "@/core/schemas/common";

import { startOfStoreDay } from "./admin-orders";
import { db } from "./index";
import { orderItems, orders } from "./schema";

export type FinancePeriod = "today" | "7d" | "month";

export const FINANCE_PERIOD_LABELS: Record<FinancePeriod, string> = {
  today: "Hoje",
  "7d": "Últimos 7 dias",
  month: "Este mês",
};

export function parseFinancePeriod(value: string | undefined): FinancePeriod {
  return value === "7d" || value === "month" ? value : "today";
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STORE_UTC_OFFSET_MS = -3 * 60 * 60 * 1000; // America/Sao_Paulo (sem horário de verão)

function periodStart(period: FinancePeriod, now: Date): Date {
  const today = startOfStoreDay(now);
  if (period === "today") return today;
  if (period === "7d") return new Date(today.getTime() - 6 * DAY_MS);
  const local = new Date(today.getTime() + STORE_UTC_OFFSET_MS);
  local.setUTCDate(1);
  return new Date(local.getTime() - STORE_UTC_OFFSET_MS);
}

/** Janela anterior equivalente: ontem / 7 dias anteriores / mês anterior (mesmo nº de dias decorridos). */
function previousWindow(period: FinancePeriod, from: Date, now: Date): { from: Date; to: Date } {
  const elapsed = now.getTime() - from.getTime();
  if (period === "month") {
    const local = new Date(from.getTime() + STORE_UTC_OFFSET_MS);
    local.setUTCMonth(local.getUTCMonth() - 1);
    const prevFrom = new Date(local.getTime() - STORE_UTC_OFFSET_MS);
    return { from: prevFrom, to: new Date(Math.min(prevFrom.getTime() + elapsed, from.getTime())) };
  }
  const length = period === "today" ? DAY_MS : 7 * DAY_MS;
  const prevFrom = new Date(from.getTime() - length);
  return { from: prevFrom, to: new Date(Math.min(prevFrom.getTime() + elapsed, from.getTime())) };
}

export type PeriodTotals = {
  revenueCents: number;
  completedOrders: number;
  averageTicketCents: number;
  canceledOrders: number;
};

export type PaymentRow = { method: PaymentMethod; orders: number; revenueCents: number };
export type TopProduct = { name: string; quantity: number; revenueCents: number };

export type FinanceReport = {
  period: FinancePeriod;
  from: string;
  revenueCents: number;
  completedOrders: number;
  averageTicketCents: number;
  canceledOrders: number;
  previous: PeriodTotals;
  byPayment: PaymentRow[];
  topProducts: TopProduct[];
};

/** Métricas do período (pedidos criados no intervalo). Faturamento = pedidos ENTREGUES. */
export async function loadFinanceReport(tenantId: string, period: FinancePeriod): Promise<FinanceReport> {
  const now = new Date();
  const from = periodStart(period, now);
  const inPeriod = and(eq(orders.tenantId, tenantId), gte(orders.createdAt, from), lt(orders.createdAt, now));
  const delivered = and(inPeriod, eq(orders.status, "DELIVERED"));

  const prev = previousWindow(period, from, now);
  const inPrev = and(eq(orders.tenantId, tenantId), gte(orders.createdAt, prev.from), lt(orders.createdAt, prev.to));

  const [totals, canceled, payments, top, prevTotals, prevCanceled] = await Promise.all([
    db
      .select({ revenue: sum(orders.totalCents), n: count() })
      .from(orders)
      .where(delivered),
    db.select({ n: count() }).from(orders).where(and(inPeriod, eq(orders.status, "CANCELED"))),
    db
      .select({ method: orders.paymentMethod, n: count(), revenue: sum(orders.totalCents) })
      .from(orders)
      .where(delivered)
      .groupBy(orders.paymentMethod),
    db
      .select({
        name: orderItems.productNameSnapshot,
        quantity: sql<number>`sum(${orderItems.quantity})`.mapWith(Number),
        revenue: sum(orderItems.totalItemCents),
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(delivered)
      .groupBy(orderItems.productNameSnapshot)
      .orderBy(sql`sum(${orderItems.quantity}) desc`, sql`sum(${orderItems.totalItemCents}) desc`)
      .limit(5),
    db
      .select({ revenue: sum(orders.totalCents), n: count() })
      .from(orders)
      .where(and(inPrev, eq(orders.status, "DELIVERED"))),
    db.select({ n: count() }).from(orders).where(and(inPrev, eq(orders.status, "CANCELED"))),
  ]);

  const prevRevenue = Number(prevTotals[0]?.revenue ?? 0);
  const prevCompleted = prevTotals[0]?.n ?? 0;

  const revenueCents = Number(totals[0]?.revenue ?? 0);
  const completedOrders = totals[0]?.n ?? 0;

  return {
    period,
    from: from.toISOString(),
    revenueCents,
    completedOrders,
    averageTicketCents: completedOrders > 0 ? Math.round(revenueCents / completedOrders) : 0,
    canceledOrders: canceled[0]?.n ?? 0,
    previous: {
      revenueCents: prevRevenue,
      completedOrders: prevCompleted,
      averageTicketCents: prevCompleted > 0 ? Math.round(prevRevenue / prevCompleted) : 0,
      canceledOrders: prevCanceled[0]?.n ?? 0,
    },
    byPayment: payments.map((p) => ({ method: p.method, orders: p.n, revenueCents: Number(p.revenue ?? 0) })),
    topProducts: top.map((t) => ({ name: t.name, quantity: t.quantity, revenueCents: Number(t.revenue ?? 0) })),
  };
}
