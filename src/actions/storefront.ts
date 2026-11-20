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
import { isOnlinePaymentMethod } from "@/core/schemas/common";
import { cancelPendingCharges, createPixCharge } from "@/infra/payments/asaas";
import { expireAbandonedOrders } from "@/infra/payments/expire-orders";
import { consumeOrderCoupon, lookupCoupon } from "@/infra/coupons";
import type { CatalogDeliveryZone } from "@/core/schemas/product";
import { getStoreStatus, type OpeningHours, type StoreStatus } from "@/core/store/opening-hours";
import { nameInput } from "@/core/schemas/auth";
import { isProfileComplete } from "@/infra/auth/account";
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
import { recordTimelineEvent } from "@/infra/db/timeline";
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
  /** Falta nome ou CPF: ainda precisa concluir o cadastro (sem senha). */
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

type KeyedOrder = { id: string; paymentMethod: PaymentMethod; status: OrderStatus };

async function findOrderByKey(
  tenantId: string,
  customerId: string,
  key: string,
): Promise<KeyedOrder | null> {
  const [row] = await db
    .select({ id: orders.id, paymentMethod: orders.paymentMethod, status: orders.status })
    .from(orders)
    .where(
      and(eq(orders.tenantId, tenantId), eq(orders.customerId, customerId), eq(orders.idempotencyKey, key)),
    )
    .limit(1);
  return row ?? null;
}

/** Pedido online aguardando pagamento vai para a tela de pagamento; o resto, para Meu Passaporte. */
function afterOrderPath(order: KeyedOrder): string {
  return isOnlinePaymentMethod(order.paymentMethod) && order.status === "AWAITING_PAYMENT"
    ? `/pagamento/${order.id}`
    : "/meus-pedidos";
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

  /* Idempotência: a mesma chave (duplo clique/reenvio) devolve o pedido já criado. */
  if (data.idempotencyKey) {
    const existing = await findOrderByKey(ref.id, session.customerId, data.idempotencyKey);
    if (existing) redirect(afterOrderPath(existing));
  }

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

  /* Cupom: validado aqui (nunca confiamos no desconto do navegador). */
  let couponLookup: Extract<Awaited<ReturnType<typeof lookupCoupon>>, { ok: true }> | null = null;
  if (data.couponCode) {
    const found = await lookupCoupon(tenant.id, data.couponCode, session.customerId);
    if (!found.ok) return failure(found.error);
    couponLookup = found;
  }

  const calc = calculateCart({
    items: data.items,
    catalog,
    deliveryType: data.deliveryType,
    deliveryZone: zone,
    minOrderCents: effectiveMinOrderCents(tenant.minOrderCents),
    paymentMethod: data.paymentMethod,
    changeForCents: data.changeForCents,
    coupon: couponLookup?.coupon ?? null,
  });

  if (!calc.ok) return failure(calc.errors.map((e) => e.message).join(" "));

  /* Cliente da sessão (sem upsert por telefone: ninguém cria pedidos na conta de outra pessoa). */
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, session.customerId), eq(customers.tenantId, tenant.id)))
    .limit(1);
  if (!customer || customer.phoneVerifiedAt === null || customer.name.trim().length < 2) {
    return failure("Valide seu WhatsApp e conclua seu cadastro (nome e CPF) antes de pedir.");
  }

  /* CPF/CNPJ informado no pedido vira dado do cadastro (uma vez só): não é pedido de novo depois. */
  const orderDocument = data.documentNumber ? onlyDigits(data.documentNumber) : "";
  if (!customer.documentNumber && (orderDocument.length === 11 || orderDocument.length === 14)) {
    await db
      .update(customers)
      .set({ documentNumber: orderDocument })
      .where(and(eq(customers.id, customer.id), eq(customers.tenantId, tenant.id)))
      .catch(() => undefined);
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
    isOnlinePaymentMethod(data.paymentMethod) ? "AWAITING_PAYMENT" : settings.autoAcceptOrders ? "PREPARING" : "RECEIVED";
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
          idempotencyKey: data.idempotencyKey ?? null,
          changeForCents: data.paymentMethod === "CASH" ? (data.changeForCents ?? null) : null,
          subtotalCents: calc.subtotalCents,
          deliveryFeeCents: calc.deliveryFeeCents,
          discountCents: calc.discountCents,
          couponId: couponLookup?.couponId ?? null,
          couponCode: couponLookup?.coupon.code ?? null,
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
      // Corrida de duplo clique: outra requisição já gravou o pedido com a mesma chave.
      if (data.idempotencyKey) {
        const existing = await findOrderByKey(tenant.id, customer.id, data.idempotencyKey);
        if (existing) redirect(afterOrderPath(existing));
      }
    }
  }

  if (!created) return failure("Não foi possível registrar o pedido. Tente novamente.");

  await recordTimelineEvent({
    orderId: created.orderId,
    type: "ORDER_CREATED",
    title: "Pedido criado",
    description: `Pedido #${created.orderNumber} criado no site.`,
    dedupeKey: `${created.orderId}:created`,
  });

  /* Saipos: nunca bloqueia nem falha a compra. PIX só é enviado após a confirmação do pagamento. */
  if (initialStatus !== "AWAITING_PAYMENT") {
    // Pagamento na entrega/retirada: o pedido já foi aceito, então o cupom é consumido agora.
    await consumeOrderCoupon(created.orderId).catch(() => undefined);
    const orderIdToSync = created.orderId;
    after(() => sendOrderToSaipos(orderIdToSync));
  }

  if (isOnlinePaymentMethod(data.paymentMethod)) {
    /* Pix: gera a cobrança já aqui para a tela abrir com o QR Code. Se o Asaas falhar, o pedido
       segue aguardando pagamento e a tela de pagamento tenta de novo. */
    if (data.paymentMethod === "PIX") {
      try {
        await createPixCharge({
          order: { id: created.orderId, totalCents: calc.totalCents },
          customer: {
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
            asaasCustomerId: customer.asaasCustomerId,
            cpfCnpj: data.documentNumber ? onlyDigits(data.documentNumber) : null,
          },
        });
      } catch {
        console.error("[checkout] cobrança Pix não criada; a tela de pagamento tentará novamente", {
          orderId: created.orderId,
        });
      }
    }
    redirect(`/pagamento/${created.orderId}`);
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
/** Último endereço de entrega com coordenadas (pedido anterior), no formato do seletor de endereços. */
export type CheckoutLastAddress = {
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  lat: number;
  lon: number;
};

export async function getCheckoutCustomer(): Promise<{
  name: string;
  phone: string;
  needsRegistration: boolean;
  /** CPF/CNPJ (só dígitos) já salvo no cadastro ou em pedido anterior. */
  documentNumber: string | null;
  lastAddress: CheckoutLastAddress | null;
} | null> {
  const ref = await getTenantRef();
  if (!ref) return null;
  const session = await getAuthSession();
  if (!session || session.tenantId !== ref.id) return null;
  const [customer] = await db
    .select({
      name: customers.name,
      phone: customers.phone,
      documentNumber: customers.documentNumber,
    })
    .from(customers)
    .where(and(eq(customers.id, session.customerId), eq(customers.tenantId, ref.id)))
    .limit(1);
  if (!customer) return null;

  /* Pré-preenchimento: último endereço de entrega (com pino) e CPF do pedido mais recente que o tenha. */
  const recent = await db
    .select({ snapshot: orders.addressSnapshot, documentNumber: orders.documentNumber })
    .from(orders)
    .where(and(eq(orders.tenantId, ref.id), eq(orders.customerId, session.customerId)))
    .orderBy(desc(orders.createdAt))
    .limit(15);

  let lastAddress: CheckoutLastAddress | null = null;
  for (const row of recent) {
    const a = row.snapshot;
    if (a && typeof a.latitude === "number" && typeof a.longitude === "number" && a.street && a.number) {
      lastAddress = {
        street: a.street,
        number: a.number,
        complement: a.complement ?? "",
        neighborhood: a.district ?? a.neighborhood ?? "",
        city: a.city ?? "",
        state: "PR",
        postalCode: a.postalCode ?? "",
        lat: a.latitude,
        lon: a.longitude,
      };
      break;
    }
  }
  const documentNumber =
    customer.documentNumber ?? recent.find((r) => r.documentNumber)?.documentNumber ?? null;

  return {
    name: customer.name,
    phone: customer.phone,
    needsRegistration: !isProfileComplete(customer),
    documentNumber,
    lastAddress,
  };
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
      documentNumber: customers.documentNumber,
    })
    .from(customers)
    .where(and(eq(customers.id, session.customerId), eq(customers.tenantId, ref.id)))
    .limit(1);

  if (!customer) return null;

  // O cron é diário: pedidos online sem pagamento há 30+ min são expirados aqui, na hora de listar.
  await expireAbandonedOrders({ tenantId: ref.id, customerId: customer.id }).catch(() => undefined);

  return {
    customerName: customer.name,
    /* "Meu Passaporte" só exige o nome: o CPF é pedido (uma vez) no pagamento online, não aqui. */
    needsRegistration: customer.name.trim().length < 2,
    customerPhone: customer.phone,
    orders: await loadCustomerOrders(ref.id, customer.id),
  };
}

/**
 * Cliente cancela um pedido online que ainda não foi pago (AWAITING_PAYMENT). Depois que o pedido vai
 * para a chapa (ou se for pagamento na entrega/retirada) não há cancelamento por aqui.
 */
export async function cancelCustomerOrder(orderId: unknown): Promise<ActionResult<{ orderNumber: number }>> {
  if (typeof orderId !== "string" || !/^[0-9a-f-]{36}$/i.test(orderId)) return failure("Pedido inválido.");
  const session = await getAuthSession();
  if (!session) return failure("Sessão expirada. Entre novamente.");

  const [order] = await db
    .select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, paymentMethod: orders.paymentMethod })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.customerId, session.customerId), eq(orders.tenantId, session.tenantId)))
    .limit(1);
  if (!order) return failure("Pedido não encontrado.");
  if (order.status === "CANCELED") return success({ orderNumber: order.orderNumber });
  if (order.status !== "AWAITING_PAYMENT" || !isOnlinePaymentMethod(order.paymentMethod)) {
    return failure("Este pedido não pode mais ser cancelado por aqui. Fale com a gente no WhatsApp.");
  }

  // A cobrança é invalidada no Asaas ANTES: se acabou de ser paga, o pedido segue (webhook/settle).
  try {
    const { blocked } = await cancelPendingCharges(order.id);
    if (blocked === "PAID") return failure("O pagamento acabou de ser confirmado, então o pedido não pode ser cancelado.");
    if (blocked) return failure("Não consegui confirmar a cobrança agora. Tente novamente em instantes.");
  } catch {
    return failure("Não foi possível cancelar agora. Tente novamente em instantes.");
  }

  const canceled = await db
    .update(orders)
    .set({ status: "CANCELED", cancelReason: "Cancelado pelo cliente antes do pagamento.", updatedAt: new Date() })
    .where(and(eq(orders.id, order.id), eq(orders.status, "AWAITING_PAYMENT")))
    .returning({ id: orders.id });
  if (canceled.length === 0) return failure("O pedido mudou de status. Atualize a página.");

  await recordTimelineEvent({
    orderId: order.id,
    type: "ORDER_CANCELED",
    title: "Pedido cancelado",
    description: "Cancelado pelo cliente antes do pagamento.",
    dedupeKey: `${order.id}:canceled`,
  }).catch(() => undefined);

  return success({ orderNumber: order.orderNumber });
}


/** Altera o nome do perfil. O telefone é imutável (identidade do cliente); o CPF só é pedido quando falta. */
export async function updateCustomerName(input: unknown): Promise<ActionResult<{ name: string }>> {
  const parsed = nameInput.safeParse(input);
  if (!parsed.success) return failure(parsed.error.issues[0]?.message ?? "Nome inválido.");
  const session = await getAuthSession();
  if (!session) return failure("Sessão expirada. Entre novamente.");
  const limit = await checkRateLimit({
    identifier: session.customerId,
    route: "update-name",
    limit: 10,
    windowSeconds: 600,
  });
  if (!limit.allowed) return failure("Muitas alterações. Tente novamente em alguns minutos.");
  const updated = await db
    .update(customers)
    .set({ name: parsed.data })
    .where(and(eq(customers.id, session.customerId), eq(customers.tenantId, session.tenantId)))
    .returning({ name: customers.name });
  if (updated.length === 0) return failure("Cadastro não encontrado.");
  return success({ name: updated[0].name });
}

/** Confere o cupom para o checkout (o desconto real é recalculado no servidor ao criar o pedido). */
export async function validateCoupon(
  code: unknown,
): Promise<
  | { ok: true; coupon: { code: string; type: "PERCENT" | "FIXED"; value: number; minOrderCents: number } }
  | { ok: false; error: string }
> {
  const session = await getAuthSession();
  if (!session) return { ok: false, error: "Sessão expirada. Entre novamente." };
  const limit = await checkRateLimit({
    identifier: session.customerId,
    route: "coupon",
    limit: 15,
    windowSeconds: 600,
  });
  if (!limit.allowed) return { ok: false, error: "Muitas tentativas. Aguarde um pouco." };
  if (typeof code !== "string") return { ok: false, error: "Informe o código do cupom." };
  const found = await lookupCoupon(session.tenantId, code, session.customerId);
  return found.ok ? { ok: true, coupon: found.coupon } : found;
}
