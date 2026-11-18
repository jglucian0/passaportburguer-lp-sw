import { and, desc, eq, gte, inArray, notInArray, or } from "drizzle-orm";

import type { DeliveryType, OrderStatus, PaymentMethod } from "@/core/schemas/common";

import { expireAbandonedOrders } from "@/infra/payments/expire-orders";

import { db } from "./index";
import {
  customers,
  orderItems,
  orders,
  type AddressSnapshot,
  type OrderItemAddonSnapshot,
} from "./schema";

export type AdminOrderItemView = {
  productId: string | null;
  name: string;
  quantity: number;
  totalItemCents: number;
  addons: OrderItemAddonSnapshot[];
};

export type AdminOrderView = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  deliveryType: DeliveryType;
  paymentMethod: PaymentMethod;
  changeForCents: number | null;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  notes: string | null;
  documentNumber: string | null;
  cancelReason: string | null;
  addressSnapshot: AddressSnapshot | null;
  latitude: number | null;
  longitude: number | null;
  customerName: string;
  customerPhone: string;
  createdAt: string;
  updatedAt: string;
  items: AdminOrderItemView[];
};

/** Brasil não tem horário de verão desde 2019: America/Sao_Paulo = UTC-3 fixo. */
const STORE_UTC_OFFSET_MS = -3 * 60 * 60 * 1000;

/** Início do dia corrente (00:00) no fuso da loja, como instante UTC. */
export function startOfStoreDay(now: Date = new Date()): Date {
  const local = new Date(now.getTime() + STORE_UTC_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - STORE_UTC_OFFSET_MS);
}

/** Pedidos em andamento + concluídos/cancelados hoje (para o KDS e o endpoint de polling). */
export async function loadAdminOrders(tenantId: string): Promise<AdminOrderView[]> {
  const since = startOfStoreDay();

  /* Limpeza oportunista: pedidos online sem pagamento há mais de 30 min são cancelados. */
  await expireAbandonedOrders({ tenantId }).catch(() => undefined);

  const rows = await db
    .select({
      order: orders,
      customerName: customers.name,
      customerPhone: customers.phone,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(
      and(
        eq(orders.tenantId, tenantId),
        or(notInArray(orders.status, ["DELIVERED", "CANCELED"]), gte(orders.updatedAt, since)),
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(300);

  if (rows.length === 0) return [];

  const itemRows = await db
    .select()
    .from(orderItems)
    .where(
      and(
        eq(orderItems.tenantId, tenantId),
        inArray(
          orderItems.orderId,
          rows.map((r) => r.order.id),
        ),
      ),
    );

  const itemsByOrder = new Map<string, AdminOrderItemView[]>();
  for (const item of itemRows) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push({
      productId: item.productId,
      name: item.productNameSnapshot,
      quantity: item.quantity,
      totalItemCents: item.totalItemCents,
      addons: item.addonsSnapshot,
    });
    itemsByOrder.set(item.orderId, list);
  }

  return rows.map(({ order: o, customerName, customerPhone }) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    deliveryType: o.deliveryType,
    paymentMethod: o.paymentMethod,
    changeForCents: o.changeForCents,
    subtotalCents: o.subtotalCents,
    deliveryFeeCents: o.deliveryFeeCents,
    totalCents: o.totalCents,
    notes: o.notes,
    documentNumber: o.documentNumber,
    cancelReason: o.cancelReason,
    addressSnapshot: o.addressSnapshot,
    latitude: o.addressSnapshot?.latitude ?? null,
    longitude: o.addressSnapshot?.longitude ?? null,
    customerName,
    customerPhone,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    items: itemsByOrder.get(o.id) ?? [],
  }));
}
