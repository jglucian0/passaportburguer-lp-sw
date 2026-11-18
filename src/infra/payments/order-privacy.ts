import { eq } from "drizzle-orm";

import { db } from "@/infra/db";
import { customers, orderItems, orders } from "@/infra/db/schema";

/** O que o acesso por token (sem login) pode ver: nada de CPF, e-mail, telefone ou número da casa. */
export type MaskedOrderSummary = {
  firstName: string;
  items: { name: string; quantity: number }[];
  totalCents: number;
  /** "Rua - Bairro" (sem número/complemento). Vazio na retirada. */
  addressSummary: string | null;
};

type OrderLike = {
  totalCents: number;
  deliveryType: string;
  addressSnapshot: { street: string; neighborhood?: string | null; district?: string | null } | null;
};

export function maskOrderSummary(input: {
  customerName: string;
  items: { productNameSnapshot: string; quantity: number }[];
  order: OrderLike;
}): MaskedOrderSummary {
  const { order } = input;
  const snap = order.deliveryType === "DELIVERY" ? order.addressSnapshot : null;
  const area = snap?.district ?? snap?.neighborhood ?? null;
  return {
    firstName: input.customerName.trim().split(/\s+/)[0] ?? "",
    items: input.items.map((i) => ({ name: i.productNameSnapshot, quantity: i.quantity })),
    totalCents: order.totalCents,
    addressSummary: snap ? [snap.street, area].filter(Boolean).join(" - ") : null,
  };
}

export async function loadMaskedOrderSummary(orderId: string): Promise<MaskedOrderSummary | null> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;
  const [customer] = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, order.customerId)).limit(1);
  const items = await db
    .select({ productNameSnapshot: orderItems.productNameSnapshot, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  return maskOrderSummary({ customerName: customer?.name ?? "", items, order });
}
