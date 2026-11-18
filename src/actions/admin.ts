"use server";

import bcrypt from "bcryptjs";
import { and, asc, desc, eq, max } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { sendOrderToSaipos } from "@/lib/saipos";

import {
  advanceOrderSchema,
  cancelOrderSchema,
  couponInputSchema,
  deliveryRulesSchema,
  deliveryZoneInputSchema,
  manualOrderSchema,
  quickEditProductSchema,
  setCouponActiveSchema,
  setOpenOverrideSchema,
  setTeamMemberActiveSchema,
  storeSettingsSchema,
  teamMemberInputSchema,
} from "@/core/schemas/admin";
import type { OrderStatus } from "@/core/schemas/common";
import {
  addonGroupInputSchema,
  addonInputSchema,
  categoryInputSchema,
  productInputSchema,
  toggleAvailabilitySchema,
  type CatalogDeliveryZone,
} from "@/core/schemas/product";
import { isOnlinePaymentMethod, uuidSchema } from "@/core/schemas/common";
import { cancelPendingCharges } from "@/infra/payments/asaas";
import { calculateCart } from "@/core/cart/calculate-cart";
import { canCancel, getNextStatus } from "@/core/orders/state-machine";
import { getStoreStatus, type StoreStatusReason } from "@/core/store/opening-hours";
import { getActiveAdminSession as getAdminSession } from "@/infra/auth/active-session";
import type { AdminSession } from "@/infra/auth/session";
import { db } from "@/infra/db";
import {
  loadCatalog,
  loadDeliveryZones,
  type CatalogCategoryWithStatus,
} from "@/infra/db/queries";
import { loadStoreSettings } from "@/infra/db/store-settings";
import {
  addonGroups,
  addons,
  adminUsers,
  categories,
  coupons,
  customers,
  deliveryZones,
  orderItems,
  orders,
  paymentEvents,
  products,
  storeSettings,
  tenants,
  type AdminRole,
  type DeliveryRules,
  type OpeningHours,
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

/** Ações de catálogo/configuração: somente o proprietário (a cozinha opera pedidos). */
async function guardOwner<T>(fn: (session: AdminSession) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const session = await getAdminSession();
  if (!session) return failure("Sessão expirada. Faça login novamente.");
  if (session.role !== "OWNER") return failure("Sem permissão para esta ação.");
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
  address: string | null;
  logoUrl: string | null;
  primaryColor: string;
  minOrderCents: number;
  autoAcceptOrders: boolean;
  estimatedDeliveryMinutes: number;
  openingHours: OpeningHours;
};

export type AdminStoreStatus = {
  isOpen: boolean;
  reason: StoreStatusReason;
  /** Há um override manual ativo (aberta/fechada à força)? */
  hasOverride: boolean;
};

/** Status efetivo da loja, para o switch do cabeçalho. */
export async function getAdminStoreStatus(): Promise<AdminStoreStatus | null> {
  const session = await getAdminSession();
  if (!session) return null;
  const settings = await loadStoreSettings(session.tenantId);
  if (!settings) return null;
  const status = getStoreStatus({
    openingHours: settings.openingHours,
    isOpenOverride: settings.isOpenOverride,
  });
  return { ...status, hasOverride: settings.isOpenOverride !== null };
}

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
    })
    .from(tenants)
    .where(eq(tenants.id, session.tenantId))
    .limit(1);
  if (!tenant) return null;
  const settings = await loadStoreSettings(session.tenantId);
  if (!settings) return null;
  return {
    ...tenant,
    address: settings.address,
    autoAcceptOrders: settings.autoAcceptOrders,
    estimatedDeliveryMinutes: settings.estimatedDeliveryMinutes,
    openingHours: settings.openingHours,
  };
}

/* ------------------------------------------------------------------ */
/* Pedidos                                                             */
/* ------------------------------------------------------------------ */

export async function advanceOrder(input: unknown): Promise<ActionResult<{ status: OrderStatus }>> {
  return guard(async (session) => {
    const parsed = advanceOrderSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const [order] = await db
      .select({
        id: orders.id,
        status: orders.status,
        deliveryType: orders.deliveryType,
        paymentMethod: orders.paymentMethod,
      })
      .from(orders)
      .where(and(eq(orders.id, parsed.data.orderId), eq(orders.tenantId, session.tenantId)))
      .limit(1);

    if (!order) return failure("Pedido não encontrado.");

    /* Anti-fraude interna: pagamento online (Pix/cartão) só é confirmado pelo gateway (webhook).
       A liberação manual é exclusiva do proprietário e fica registrada em log de auditoria. */
    const manualOnlineRelease =
      order.status === "AWAITING_PAYMENT" && isOnlinePaymentMethod(order.paymentMethod);
    if (manualOnlineRelease && order.paymentMethod === "CREDIT_CARD") {
      // Cartão pode ser capturado/recusado depois: liberar à mão geraria pedido sem pagamento.
      return failure(
        "Pedidos com cartão online só são liberados pela confirmação do gateway. Para desistir, cancele o pedido.",
      );
    }
    if (manualOnlineRelease && session.role !== "OWNER") {
      return failure(
        "O pagamento online é confirmado automaticamente. Somente o proprietário pode liberar manualmente.",
      );
    }

    const next = getNextStatus(order.status, order.deliveryType);
    if (!next) return failure("Este pedido já foi finalizado.");
    if (parsed.data.toStatus && parsed.data.toStatus !== next) {
      return failure("Transição de etapa inválida. Avance o pedido uma etapa por vez.");
    }

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

    // Pagamento confirmado pelo operador: só agora o pedido segue para o Saipos.
    if (order.status === "AWAITING_PAYMENT") {
      after(() => sendOrderToSaipos(order.id));
    }

    if (manualOnlineRelease) {
      console.warn(
        "[audit] liberação manual de pedido com pagamento online",
        JSON.stringify({ orderId: order.id, adminUserId: session.userId, role: session.role, method: order.paymentMethod }),
      );
      // Trilha durável (o log da plataforma é efêmero): quem liberou e qual pedido.
      await db
        .insert(paymentEvents)
        .values({
          eventId: `manual-release:${crypto.randomUUID()}`,
          eventType: `MANUAL_RELEASE_BY_${session.role}:${session.userId}`,
          orderId: order.id,
        })
        .catch(() => console.error("[audit] falha ao gravar a trilha de liberação manual", { orderId: order.id }));
      // Evita pagamento em duplicidade: a cobrança pendente deixa de existir no Asaas.
      after(() => cancelPendingCharges(order.id).catch(() => undefined));
    }

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

    // Pedido cancelado não pode mais ser pago: remove a cobrança pendente no Asaas.
    after(() => cancelPendingCharges(order.id).catch(() => undefined));

    return success({ status: "CANCELED" as const });
  });
}

const CHANNEL_LABELS = { COUNTER: "Balcão", WHATSAPP: "WhatsApp" } as const;

/** Lança um pedido recebido fora do site (balcão/WhatsApp) direto em "Novos", na fila da cozinha. */
export async function createManualOrder(input: unknown): Promise<ActionResult<{ orderNumber: number }>> {
  return guard(async (session) => {
    const parsed = manualOrderSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const data = parsed.data;

    const catalog = (await loadCatalog(session.tenantId)).flatMap((c) => c.products);
    const isDelivery = data.deliveryType === "DELIVERY";

    // Preço sempre do servidor. Frete é informado pelo operador (sem zona/distância no balcão).
    const calc = calculateCart({
      items: data.items.map((i) => ({ ...i, addons: [] })),
      catalog,
      deliveryType: "PICKUP",
      deliveryZone: null,
      minOrderCents: 0,
      paymentMethod: data.paymentMethod,
    });
    if (!calc.ok) return failure(calc.errors.map((e) => e.message).join(" "));

    const deliveryFeeCents = isDelivery ? data.deliveryFeeCents : 0;
    const totalCents = calc.subtotalCents + deliveryFeeCents;

    // Cliente por telefone (mantém o nome já cadastrado; nunca toca em senha/credenciais).
    let [customer] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, session.tenantId), eq(customers.phone, data.customerPhone)))
      .limit(1);
    if (!customer) {
      [customer] = await db
        .insert(customers)
        .values({ tenantId: session.tenantId, name: data.customerName, phone: data.customerPhone })
        .onConflictDoNothing()
        .returning();
      if (!customer) {
        [customer] = await db
          .select()
          .from(customers)
          .where(and(eq(customers.tenantId, session.tenantId), eq(customers.phone, data.customerPhone)))
          .limit(1);
      }
    }
    if (!customer) return failure("Não foi possível registrar o cliente.");

    const notes = [`[${CHANNEL_LABELS[data.channel]}]`, data.notes].filter(Boolean).join(" ");

    for (let attempt = 0; attempt < 5; attempt++) {
      const [row] = await db
        .select({ last: max(orders.orderNumber) })
        .from(orders)
        .where(eq(orders.tenantId, session.tenantId));
      const orderNumber = (row?.last ?? 100) + 1;
      const orderId = crypto.randomUUID();

      try {
        await db.batch([
          db.insert(orders).values({
            id: orderId,
            tenantId: session.tenantId,
            customerId: customer.id,
            orderNumber,
            status: "RECEIVED",
            deliveryType: data.deliveryType,
            addressSnapshot: isDelivery
              ? {
                  neighborhood: data.neighborhood ?? "",
                  street: data.street ?? "",
                  number: data.number ?? "",
                  complement: null,
                  reference: data.reference || null,
                  deliveryZoneId: null,
                }
              : null,
            paymentMethod: data.paymentMethod,
            subtotalCents: calc.subtotalCents,
            deliveryFeeCents,
            totalCents,
            notes,
          }),
          db.insert(orderItems).values(
            calc.lines.map((line) => ({
              tenantId: session.tenantId,
              orderId,
              productId: line.productId,
              productNameSnapshot: line.productName,
              unitPriceCentsSnapshot: line.unitPriceCents,
              quantity: line.quantity,
              addonsSnapshot: [],
              totalItemCents: line.totalItemCents,
            })),
          ),
        ]);
        after(() => sendOrderToSaipos(orderId));
        return success({ orderNumber });
      } catch (error) {
        const e = error as { code?: string; cause?: { code?: string } };
        if (e.code !== "23505" && e.cause?.code !== "23505") throw error;
      }
    }
    return failure("Não foi possível registrar o pedido. Tente novamente.");
  });
}

/* ------------------------------------------------------------------ */
/* Cardápio: categorias                                                */
/* ------------------------------------------------------------------ */

export async function saveCategory(input: unknown): Promise<ActionResult<{ id: string }>> {
  return guardOwner(async (session) => {
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
  return guardOwner(async (session) => {
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
  return guardOwner(async (session) => {
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
  return guardOwner(async (session) => {
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

/** Edição rápida de preço/descrição (somente OWNER). */
export async function quickEditProduct(input: unknown): Promise<ActionResult> {
  return guardOwner(async (session) => {
    const parsed = quickEditProductSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const updated = await db
      .update(products)
      .set({ priceCents: parsed.data.priceCents, description: parsed.data.description || null })
      .where(and(eq(products.id, parsed.data.id), eq(products.tenantId, session.tenantId)))
      .returning({ id: products.id });
    if (updated.length === 0) return failure("Produto não encontrado.");
    revalidateMenu();
    return success(null);
  });
}

/** Pausa rápida de um grupo inteiro: aplica a disponibilidade a todos os adicionais do grupo. */
export async function toggleAddonGroupAvailability(input: unknown): Promise<ActionResult> {
  return guard(async (session) => {
    const parsed = toggleAvailabilitySchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const [group] = await db
      .select({ id: addonGroups.id })
      .from(addonGroups)
      .where(and(eq(addonGroups.id, parsed.data.id), eq(addonGroups.tenantId, session.tenantId)))
      .limit(1);
    if (!group) return failure("Grupo não encontrado.");

    await db
      .update(addons)
      .set({ isAvailable: parsed.data.isAvailable })
      .where(and(eq(addons.addonGroupId, group.id), eq(addons.tenantId, session.tenantId)));
    revalidateMenu();
    return success(null);
  });
}

/* ------------------------------------------------------------------ */
/* Cardápio: grupos de adicionais e adicionais                         */
/* ------------------------------------------------------------------ */

export async function saveAddonGroup(input: unknown): Promise<ActionResult<{ id: string }>> {
  return guardOwner(async (session) => {
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
  return guardOwner(async (session) => {
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
  return guardOwner(async (session) => {
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
  return guardOwner(async (session) => {
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
  return guardOwner(async (session) => {
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
  return guardOwner(async (session) => {
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
  return guardOwner(async (session) => {
    if (session.role !== "OWNER") return failure("Apenas o proprietário pode alterar as configurações.");

    const parsed = storeSettingsSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const data = parsed.data;

    for (const day of Object.values(data.openingHours)) {
      if (day.enabled && day.open === day.close) {
        return failure("Abertura e fechamento não podem ser o mesmo horário.");
      }
    }

    await loadStoreSettings(session.tenantId); // garante o registro único
    await db.batch([
      db
        .update(tenants)
        .set({
          name: data.name,
          phoneWhatsapp: data.phoneWhatsapp ? `55${data.phoneWhatsapp}` : null,
          logoUrl: data.logoUrl ?? null,
          primaryColor: data.primaryColor,
          minOrderCents: data.minOrderCents,
        })
        .where(eq(tenants.id, session.tenantId)),
      db
        .update(storeSettings)
        .set({
          autoAcceptOrders: data.autoAcceptOrders,
          estimatedDeliveryMinutes: data.estimatedDeliveryMinutes,
          openingHours: data.openingHours,
          address: data.address || null,
        })
        .where(eq(storeSettings.tenantId, session.tenantId)),
    ]);

    revalidateMenu();
    return success(null);
  });
}

/** Switch Loja Aberta/Fechada do cabeçalho (qualquer operador). null volta ao horário automático. */
export async function setStoreOpenOverride(input: unknown): Promise<ActionResult> {
  return guard(async (session) => {
    const parsed = setOpenOverrideSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    await loadStoreSettings(session.tenantId);
    await db
      .update(storeSettings)
      .set({ isOpenOverride: parsed.data.isOpenOverride })
      .where(eq(storeSettings.tenantId, session.tenantId));

    revalidateMenu();
    return success(null);
  });
}

/* ------------------------------------------------------------------ */
/* Entregas: cobertura por raio e faixas de frete                      */
/* ------------------------------------------------------------------ */

export async function getAdminDeliveryRules(): Promise<DeliveryRules | null> {
  const session = await requireSession();
  const settings = await loadStoreSettings(session.tenantId);
  return settings?.deliveryRules ?? null;
}

export async function saveDeliveryRules(input: unknown): Promise<ActionResult> {
  return guardOwner(async (session) => {
    const parsed = deliveryRulesSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    await loadStoreSettings(session.tenantId); // garante o registro único
    await db
      .update(storeSettings)
      .set({ deliveryRules: parsed.data })
      .where(eq(storeSettings.tenantId, session.tenantId));

    revalidateMenu();
    return success(null);
  });
}

/* ------------------------------------------------------------------ */
/* Equipe (somente OWNER)                                              */
/* ------------------------------------------------------------------ */

export type AdminTeamMember = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  createdAt: string;
};

export async function getAdminTeam(): Promise<AdminTeamMember[]> {
  const session = await requireSession();
  if (session.role !== "OWNER") return [];
  const rows = await db
    .select({
      id: adminUsers.id,
      name: adminUsers.name,
      email: adminUsers.email,
      role: adminUsers.role,
      isActive: adminUsers.isActive,
      createdAt: adminUsers.createdAt,
    })
    .from(adminUsers)
    .where(eq(adminUsers.tenantId, session.tenantId))
    .orderBy(asc(adminUsers.createdAt));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function createTeamMember(input: unknown): Promise<ActionResult<{ id: string }>> {
  return guardOwner(async (session) => {
    const parsed = teamMemberInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const data = parsed.data;

    const [existing] = await db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(and(eq(adminUsers.tenantId, session.tenantId), eq(adminUsers.email, data.email)))
      .limit(1);
    if (existing) return failure("Já existe um usuário com este e-mail.");

    const passwordHash = await bcrypt.hash(data.password, 10);
    try {
      const [row] = await db
        .insert(adminUsers)
        .values({
          tenantId: session.tenantId,
          name: data.name,
          email: data.email,
          passwordHash,
          role: data.role,
        })
        .returning({ id: adminUsers.id });
      return success({ id: row.id });
    } catch (error) {
      const e = error as { code?: string; cause?: { code?: string } };
      if (e.code === "23505" || e.cause?.code === "23505") return failure("Já existe um usuário com este e-mail.");
      throw error;
    }
  });
}

export async function setTeamMemberActive(input: unknown): Promise<ActionResult> {
  return guardOwner(async (session) => {
    const parsed = setTeamMemberActiveSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const { id, isActive } = parsed.data;

    if (!isActive) {
      if (id === session.userId) return failure("Você não pode desativar o seu próprio acesso.");

      const [target] = await db
        .select({ role: adminUsers.role })
        .from(adminUsers)
        .where(and(eq(adminUsers.id, id), eq(adminUsers.tenantId, session.tenantId)))
        .limit(1);
      if (!target) return failure("Usuário não encontrado.");
      if (target.role === "OWNER") {
        const owners = await db
          .select({ id: adminUsers.id })
          .from(adminUsers)
          .where(
            and(
              eq(adminUsers.tenantId, session.tenantId),
              eq(adminUsers.role, "OWNER"),
              eq(adminUsers.isActive, true),
            ),
          );
        if (owners.length <= 1) return failure("A loja precisa de ao menos um proprietário ativo.");
      }
    }

    const updated = await db
      .update(adminUsers)
      .set({ isActive })
      .where(and(eq(adminUsers.id, id), eq(adminUsers.tenantId, session.tenantId)))
      .returning({ id: adminUsers.id });
    if (updated.length === 0) return failure("Usuário não encontrado.");
    return success(null);
  });
}

/* ------------------------------------------------------------------ */
/* Cupons promocionais (somente OWNER)                                 */
/* ------------------------------------------------------------------ */

export type AdminCoupon = {
  id: string;
  code: string;
  type: "PERCENT" | "FIXED";
  value: number;
  minOrderCents: number;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
};

export async function getAdminCoupons(): Promise<AdminCoupon[]> {
  const session = await requireSession();
  if (session.role !== "OWNER") return [];
  return db
    .select({
      id: coupons.id,
      code: coupons.code,
      type: coupons.type,
      value: coupons.value,
      minOrderCents: coupons.minOrderCents,
      maxUses: coupons.maxUses,
      usedCount: coupons.usedCount,
      isActive: coupons.isActive,
    })
    .from(coupons)
    .where(eq(coupons.tenantId, session.tenantId))
    .orderBy(desc(coupons.createdAt));
}

export async function saveCoupon(input: unknown): Promise<ActionResult<{ id: string }>> {
  return guardOwner(async (session) => {
    const parsed = couponInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const { id, ...values } = parsed.data;

    try {
      if (id) {
        const updated = await db
          .update(coupons)
          .set(values)
          .where(and(eq(coupons.id, id), eq(coupons.tenantId, session.tenantId)))
          .returning({ id: coupons.id });
        if (updated.length === 0) return failure("Cupom não encontrado.");
        return success({ id });
      }
      const [row] = await db
        .insert(coupons)
        .values({ tenantId: session.tenantId, ...values })
        .returning({ id: coupons.id });
      return success({ id: row.id });
    } catch (error) {
      const e = error as { code?: string; cause?: { code?: string } };
      if (e.code === "23505" || e.cause?.code === "23505") return failure("Já existe um cupom com este código.");
      throw error;
    }
  });
}

export async function setCouponActive(input: unknown): Promise<ActionResult> {
  return guardOwner(async (session) => {
    const parsed = setCouponActiveSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const updated = await db
      .update(coupons)
      .set({ isActive: parsed.data.isActive })
      .where(and(eq(coupons.id, parsed.data.id), eq(coupons.tenantId, session.tenantId)))
      .returning({ id: coupons.id });
    if (updated.length === 0) return failure("Cupom não encontrado.");
    return success(null);
  });
}

export async function deleteCoupon(input: unknown): Promise<ActionResult> {
  return guardOwner(async (session) => {
    const parsed = idInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const deleted = await db
      .delete(coupons)
      .where(and(eq(coupons.id, parsed.data.id), eq(coupons.tenantId, session.tenantId)))
      .returning({ id: coupons.id });
    if (deleted.length === 0) return failure("Cupom não encontrado.");
    return success(null);
  });
}
