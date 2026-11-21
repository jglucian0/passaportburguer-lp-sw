import { and, eq, gte, notInArray, sql } from "drizzle-orm";

import { db } from "@/infra/db";
import { funnelEvents, orderItems, orders, products } from "@/infra/db/schema";

const DAY_MS = 24 * 60 * 60 * 1000;

export type FunnelReport = {
  days: number;
  /** Visitantes distintos em cada etapa (início do funil = visita ao cardápio). */
  visitors: number;
  viewedProduct: number;
  addedToCart: number;
  reachedCheckout: number;
  /** Pedidos feitos pelo site (válidos: sem cancelados nem aguardando pagamento). */
  siteOrders: number;
  /** Pedidos de todos os canais (site + WhatsApp). */
  allOrders: number;
  products: {
    name: string;
    views: number;
    carts: number;
    units: number;
    revenueCents: number;
  }[];
  /** Produtos disponíveis sem nenhuma venda no período. */
  unsold: string[];
};

const VALID = ["CANCELED", "AWAITING_PAYMENT"] as const;

export async function getFunnelReport(tenantId: string, days = 30): Promise<FunnelReport> {
  const since = new Date(Date.now() - days * DAY_MS);

  const stages = await db
    .select({ event: funnelEvents.event, visitors: sql<number>`count(distinct ${funnelEvents.visitorId})::int` })
    .from(funnelEvents)
    .where(and(eq(funnelEvents.tenantId, tenantId), gte(funnelEvents.createdAt, since)))
    .groupBy(funnelEvents.event);
  const stage = (e: string) => stages.find((s) => s.event === e)?.visitors ?? 0;

  const [counts] = await db
    .select({
      all: sql<number>`count(*)::int`,
      site: sql<number>`(count(*) filter (where ${orders.attribution}->>'channel' = 'site'))::int`,
    })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), gte(orders.createdAt, since), notInArray(orders.status, [...VALID])));

  const perProductEvents = await db
    .select({
      productId: funnelEvents.productId,
      event: funnelEvents.event,
      visitors: sql<number>`count(distinct ${funnelEvents.visitorId})::int`,
    })
    .from(funnelEvents)
    .where(and(eq(funnelEvents.tenantId, tenantId), gte(funnelEvents.createdAt, since), sql`${funnelEvents.productId} is not null`))
    .groupBy(funnelEvents.productId, funnelEvents.event);

  const sold = await db
    .select({
      productId: orderItems.productId,
      units: sql<number>`sum(${orderItems.quantity})::int`,
      revenue: sql<number>`sum(${orderItems.quantity} * ${orderItems.unitPriceCentsSnapshot})::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.tenantId, tenantId), gte(orders.createdAt, since), notInArray(orders.status, [...VALID])))
    .groupBy(orderItems.productId);

  const catalog = await db
    .select({ id: products.id, name: products.name, isAvailable: products.isAvailable })
    .from(products)
    .where(eq(products.tenantId, tenantId));

  const rows = catalog.map((p) => {
    const ev = perProductEvents.filter((e) => e.productId === p.id);
    const s = sold.find((x) => x.productId === p.id);
    return {
      name: p.name,
      available: p.isAvailable,
      views: ev.find((e) => e.event === "VIEW_PRODUCT")?.visitors ?? 0,
      carts: ev.find((e) => e.event === "ADD_TO_CART")?.visitors ?? 0,
      units: s?.units ?? 0,
      revenueCents: s?.revenue ?? 0,
    };
  });

  return {
    days,
    visitors: stage("VISIT"),
    viewedProduct: stage("VIEW_PRODUCT"),
    addedToCart: stage("ADD_TO_CART"),
    reachedCheckout: stage("CHECKOUT"),
    siteOrders: counts?.site ?? 0,
    allOrders: counts?.all ?? 0,
    products: rows
      .filter((r) => r.views > 0 || r.carts > 0 || r.units > 0)
      .sort((a, b) => b.units - a.units || b.views - a.views)
      .slice(0, 20)
      .map(({ available: _a, ...r }) => r),
    unsold: rows.filter((r) => r.available && r.units === 0).map((r) => r.name),
  };
}
