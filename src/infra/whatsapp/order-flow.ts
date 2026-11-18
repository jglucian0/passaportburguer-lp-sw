import { and, eq, inArray, isNotNull, max } from "drizzle-orm";
import { z } from "zod";

import { calculateCart, type CalculateCartResult } from "@/core/cart/calculate-cart";
import { calculateDeliveryQuote, resolveDeliveryZone, withQuotedFee } from "@/core/delivery/quote";
import { cartItemInputSchema } from "@/core/schemas/cart";
import { deliveryTypeSchema, isOnlinePaymentMethod } from "@/core/schemas/common";
import type { CatalogDeliveryZone } from "@/core/schemas/product";
import { effectiveMinOrderCents } from "@/core/store/min-order";
import { OTHER_ZONE_NAME } from "@/core/store/maringa-zones";
import { getStoreStatus } from "@/core/store/opening-hours";
import { documentError, onlyDigits } from "@/core/validation/document";
import { db } from "@/infra/db";
import { loadCatalog, loadDeliveryZones } from "@/infra/db/queries";
import {
  customerAddresses,
  customers,
  orderItems,
  orders,
  tenants,
  whatsappSessions,
  type AddressSnapshot,
  type OrderStatus,
  type PaymentMethod,
  type WhatsAppDraftCartItem,
} from "@/infra/db/schema";
import { loadStoreSettings } from "@/infra/db/store-settings";
import { recordTimelineEvent } from "@/infra/db/timeline";
import { createPixCharge } from "@/infra/payments/asaas";
import { sendOrderToSaipos } from "@/lib/saipos";
import { formatCents } from "@/lib/utils";

import { sendCtaUrlButton, sendTextMessage } from "./client";
import { geocodeAddress } from "./geocode";
import { appUrl, getTenantId, toCustomerPhone, type ToolContext } from "./shared";

/* ------------------------------------------------------------------ */
/* Rascunho                                                            */
/* ------------------------------------------------------------------ */

const draftInputSchema = z.object({
  items: z
    .array(cartItemInputSchema.extend({ notes: z.string().trim().max(200).nullish() }))
    .min(1, "Carrinho vazio.")
    .max(30),
  deliveryType: deliveryTypeSchema,
  address: z
    .object({
      street: z.string().trim().min(2).max(120),
      number: z.string().trim().min(1).max(20),
      complement: z.string().trim().max(80).nullish(),
      reference: z.string().trim().max(120).nullish(),
      neighborhood: z.string().trim().max(80).nullish(),
    })
    .nullish(),
  customerName: z.string().trim().min(2, "Informe o nome.").max(80),
});

export type DraftOrderResult =
  | {
      ok: true;
      lines: { quantity: number; name: string; addons: string[]; totalItemCents: number }[];
      subtotalFormatted: string;
      deliveryFeeFormatted: string;
      totalFormatted: string;
      deliveryType: "DELIVERY" | "PICKUP";
      addressLabel: string | null;
      estimatedMinutes: number | null;
    }
  | { ok: false; error: string };

type Coords = { lat: number; lon: number; city: string };

type Priced =
  | {
      ok: true;
      calc: Extract<CalculateCartResult, { ok: true }>;
      zone: CatalogDeliveryZone | null;
      autoAccept: boolean;
    }
  | { ok: false; error: string };

/** Cálculo oficial no servidor: loja aberta, catálogo atual, frete por distância e pedido mínimo. */
export async function priceCart(
  tenantId: string,
  items: WhatsAppDraftCartItem[],
  deliveryType: "DELIVERY" | "PICKUP",
  coords: Coords | null,
  neighborhood: string | null,
  paymentMethod?: PaymentMethod,
): Promise<Priced> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) return { ok: false, error: "Loja não encontrada." };
  const settings = await loadStoreSettings(tenantId);
  if (!settings) return { ok: false, error: "Loja não encontrada." };

  const status = getStoreStatus({ openingHours: settings.openingHours, isOpenOverride: settings.isOpenOverride });
  if (!status.isOpen) {
    return {
      ok: false,
      error:
        status.reason === "MANUALLY_CLOSED"
          ? "A loja está fechada no momento."
          : "Estamos fora do horário de funcionamento.",
    };
  }

  const catalog = (await loadCatalog(tenantId)).flatMap((c) => c.products);

  let zone: CatalogDeliveryZone | null = null;
  if (deliveryType === "DELIVERY") {
    if (!coords) return { ok: false, error: "Endereço de entrega não localizado." };
    const quote = calculateDeliveryQuote(coords.lat, coords.lon, coords.city);
    if (!quote.deliverable) return { ok: false, error: quote.message };
    const zones = await loadDeliveryZones(tenantId, { includeInactive: true });
    const base = resolveDeliveryZone(zones, neighborhood, OTHER_ZONE_NAME);
    if (!base) return { ok: false, error: "Não foi possível atender este endereço no momento." };
    zone = withQuotedFee(base, quote.feeCents);
  }

  const calc = calculateCart({
    items: items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      addons: (i.addons ?? []).map((a) => ({ addonId: a.addonId, quantity: a.quantity })),
    })),
    catalog,
    deliveryType,
    deliveryZone: zone,
    minOrderCents: effectiveMinOrderCents(tenant.minOrderCents),
    paymentMethod,
  });
  if (!calc.ok) return { ok: false, error: calc.errors.map((e) => e.message).join(" ") };
  return { ok: true, calc, zone, autoAccept: settings.autoAcceptOrders };
}

/** Cliente por telefone; cria (sem senha, telefone já provado pelo próprio WhatsApp) se não existir. */
async function ensureCustomer(tenantId: string, phone: string, name: string) {
  const local = toCustomerPhone(phone);
  if (!local) return null;
  const find = async () => {
    const [row] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.phone, local)))
      .limit(1);
    return row;
  };
  const existing = await find();
  if (existing) return existing;
  await db
    .insert(customers)
    .values({ tenantId, name, phone: local, phoneVerifiedAt: new Date() })
    .onConflictDoNothing();
  return (await find()) ?? null;
}

export async function saveDraftOrder(ctx: ToolContext, input: unknown): Promise<DraftOrderResult> {
  const parsed = draftInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(" ") };
  const data = parsed.data;

  const tenantId = await getTenantId();
  if (!tenantId) return { ok: false, error: "Loja não encontrada." };

  if (data.deliveryType === "DELIVERY" && !data.address) {
    return { ok: false, error: "Falta o endereço (rua e número) para a entrega." };
  }

  /* Endereço: geocodifica no servidor (o frete é por distância). */
  let coords: Coords | null = null;
  let neighborhood: string | null = data.address?.neighborhood ?? null;
  let postalCode: string | null = null;
  if (data.deliveryType === "DELIVERY" && data.address) {
    const geo = await geocodeAddress(data.address.street, data.address.number);
    if (!geo) return { ok: false, error: "Não consegui localizar esse endereço. Confirme rua e número." };
    coords = { lat: geo.lat, lon: geo.lon, city: geo.city };
    neighborhood = geo.neighborhood ?? neighborhood;
    postalCode = geo.postalCode;
  }

  const items: WhatsAppDraftCartItem[] = data.items.map((i) => ({
    productId: i.productId,
    quantity: i.quantity,
    notes: i.notes ?? null,
    addons: i.addons.map((a) => ({ addonId: a.addonId, quantity: a.quantity })),
  }));

  const priced = await priceCart(tenantId, items, data.deliveryType, coords, neighborhood);
  if (!priced.ok) return priced;
  const { calc, zone } = priced;

  let snapshot: AddressSnapshot | null = null;
  if (data.deliveryType === "DELIVERY" && data.address && zone && coords) {
    snapshot = {
      neighborhood: zone.neighborhood,
      street: data.address.street,
      number: data.address.number,
      complement: data.address.complement ?? null,
      reference: data.address.reference ?? null,
      deliveryZoneId: zone.id,
      latitude: coords.lat,
      longitude: coords.lon,
      city: coords.city,
      district: neighborhood,
      postalCode,
    };
  }

  const customer = await ensureCustomer(tenantId, ctx.phone, data.customerName);
  if (!customer) return { ok: false, error: "Telefone inválido." };

  await db
    .insert(whatsappSessions)
    .values({
      phone: ctx.phone,
      customerId: customer.id,
      state: "CONFIRMING_ORDER",
      draftCart: items,
      deliveryAddress: snapshot,
    })
    .onConflictDoUpdate({
      target: whatsappSessions.phone,
      set: {
        customerId: customer.id,
        state: "CONFIRMING_ORDER",
        draftCart: items,
        deliveryAddress: snapshot,
        updatedAt: new Date(),
      },
    });

  return {
    ok: true,
    lines: calc.lines.map((l) => ({
      quantity: l.quantity,
      name: l.productName,
      addons: l.addons.map((a) => `${a.quantity > 1 ? `${a.quantity}x ` : ""}${a.name}`),
      totalItemCents: l.totalItemCents,
    })),
    subtotalFormatted: formatCents(calc.subtotalCents),
    deliveryFeeFormatted: formatCents(calc.deliveryFeeCents),
    totalFormatted: formatCents(calc.totalCents),
    deliveryType: data.deliveryType,
    addressLabel: snapshot ? `${snapshot.street}, ${snapshot.number} - ${snapshot.district ?? snapshot.neighborhood}` : null,
    estimatedMinutes: zone?.estimatedMinutes ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Finalização                                                         */
/* ------------------------------------------------------------------ */

const finalizeInputSchema = z.object({
  paymentMethod: z.enum(["PIX", "CREDIT_CARD", "CARD_ON_DELIVERY", "CASH"]),
  /** CPF/CNPJ: obrigatório para pagar online na primeira vez (exigência do Asaas). */
  documentNumber: z.string().trim().max(18).nullish(),
  changeForCents: z.number().int().positive().nullish(),
});

export type FinalizeResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: number;
      amountFormatted: string;
      paymentMethod: PaymentMethod;
      /** Pix: código Copia e Cola. O agente o envia como mensagem própria; o modelo nunca o vê. */
      pixPayload?: string;
      /** Cartão: página segura de pagamento. */
      checkoutUrl?: string;
      /** Pix: cobrança não criada (Asaas fora); o pedido existe aguardando pagamento. */
      chargeError?: boolean;
    }
  | { ok: false; error: string; needsDocument?: boolean };

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export async function finalizeOrderAndCheckout(ctx: ToolContext, input: unknown): Promise<FinalizeResult> {
  const parsed = finalizeInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Forma de pagamento inválida." };
  const { paymentMethod, changeForCents } = parsed.data;
  const providedDocument = parsed.data.documentNumber ? onlyDigits(parsed.data.documentNumber) : null;

  const tenantId = await getTenantId();
  if (!tenantId) return { ok: false, error: "Loja não encontrada." };

  const [session] = await db
    .select()
    .from(whatsappSessions)
    .where(eq(whatsappSessions.phone, ctx.phone))
    .limit(1);
  const draft = session?.draftCart;
  if (!session || !draft || draft.length === 0 || !session.customerId) {
    return { ok: false, error: "Não há pedido em rascunho. Monte o pedido antes de finalizar." };
  }

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, session.customerId), eq(customers.tenantId, tenantId)))
    .limit(1);
  if (!customer) return { ok: false, error: "Cliente não encontrado." };

  /* CPF informado agora ou já salvo no cadastro pós-pagamento. */
  const documentNumber = providedDocument ?? customer.documentNumber ?? null;
  const online = isOnlinePaymentMethod(paymentMethod);
  if (online && !customer.asaasCustomerId) {
    const err = documentNumber ? documentError(documentNumber) : "Informe o CPF para pagar online.";
    if (err) return { ok: false, error: err, needsDocument: true };
  }
  if (paymentMethod !== "CASH" && changeForCents != null) {
    return { ok: false, error: "Troco só vale para pagamento em dinheiro." };
  }

  /* Recalcula tudo agora (preço/loja podem ter mudado desde o rascunho). Nada vem do modelo. */
  const address = session.deliveryAddress;
  const deliveryType = address ? "DELIVERY" : "PICKUP";
  const coords: Coords | null =
    address && address.latitude != null && address.longitude != null
      ? { lat: address.latitude, lon: address.longitude, city: address.city ?? "" }
      : null;
  const priced = await priceCart(tenantId, draft, deliveryType, coords, address?.district ?? null, paymentMethod);
  if (!priced.ok) return priced;
  const { calc, zone, autoAccept } = priced;

  if (changeForCents != null && changeForCents < calc.totalCents) {
    return { ok: false, error: "O troco precisa ser maior que o total do pedido." };
  }

  /* Reivindica o rascunho de forma atômica: duas finalizações simultâneas não criam dois pedidos. */
  const claimed = await db
    .update(whatsappSessions)
    .set({ draftCart: null })
    .where(and(eq(whatsappSessions.phone, ctx.phone), isNotNull(whatsappSessions.draftCart)))
    .returning({ phone: whatsappSessions.phone });
  if (claimed.length === 0) return { ok: false, error: "Esse pedido já foi finalizado." };

  const restoreDraft = () =>
    db.update(whatsappSessions).set({ draftCart: draft }).where(eq(whatsappSessions.phone, ctx.phone));

  const addressSnapshot: AddressSnapshot | null = address && zone ? { ...address, deliveryZoneId: zone.id, neighborhood: zone.neighborhood } : null;

  if (addressSnapshot) {
    /* Reaproveita o endereço no cadastro (igual ao site). */
    const saved = await db
      .select({ street: customerAddresses.street, number: customerAddresses.number })
      .from(customerAddresses)
      .where(and(eq(customerAddresses.tenantId, tenantId), eq(customerAddresses.customerId, customer.id)));
    const exists = saved.some(
      (a) =>
        a.street.toLowerCase() === addressSnapshot.street.toLowerCase() &&
        a.number.toLowerCase() === addressSnapshot.number.toLowerCase(),
    );
    if (!exists) {
      await db.insert(customerAddresses).values({
        tenantId,
        customerId: customer.id,
        deliveryZoneId: zone?.id ?? null,
        street: addressSnapshot.street,
        number: addressSnapshot.number,
        complement: addressSnapshot.complement,
        reference: addressSnapshot.reference,
      });
    }
  }

  const initialStatus: OrderStatus = online ? "AWAITING_PAYMENT" : autoAccept ? "PREPARING" : "RECEIVED";
  const noteLines = draft
    .map((d, i) => (d.notes ? `${calc.lines[i]?.productName ?? "Item"}: ${d.notes}` : null))
    .filter((n): n is string => n !== null);
  const notes = noteLines.length > 0 ? noteLines.join("\n") : null;

  let created: { orderId: string; orderNumber: number } | null = null;
  try {
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const [row] = await db
        .select({ last: max(orders.orderNumber) })
        .from(orders)
        .where(eq(orders.tenantId, tenantId));
      const orderNumber = (row?.last ?? 100) + 1;
      const orderId = crypto.randomUUID();
      try {
        await db.batch([
          db.insert(orders).values({
            id: orderId,
            tenantId,
            customerId: customer.id,
            orderNumber,
            status: initialStatus,
            deliveryType,
            addressSnapshot,
            paymentMethod,
            changeForCents: paymentMethod === "CASH" ? (changeForCents ?? null) : null,
            subtotalCents: calc.subtotalCents,
            deliveryFeeCents: calc.deliveryFeeCents,
            totalCents: calc.totalCents,
            notes,
            documentNumber,
          }),
          db.insert(orderItems).values(
            calc.lines.map((line) => ({
              tenantId,
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
        if (!isUniqueViolation(error)) throw error; // conflito de order_number: tenta o próximo
      }
    }
  } catch (error) {
    await restoreDraft();
    throw error;
  }
  if (!created) {
    await restoreDraft();
    return { ok: false, error: "Não foi possível registrar o pedido. Tente novamente." };
  }

  await recordTimelineEvent({
    orderId: created.orderId,
    type: "ORDER_CREATED",
    title: "Pedido criado",
    description: `Pedido #${created.orderNumber} criado pelo WhatsApp.`,
    dedupeKey: `${created.orderId}:created`,
  });

  await db
    .update(whatsappSessions)
    .set({ state: online ? "AWAITING_PAYMENT" : "COMPLETED", updatedAt: new Date() })
    .where(eq(whatsappSessions.phone, ctx.phone));

  const base = {
    ok: true as const,
    orderId: created.orderId,
    orderNumber: created.orderNumber,
    amountFormatted: formatCents(calc.totalCents),
    paymentMethod,
  };

  if (!online) {
    /* Saipos nunca bloqueia nem falha a compra. */
    await sendOrderToSaipos(created.orderId).catch(() => undefined);
    return base;
  }

  if (paymentMethod === "CREDIT_CARD") {
    const checkoutUrl = `${appUrl()}/pagamento/${created.orderId}`;
    ctx.afterReply.push(() =>
      sendCtaUrlButton(ctx.phone, `Pedido #${created!.orderNumber} - ${base.amountFormatted}. Toque para pagar com cartão com segurança.`, "Pagar com Cartão", checkoutUrl),
    );
    return { ...base, checkoutUrl };
  }

  try {
    const charge = await createPixCharge({
      order: { id: created.orderId, totalCents: calc.totalCents },
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        asaasCustomerId: customer.asaasCustomerId,
        cpfCnpj: documentNumber,
      },
    });
    ctx.afterReply.push(() => sendTextMessage(ctx.phone, charge.pixPayload));
    return { ...base, pixPayload: charge.pixPayload };
  } catch {
    console.error("[whatsapp-bot] cobrança Pix não criada", { orderId: created.orderId });
    return { ...base, chargeError: true };
  }
}
