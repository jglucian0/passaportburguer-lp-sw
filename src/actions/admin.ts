"use server";

import { and, desc, eq, gte, inArray, notInArray, or } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { z } from "zod";

import {
  advanceOrderSchema,
  cancelOrderSchema,
  deliveryZoneInputSchema,
  setManuallyClosedSchema,
  storeSettingsSchema,
} from "@/core/schemas/admin";
import type { DeliveryType, OrderStatus, PaymentMethod } from "@/core/schemas/common";
import {
  addonGroupInputSchema,
  addonInputSchema,
  categoryInputSchema,
  productInputSchema,
  toggleAvailabilitySchema,
  type CatalogDeliveryZone,
} from "@/core/schemas/product";
import { uuidSchema } from "@/core/schemas/common";
import { canCancel, getNextStatus } from "@/core/orders/state-machine";
import { getAdminSession, type AdminSession } from "@/infra/auth/session";
import { db } from "@/infra/db";
import {
  loadCatalog,
  loadDeliveryZones,
  type CatalogCategoryWithStatus,
} from "@/infra/db/queries";
import {
  addonGroups,
  addons,
  categories,
  customers,
  deliveryZones,
  orderItems,
  orders,
  products,
  tenants,
  type AddressSnapshot,
  type OpeningHours,
  type OrderItemAddonSnapshot,
} from "@/infra/db/schema";

import { failure, fromZod, success, type ActionResult } from "./result";

/* ------------------------------------------------------------------ */
/* Infra interna                                                       */
/* ------------------------------------------------------------------ */

const idInputSchema = z.object({ id: uuidSchema });

async function guard<T>(fn: (session: AdminSession) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const session = await getAdminSession();
  if (!session) return failure("Sessão expirada. Faça login novamente.");
  return fn(session);
}

async function requireSession(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

function revalidateMenu() {
  revalidateTag("menu");
}

/* ------------------------------------------------------------------ */
/* Leituras do painel                                                  */
/* ------------------------------------------------------------------ */

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
  cancelReason: string | null;
  addressSnapshot: AddressSnapshot | null;
  customerName: string;
  customerPhone: string;
  createdAt: string;
  updatedAt: string;
  items: AdminOrderItemView[];
};

/** Pedidos em andamento + finalizados/cancelados nas últimas 24h. */
export async function getAdminOrders(): Promise<AdminOrderView[]> {
  const session = await requireSession();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

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
        eq(orders.tenantId, session.tenantId),
        or(notInArray(orders.status, ["DELIVERED", "CANCELED"]), gte(orders.updatedAt, since)),
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(200);

  if (rows.length === 0) return [];

  const itemRows = await db
    .select()
    .from(orderItems)
    .where(
      and(
        eq(orderItems.tenantId, session.tenantId),
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
    cancelReason: o.cancelReason,
    addressSnapshot: o.addressSnapshot,
    customerName,
    customerPhone,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    items: itemsByOrder.get(o.id) ?? [],
  }));
}

export async function getAdminMenu(): Promise<CatalogCategoryWithStatus[]> {
  const session = await requireSession();
  return loadCatalog(session.tenantId, { includeInactiveCategories: true });
}

export async function getAdminDeliveryZones(): Promise<CatalogDeliveryZone[]> {
  const session = await requireSession();
  return loadDeliveryZones(session.tenantId, { includeInactive: true });
}

export type AdminStoreSettings = {
  name: string;
  slug: string;
  phoneWhatsapp: string | null;
  logoUrl: string | null;
  primaryColor: string;
  minOrderCents: number;
  isManuallyClosed: boolean;
  openingHours: OpeningHours;
};

export async function getAdminStoreSettings(): Promise<AdminStoreSettings | null> {
  const session = await requireSession();
  const [tenant] = await db
    .select({
      name: tenants.name,
      slug: tenants.slug,
      phoneWhatsapp: tenants.phoneWhatsapp,
      logoUrl: tenants.logoUrl,
      primaryColor: tenants.primaryColor,
      minOrderCents: tenants.minOrderCents,
      isManuallyClosed: tenants.isManuallyClosed,
      openingHours: tenants.openingHours,
    })
    .from(tenants)
    .where(eq(tenants.id, session.tenantId))
    .limit(1);
  return tenant ?? null;
}

/* ------------------------------------------------------------------ */
/* Pedidos                                                             */
/* ------------------------------------------------------------------ */

export async function advanceOrder(input: unknown): Promise<ActionResult<{ status: OrderStatus }>> {
  return guard(async (session) => {
    const parsed = advanceOrderSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const [order] = await db
      .select({ id: orders.id, status: orders.status, deliveryType: orders.deliveryType })
      .from(orders)
      .where(and(eq(orders.id, parsed.data.orderId), eq(orders.tenantId, session.tenantId)))
      .limit(1);

    if (!order) return failure("Pedido não encontrado.");

    const next = getNextStatus(order.status, order.deliveryType);
    if (!next) return failure("Este pedido já foi finalizado.");

    // Atualização condicional ao status lido: evita corrida entre dois operadores.
    const updated = await db
      .update(orders)
      .set({ status: next, updatedAt: new Date() })
      .where(
        and(
          eq(orders.id, order.id),
          eq(orders.tenantId, session.tenantId),
          eq(orders.status, order.status),
        ),
      )
      .returning({ id: orders.id });

    if (updated.length === 0) return failure("O pedido foi alterado por outra pessoa. Atualize a tela.");

    return success({ status: next });
  });
}

export async function cancelOrder(input: unknown): Promise<ActionResult<{ status: OrderStatus }>> {
  return guard(async (session) => {
    const parsed = cancelOrderSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const [order] = await db
      .select({ id: orders.id, status: orders.status, deliveryType: orders.deliveryType })
      .from(orders)
      .where(and(eq(orders.id, parsed.data.orderId), eq(orders.tenantId, session.tenantId)))
      .limit(1);

    if (!order) return failure("Pedido não encontrado.");
    if (!canCancel(order.status, order.deliveryType)) {
      return failure("Este pedido não pode mais ser cancelado.");
    }

    const updated = await db
      .update(orders)
      .set({ status: "CANCELED", cancelReason: parsed.data.reason, updatedAt: new Date() })
      .where(
        and(
          eq(orders.id, order.id),
          eq(orders.tenantId, session.tenantId),
          eq(orders.status, order.status),
        ),
      )
      .returning({ id: orders.id });

    if (updated.length === 0) return failure("O pedido foi alterado por outra pessoa. Atualize a tela.");

    return success({ status: "CANCELED" as const });
  });
}

/* ------------------------------------------------------------------ */
/* Cardápio: categorias                                                */
/* ------------------------------------------------------------------ */

export async function saveCategory(input: unknown): Promise<ActionResult<{ id: string }>> {
  return guard(async (session) => {
    const parsed = categoryInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const { id, ...values } = parsed.data;

    if (id) {
      const updated = await db
        .update(categories)
        .set(values)
        .where(and(eq(categories.id, id), eq(categories.tenantId, session.tenantId)))
        .returning({ id: categories.id });
      if (updated.length === 0) return failure("Categoria não encontrada.");
      revalidateMenu();
      return success({ id });
    }

    const [row] = await db
      .insert(categories)
      .values({ tenantId: session.tenantId, ...values })
      .returning({ id: categories.id });
    revalidateMenu();
    return success({ id: row.id });
  });
}

export async function deleteCategory(input: unknown): Promise<ActionResult> {
  return guard(async (session) => {
    const parsed = idInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const deleted = await db
      .delete(categories)
      .where(and(eq(categories.id, parsed.data.id), eq(categories.tenantId, session.tenantId)))
      .returning({ id: categories.id });
    if (deleted.length === 0) return failure("Categoria não encontrada.");
    revalidateMenu();
    return success(null);
  });
}

/* ------------------------------------------------------------------ */
/* Cardápio: produtos                                                  */
/* ------------------------------------------------------------------ */

export async function saveProduct(input: unknown): Promise<ActionResult<{ id: string }>> {
  return guard(async (session) => {
    const parsed = productInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const { id, ...values } = parsed.data;

    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, values.categoryId), eq(categories.tenantId, session.tenantId)))
      .limit(1);
    if (!category) return failure("Categoria inválida.");

    if (id) {
      const updated = await db
        .update(products)
        .set(values)
        .where(and(eq(products.id, id), eq(products.tenantId, session.tenantId)))
        .returning({ id: products.id });
      if (updated.length === 0) return failure("Produto não encontrado.");
      revalidateMenu();
      return success({ id });
    }

    const [row] = await db
      .insert(products)
      .values({ tenantId: session.tenantId, ...values })
      .returning({ id: products.id });
    revalidateMenu();
    return success({ id: row.id });
  });
}

export async function deleteProduct(input: unknown): Promise<ActionResult> {
  return guard(async (session) => {
    const parsed = idInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const deleted = await db
      .delete(products)
      .where(and(eq(products.id, parsed.data.id), eq(products.tenantId, session.tenantId)))
      .returning({ id: products.id });
    if (deleted.length === 0) return failure("Produto não encontrado.");
    revalidateMenu();
    return success(null);
  });
}

/** Pausa rápida de produto. */
export async function toggleProductAvailability(input: unknown): Promise<ActionResult> {
  return guard(async (session) => {
    const parsed = toggleAvailabilitySchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const updated = await db
      .update(products)
      .set({ isAvailable: parsed.data.isAvailable })
      .where(and(eq(products.id, parsed.data.id), eq(products.tenantId, session.tenantId)))
      .returning({ id: products.id });
    if (updated.length === 0) return failure("Produto não encontrado.");
    revalidateMenu();
    return success(null);
  });
}

/* ------------------------------------------------------------------ */
/* Cardápio: grupos de adicionais e adicionais                         */
/* ------------------------------------------------------------------ */

export async function saveAddonGroup(input: unknown): Promise<ActionResult<{ id: string }>> {
  return guard(async (session) => {
    const parsed = addonGroupInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const { id, ...values } = parsed.data;

    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, values.productId), eq(products.tenantId, session.tenantId)))
      .limit(1);
    if (!product) return failure("Produto inválido.");

    if (id) {
      const updated = await db
        .update(addonGroups)
        .set(values)
        .where(and(eq(addonGroups.id, id), eq(addonGroups.tenantId, session.tenantId)))
        .returning({ id: addonGroups.id });
      if (updated.length === 0) return failure("Grupo não encontrado.");
      revalidateMenu();
      return success({ id });
    }

    const [row] = await db
      .insert(addonGroups)
      .values({ tenantId: session.tenantId, ...values })
      .returning({ id: addonGroups.id });
    revalidateMenu();
    return success({ id: row.id });
  });
}

export async function deleteAddonGroup(input: unknown): Promise<ActionResult> {
  return guard(async (session) => {
    const parsed = idInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const deleted = await db
      .delete(addonGroups)
      .where(and(eq(addonGroups.id, parsed.data.id), eq(addonGroups.tenantId, session.tenantId)))
      .returning({ id: addonGroups.id });
    if (deleted.length === 0) return failure("Grupo não encontrado.");
    revalidateMenu();
    return success(null);
  });
}

export async function saveAddon(input: unknown): Promise<ActionResult<{ id: string }>> {
  return guard(async (session) => {
    const parsed = addonInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const { id, ...values } = parsed.data;

    const [group] = await db
      .select({ id: addonGroups.id })
      .from(addonGroups)
      .where(and(eq(addonGroups.id, values.addonGroupId), eq(addonGroups.tenantId, session.tenantId)))
      .limit(1);
    if (!group) return failure("Grupo inválido.");

    if (id) {
      const updated = await db
        .update(addons)
        .set(values)
        .where(and(eq(addons.id, id), eq(addons.tenantId, session.tenantId)))
        .returning({ id: addons.id });
      if (updated.length === 0) return failure("Adicional não encontrado.");
      revalidateMenu();
      return success({ id });
    }

    const [row] = await db
      .insert(addons)
      .values({ tenantId: session.tenantId, ...values })
      .returning({ id: addons.id });
    revalidateMenu();
    return success({ id: row.id });
  });
}

export async function deleteAddon(input: unknown): Promise<ActionResult> {
  return guard(async (session) => {
    const parsed = idInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const deleted = await db
      .delete(addons)
      .where(and(eq(addons.id, parsed.data.id), eq(addons.tenantId, session.tenantId)))
      .returning({ id: addons.id });
    if (deleted.length === 0) return failure("Adicional não encontrado.");
    revalidateMenu();
    return success(null);
  });
}

/** Pausa rápida de adicional. */
export async function toggleAddonAvailability(input: unknown): Promise<ActionResult> {
  return guard(async (session) => {
    const parsed = toggleAvailabilitySchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const updated = await db
      .update(addons)
      .set({ isAvailable: parsed.data.isAvailable })
      .where(and(eq(addons.id, parsed.data.id), eq(addons.tenantId, session.tenantId)))
      .returning({ id: addons.id });
    if (updated.length === 0) return failure("Adicional não encontrado.");
    revalidateMenu();
    return success(null);
  });
}

/* ------------------------------------------------------------------ */
/* Bairros e taxas                                                     */
/* ------------------------------------------------------------------ */

export async function saveDeliveryZone(input: unknown): Promise<ActionResult<{ id: string }>> {
  return guard(async (session) => {
    const parsed = deliveryZoneInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const { id, ...values } = parsed.data;

    if (id) {
      const updated = await db
        .update(deliveryZones)
        .set(values)
        .where(and(eq(deliveryZones.id, id), eq(deliveryZones.tenantId, session.tenantId)))
        .returning({ id: deliveryZones.id });
      if (updated.length === 0) return failure("Bairro não encontrado.");
      revalidateMenu();
      return success({ id });
    }

    const [row] = await db
      .insert(deliveryZones)
      .values({ tenantId: session.tenantId, ...values })
      .returning({ id: deliveryZones.id });
    revalidateMenu();
    return success({ id: row.id });
  });
}

export async function deleteDeliveryZone(input: unknown): Promise<ActionResult> {
  return guard(async (session) => {
    const parsed = idInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const deleted = await db
      .delete(deliveryZones)
      .where(and(eq(deliveryZones.id, parsed.data.id), eq(deliveryZones.tenantId, session.tenantId)))
      .returning({ id: deliveryZones.id });
    if (deleted.length === 0) return failure("Bairro não encontrado.");
    revalidateMenu();
    return success(null);
  });
}

/* ------------------------------------------------------------------ */
/* Configurações da loja                                               */
/* ------------------------------------------------------------------ */

/** Somente OWNER. O WhatsApp é gravado com DDI 55 (ex: (44) 99833-3450). */
export async function saveStoreSettings(input: unknown): Promise<ActionResult> {
  return guard(async (session) => {
    if (session.role !== "OWNER") return failure("Apenas o proprietário pode alterar as configurações.");

    const parsed = storeSettingsSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const data = parsed.data;

    for (const day of Object.values(data.openingHours)) {
      if (day.enabled && day.open === day.close) {
        return failure("Abertura e fechamento não podem ser o mesmo horário.");
      }
    }

    await db
      .update(tenants)
      .set({
        name: data.name,
        phoneWhatsapp: data.phoneWhatsapp ? `55${data.phoneWhatsapp}` : null,
        logoUrl: data.logoUrl ?? null,
        primaryColor: data.primaryColor,
        minOrderCents: data.minOrderCents,
        openingHours: data.openingHours,
      })
      .where(eq(tenants.id, session.tenantId));

    revalidateMenu();
    return success(null);
  });
}

/** Botão "Fechar Loja Agora" / "Reabrir". */
export async function setStoreManuallyClosed(input: unknown): Promise<ActionResult> {
  return guard(async (session) => {
    const parsed = setManuallyClosedSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    await db
      .update(tenants)
      .set({ isManuallyClosed: parsed.data.isManuallyClosed })
      .where(eq(tenants.id, session.tenantId));

    revalidateMenu();
    return success(null);
  });
}
