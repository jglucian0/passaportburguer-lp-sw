"use server";

import { and, desc, eq, inArray, max } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";

import { calculateCart } from "@/core/cart/calculate-cart";
import { calculateDeliveryQuote, resolveDeliveryZone, withQuotedFee } from "@/core/delivery/quote";
import { effectiveMinOrderCents } from "@/core/store/min-order";
import { onlyDigits } from "@/core/validation/document";
import { OTHER_ZONE_NAME } from "@/core/store/maringa-zones";
import type { DeliveryType, OrderStatus, PaymentMethod } from "@/core/schemas/common";
import { checkoutSchema } from "@/core/schemas/checkout";
import type { CatalogDeliveryZone } from "@/core/schemas/product";
import { getStoreStatus, type OpeningHours, type StoreStatus } from "@/core/store/opening-hours";
import { getAuthSession } from "@/infra/auth/customer-session";
import { checkRateLimit, getClientIp } from "@/infra/security/rate-limit";
import { sendOrderToSaipos } from "@/lib/saipos";
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
import { loadStoreSettings } from "@/infra/db/store-settings";
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
  openingHours: OpeningHours;
  estimatedDeliveryMinutes: number;
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
  /** Sem senha definida: ainda precisa concluir o cadastro (nome, e-mail, senha). */
  needsRegistration: boolean;
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

  // Configurações da loja são lidas frescas (1 linha): o switch do admin reflete na hora.
  const settings = await loadStoreSettings(ref.id);
  if (!settings) return null;

  const store = getStoreStatus({
    openingHours: settings.openingHours,
    isOpenOverride: settings.isOpenOverride,
  });

  return {
    ...cached,
    tenant: {
      ...cached.tenant,
      openingHours: settings.openingHours,
      estimatedDeliveryMinutes: settings.estimatedDeliveryMinutes,
    },
    categories: applyLocalImages(cached.categories),
    store,
  };
}

/* ------------------------------------------------------------------ */
/* Criação de pedido                                                   */
/* ------------------------------------------------------------------ */

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export async function createOrder(input: unknown): Promise<ActionFailure> {
  const limit = await checkRateLimit({
    identifier: getClientIp(await headers()),
    route: "orders",
    limit: 6,
    windowSeconds: 600,
  });
  if (!limit.allowed) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfterSeconds / 60));
    return failure(`Muitos pedidos em pouco tempo. Tente novamente em ${minutes} min.`);
  }

  const ref = await getTenantRef();
  if (!ref) return failure("Loja não encontrada.");

  /* Checkout autenticado: o cliente vem da sessão, nunca do que o formulário diz. */
  const session = await getAuthSession();
  if (!session || session.tenantId !== ref.id) return failure("Sessão expirada. Entre novamente.");

  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const data = parsed.data;

  // Dados frescos do banco (nunca do cache) para validar horário e pedido mínimo.
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, ref.id)).limit(1);
  if (!tenant) return failure("Loja não encontrada.");

  const settings = await loadStoreSettings(tenant.id);
  if (!settings) return failure("Loja não encontrada.");

  const status = getStoreStatus({
    openingHours: settings.openingHours,
    isOpenOverride: settings.isOpenOverride,
  });
  if (!status.isOpen) {
    return failure(
      status.reason === "MANUALLY_CLOSED"
        ? "A loja está fechada no momento."
        : "Estamos fora do horário de funcionamento.",
    );
  }

  const catalog = (await loadCatalog(tenant.id)).flatMap((c) => c.products);

  /* Frete por distância (vale o valor do servidor) + zona para tempo estimado e vínculo. */
  let zone: CatalogDeliveryZone | null = null;
  if (data.deliveryType === "DELIVERY") {
    const quote = calculateDeliveryQuote(data.lat ?? NaN, data.lon ?? NaN, data.city ?? "");
    if (!quote.deliverable) return failure(quote.message);

    const zones = await loadDeliveryZones(tenant.id, { includeInactive: true });
    const base = resolveDeliveryZone(zones, data.neighborhood, OTHER_ZONE_NAME);
    if (!base) return failure("Não foi possível atender este endereço no momento.");
    zone = withQuotedFee(base, quote.feeCents);
  }

  const calc = calculateCart({
    items: data.items,
    catalog,
    deliveryType: data.deliveryType,
    deliveryZone: zone,
    minOrderCents: effectiveMinOrderCents(tenant.minOrderCents),
    paymentMethod: data.paymentMethod,
    changeForCents: data.changeForCents,
  });

  if (!calc.ok) return failure(calc.errors.map((e) => e.message).join(" "));

  /* Cliente da sessão (sem upsert por telefone: ninguém cria pedidos na conta de outra pessoa). */
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, session.customerId), eq(customers.tenantId, tenant.id)))
    .limit(1);
  if (!customer || customer.passwordHash === null) {
    return failure("Conclua seu cadastro no Meu Passaporte antes de pedir.");
  }

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
      latitude: data.lat ?? null,
      longitude: data.lon ?? null,
      city: data.city ?? null,
      district: data.neighborhood ?? null,
      postalCode: data.postalCode ? onlyDigits(data.postalCode).slice(0, 8) : null,
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
  const initialStatus: OrderStatus =
    data.paymentMethod === "PIX" ? "AWAITING_PAYMENT" : settings.autoAcceptOrders ? "PREPARING" : "RECEIVED";
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
          documentNumber: data.documentNumber ? onlyDigits(data.documentNumber) : null,
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
              addon_id: a.addonId,
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

  /* Saipos: nunca bloqueia nem falha a compra. PIX só é enviado após a confirmação do pagamento. */
  if (initialStatus !== "AWAITING_PAYMENT") {
    const orderIdToSync = created.orderId;
    after(() => sendOrderToSaipos(orderIdToSync));
  }

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
/** Cliente da sessão para o checkout (null = precisa entrar). */
export async function getCheckoutCustomer(): Promise<{
  name: string;
  phone: string;
  needsRegistration: boolean;
} | null> {
  const ref = await getTenantRef();
  if (!ref) return null;
  const session = await getAuthSession();
  if (!session || session.tenantId !== ref.id) return null;
  const [customer] = await db
    .select({ name: customers.name, phone: customers.phone, passwordHash: customers.passwordHash })
    .from(customers)
    .where(and(eq(customers.id, session.customerId), eq(customers.tenantId, ref.id)))
    .limit(1);
  if (!customer) return null;
  return { name: customer.name, phone: customer.phone, needsRegistration: customer.passwordHash === null };
}

export async function getCustomerOrders(): Promise<CustomerOrdersData | null> {
  const ref = await getTenantRef();
  if (!ref) return null;

  const session = await getAuthSession();
  if (!session || session.tenantId !== ref.id) return null;

  const [customer] = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      passwordHash: customers.passwordHash,
    })
    .from(customers)
    .where(and(eq(customers.id, session.customerId), eq(customers.tenantId, ref.id)))
    .limit(1);

  if (!customer) return null;

  return {
    customerName: customer.name,
    needsRegistration: customer.passwordHash === null,
    customerPhone: customer.phone,
    orders: await loadCustomerOrders(ref.id, customer.id),
  };
}
