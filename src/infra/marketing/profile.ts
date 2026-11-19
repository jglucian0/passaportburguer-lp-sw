import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import {
  averageIntervalDays,
  classifyCustomer,
  DEFAULT_SEGMENT_RULES,
  pickFavorite,
  type CustomerProfile,
  type SegmentRules,
} from "@/core/marketing/segments";
import { db } from "@/infra/db";
import { customers, orderItems, orders } from "@/infra/db/schema";

/** Pedidos que contam para o perfil: cancelado e "aguardando pagamento" não são pedidos de verdade. */
const EXCLUDED_STATUSES = ["CANCELED", "AWAITING_PAYMENT"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Perfil de clientes do tenant: pedidos, lanche favorito, intervalo habitual, segmento e se é fã.
 * `customerIds` limita a consulta (ex.: um cliente só); sem ele, devolve todos os clientes.
 */
export async function loadCustomerProfiles(
  tenantId: string,
  opts: { customerIds?: string[]; now?: Date; rules?: SegmentRules } = {},
): Promise<CustomerProfile[]> {
  const now = opts.now ?? new Date();
  const rules = opts.rules ?? DEFAULT_SEGMENT_RULES;
  const windowStart = new Date(now.getTime() - rules.fanWindowDays * DAY_MS);
  if (opts.customerIds && opts.customerIds.length === 0) return [];
  const scoped = opts.customerIds ?? null;

  const customerRows = await db
    .select({ id: customers.id, name: customers.name, phone: customers.phone })
    .from(customers)
    .where(scoped ? and(eq(customers.tenantId, tenantId), inArray(customers.id, scoped)) : eq(customers.tenantId, tenantId));

  const validOrder = and(
    eq(orders.tenantId, tenantId),
    notInArray(orders.status, [...EXCLUDED_STATUSES]),
    ...(scoped ? [inArray(orders.customerId, scoped)] : []),
  );

  const [statRows, itemRows] = await Promise.all([
    db
      .select({
        customerId: orders.customerId,
        orderCount: sql<number>`count(*)::int`,
        firstOrderAt: sql<string>`min(${orders.createdAt})`,
        lastOrderAt: sql<string>`max(${orders.createdAt})`,
        recentOrderCount: sql<number>`(count(*) filter (where ${orders.createdAt} >= ${windowStart.toISOString()}::timestamptz))::int`,
      })
      .from(orders)
      .where(validOrder)
      .groupBy(orders.customerId),
    db
      .select({
        customerId: orders.customerId,
        productId: orderItems.productId,
        name: orderItems.productNameSnapshot,
        quantity: sql<number>`sum(${orderItems.quantity})::int`,
        lastOrderedAt: sql<string>`max(${orders.createdAt})`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(validOrder)
      .groupBy(orders.customerId, orderItems.productId, orderItems.productNameSnapshot),
  ]);

  const stats = new Map(statRows.map((r) => [r.customerId, r]));
  const itemsByCustomer = new Map<string, typeof itemRows>();
  for (const r of itemRows) {
    const list = itemsByCustomer.get(r.customerId) ?? [];
    list.push(r);
    itemsByCustomer.set(r.customerId, list);
  }

  return customerRows.map((c) => {
    const s = stats.get(c.id);
    const base = {
      orderCount: s?.orderCount ?? 0,
      firstOrderAt: s ? new Date(s.firstOrderAt) : null,
      lastOrderAt: s ? new Date(s.lastOrderAt) : null,
      recentOrderCount: s?.recentOrderCount ?? 0,
    };
    const verdict = classifyCustomer(base, now, rules);
    return {
      ...base,
      customerId: c.id,
      firstName: c.name.trim().split(/\s+/)[0] ?? c.name,
      phone: c.phone,
      favorite: pickFavorite(
        (itemsByCustomer.get(c.id) ?? []).map((i) => ({ ...i, lastOrderedAt: new Date(i.lastOrderedAt) })),
      ),
      avgIntervalDays: averageIntervalDays(base),
      daysSinceLastOrder: verdict.daysSinceLastOrder,
      segment: verdict.segment,
      isFan: verdict.isFan,
    };
  });
}
