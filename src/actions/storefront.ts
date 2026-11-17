"use server";

import { and, desc, eq, inArray, max } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { redirect } from "next/navigation";

import { calculateCart } from "@/core/cart/calculate-cart";
import type { DeliveryType, OrderStatus, PaymentMethod } from "@/core/schemas/common";
import { checkoutSchema, customerNameSchema } from "@/core/schemas/checkout";
import type { CatalogDeliveryZone } from "@/core/schemas/product";
import { getStoreStatus, type OpeningHours, type StoreStatus } from "@/core/store/opening-hours";
import {
  clearCustomerSessionCookie,
  getCustomerSession,
  setCustomerSessionCookie,
} from "@/infra/auth/session";
import { applyLocalImages } from "@/lib/local-images";
import { db } from "@/infra/db";
import {
  loadCatalog,
  loadDeliveryZones,
  type CatalogCategoryWithStatus,
} from "@/infra/db/queries";
import {
  customerAddresses,
  customers,
  orderItems,
  orders,
  tenants,
  type AddressSnapshot,
  type OrderItemAddonSnapshot,
} from "@/infra/db/schema";
import { getTenantRef } from "@/infra/tenant/resolve";

import { failure, fromZod, success, type ActionFailure, type ActionResult } from "./result";

/* ------------------------------------------------------------------ */
/* Tipos públicos                                                      */
/* ------------------------------------------------------------------ */

export type PublicTenant = {
  id: string;
  name: string;
  slug: string;
  phoneWhatsapp: string | null;
  logoUrl: string | null;
  primaryColor: string;
  minOrderCents: number;
  isManuallyClosed: boolean;
  openingHours: OpeningHours;
};

export type StorefrontData = {
  tenant: PublicTenant;
  categories: CatalogCategoryWithStatus[];
  zones: CatalogDeliveryZone[];
  store: StoreStatus;
};

export type CustomerOrderItemView = {
  productId: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalItemCents: number;
  addons: OrderItemAddonSnapshot[];
};

export type CustomerOrderView = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  deliveryType: DeliveryType;
  paymentMethod: PaymentMethod;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  cancelReason: string | null;
  createdAt: string;
  items: CustomerOrderItemView[];
  /** Snapshot do endereço de entrega (null em retirada). */
  address: AddressSnapshot | null;
};

export type CustomerOrdersData = {
  customerName: string;
  /** Apenas dígitos; exibido no card de dados do Meu Passaporte. */
  customerPhone: string;
  orders: CustomerOrderView[];
};

/* ------------------------------------------------------------------ */
/* Leitura cacheada do cardápio (revalidateTag('menu'))                */
/* ------------------------------------------------------------------ */

async function loadStorefront(tenantId: string) {
  const [tenant] = await db
    .select({
      id: tenants.id,
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
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant) return null;

  const [categories, zones] = await Promise.all([loadCatalog(tenantId), loadDeliveryZones(tenantId)]);

  return { tenant, categories, zones };
}

export async function getStorefrontData(): Promise<StorefrontData | null> {
  const ref = await getTenantRef();
  if (!ref) return null;

  const cached = await unstable_cache(() => loadStorefront(ref.id), ["storefront", ref.id], {
    tags: ["menu"],
  })();

  if (!cached) return null;

  // O status (aberto/fechado) é calculado a cada requisição a partir dos dados em cache.
  const store = getStoreStatus({
    openingHours: cached.tenant.openingHours,
    isManuallyClosed: cached.tenant.isManuallyClosed,
  });

  return { ...cached, categories: applyLocalImages(cached.categories), store };
}

/* ------------------------------------------------------------------ */
/* Criação de pedido                                                   */
/* ------------------------------------------------------------------ */

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export async function createOrder(input: unknown): Promise<ActionFailure> {
  const ref = await getTenantRef();
  if (!ref) return failure("Loja não encontrada.");

  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const data = parsed.data;

  // Dados frescos do banco (nunca do cache) para validar horário e pedido mínimo.
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, ref.id)).limit(1);
  if (!tenant) return failure("Loja não encontrada.");

  const status = getStoreStatus({
    openingHours: tenant.openingHours,
    isManuallyClosed: tenant.isManuallyClosed,
  });
  if (!status.isOpen) {
    return failure(
      status.reason === "MANUALLY_CLOSED"
        ? "A loja está fechada no momento."
        : "Estamos fora do horário de funcionamento.",
    );
  }

  const catalog = (await loadCatalog(tenant.id)).flatMap((c) => c.products);

  let zone: CatalogDeliveryZone | null = null;
  if (data.deliveryType === "DELIVERY" && data.deliveryZoneId) {
    const zones = await loadDeliveryZones(tenant.id, { includeInactive: true });
    zone = zones.find((z) => z.id === data.deliveryZoneId) ?? null;
  }

  const calc = calculateCart({
    items: data.items,
    catalog,
    deliveryType: data.deliveryType,
    deliveryZone: zone,
    minOrderCents: tenant.minOrderCents,
    paymentMethod: data.paymentMethod,
    changeForCents: data.changeForCents,
  });

  if (!calc.ok) return failure(calc.errors.map((e) => e.message).join(" "));

  /* Cliente (upsert pelo telefone). */
  const [customer] = await db
    .insert(customers)
    .values({ tenantId: tenant.id, name: data.customerName, phone: data.customerPhone })
    .onConflictDoUpdate({
      target: [customers.tenantId, customers.phone],
      set: { name: data.customerName },
    })
    .returning();

  /* Endereço (snapshot imutável + reaproveitamento no cadastro do cliente). */
  let addressSnapshot: AddressSnapshot | null = null;
  if (data.deliveryType === "DELIVERY" && zone) {
    addressSnapshot = {
      neighborhood: zone.neighborhood,
      street: data.street ?? "",
      number: data.number ?? "",
      complement: data.complement ?? null,
      reference: data.reference ?? null,
      deliveryZoneId: zone.id,
    };

    const existingAddresses = await db
      .select({
        street: customerAddresses.street,
        number: customerAddresses.number,
        zoneId: customerAddresses.deliveryZoneId,
      })
      .from(customerAddresses)
      .where(and(eq(customerAddresses.tenantId, tenant.id), eq(customerAddresses.customerId, customer.id)));

    const alreadySaved = existingAddresses.some(
      (a) =>
        a.zoneId === zone!.id &&
        a.street.toLowerCase() === addressSnapshot!.street.toLowerCase() &&
        a.number.toLowerCase() === addressSnapshot!.number.toLowerCase(),
    );

    if (!alreadySaved) {
      await db.insert(customerAddresses).values({
        tenantId: tenant.id,
        customerId: customer.id,
        deliveryZoneId: zone.id,
        street: addressSnapshot.street,
        number: addressSnapshot.number,
        complement: addressSnapshot.complement,
        reference: addressSnapshot.reference,
      });
    }
  }

  /* Pedido + itens em lote atômico, com retry em conflito do order_number. */
  const initialStatus: OrderStatus = data.paymentMethod === "PIX" ? "AWAITING_PAYMENT" : "RECEIVED";
  let created: { orderId: string; orderNumber: number } | null = null;

  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    const [row] = await db
      .select({ last: max(orders.orderNumber) })
      .from(orders)
      .where(eq(orders.tenantId, tenant.id));

    const orderNumber = (row?.last ?? 100) + 1;
    const orderId = crypto.randomUUID();

    try {
      await db.batch([
        db.insert(orders).values({
          id: orderId,
          tenantId: tenant.id,
          customerId: customer.id,
          orderNumber,
          status: initialStatus,
          deliveryType: data.deliveryType,
          addressSnapshot,
          paymentMethod: data.paymentMethod,
          changeForCents: data.paymentMethod === "CASH" ? (data.changeForCents ?? null) : null,
          subtotalCents: calc.subtotalCents,
          deliveryFeeCents: calc.deliveryFeeCents,
          totalCents: calc.totalCents,
          notes: data.notes ?? null,
        }),
        db.insert(orderItems).values(
          calc.lines.map((line) => ({
            tenantId: tenant.id,
            orderId,
            productId: line.productId,
            productNameSnapshot: line.productName,
            unitPriceCentsSnapshot: line.unitPriceCents,
            quantity: line.quantity,
            addonsSnapshot: line.addons.map((a) => ({
              name: a.name,
              price_cents: a.price_cents,
              quantity: a.quantity,
            })),
            totalItemCents: line.totalItemCents,
          })),
        ),
      ]);
      created = { orderId, orderNumber };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  if (!created) return failure("Não foi possível registrar o pedido. Tente novamente.");

  await setCustomerSessionCookie({
    customerId: customer.id,
    tenantId: tenant.id,
    phone: customer.phone,
  });

  redirect("/meus-pedidos");
}

/* ------------------------------------------------------------------ */
/* Pedidos do cliente                                                  */
/* ------------------------------------------------------------------ */

async function loadCustomerOrders(tenantId: string, customerId: string): Promise<CustomerOrderView[]> {
  const orderRows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.customerId, customerId)))
    .orderBy(desc(orders.createdAt))
    .limit(100);

  if (orderRows.length === 0) return [];

  const itemRows = await db
    .select()
    .from(orderItems)
    .where(
      and(
        eq(orderItems.tenantId, tenantId),
        inArray(
          orderItems.orderId,
          orderRows.map((o) => o.id),
        ),
      ),
    );

  const itemsByOrder = new Map<string, CustomerOrderItemView[]>();
  for (const item of itemRows) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push({
      productId: item.productId,
      name: item.productNameSnapshot,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCentsSnapshot,
      totalItemCents: item.totalItemCents,
      addons: item.addonsSnapshot,
    });
    itemsByOrder.set(item.orderId, list);
  }

  return orderRows.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    deliveryType: o.deliveryType,
    paymentMethod: o.paymentMethod,
    subtotalCents: o.subtotalCents,
    deliveryFeeCents: o.deliveryFeeCents,
    totalCents: o.totalCents,
    cancelReason: o.cancelReason,
    createdAt: o.createdAt.toISOString(),
    items: itemsByOrder.get(o.id) ?? [],
    address: o.addressSnapshot ?? null,
  }));
}

/** Pedidos do cliente identificado pelo cookie `customer_token`. Retorna null se não houver sessão. */
export async function getCustomerOrders(): Promise<CustomerOrdersData | null> {
  const ref = await getTenantRef();
  if (!ref) return null;

  const session = await getCustomerSession();
  if (!session || session.tenantId !== ref.id) return null;

  const [customer] = await db
    .select({ id: customers.id, name: customers.name, phone: customers.phone })
    .from(customers)
    .where(and(eq(customers.id, session.customerId), eq(customers.tenantId, ref.id)))
    .limit(1);

  if (!customer) return null;

  return {
    customerName: customer.name,
    customerPhone: customer.phone,
    orders: await loadCustomerOrders(ref.id, customer.id),
  };
}

/** Primeiro acesso: define o nome do cliente já autenticado via OTP (exige sessão). */
export async function saveCustomerName(input: unknown): Promise<ActionResult<{ name: string }>> {
  const ref = await getTenantRef();
  if (!ref) return failure("Loja não encontrada.");

  const session = await getCustomerSession();
  if (!session || session.tenantId !== ref.id) return failure("Sessão expirada. Entre novamente.");

  const parsed = customerNameSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const updated = await db
    .update(customers)
    .set({ name: parsed.data.name })
    .where(and(eq(customers.id, session.customerId), eq(customers.tenantId, ref.id)))
    .returning({ name: customers.name });

  if (updated.length === 0) return failure("Cliente não encontrado.");
  return success({ name: updated[0].name });
}

/** "Trocar número": encerra a sessão do cliente (apaga o cookie `customer_token`). */
export async function clearCustomerSession(): Promise<void> {
  await clearCustomerSessionCookie();
}
