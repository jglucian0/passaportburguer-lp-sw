import { and, eq, inArray, max, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";

import { calculateCart, couponDiscountCents, type CalculateCartResult, type CartCoupon } from "@/core/cart/calculate-cart";
import { calculateDeliveryQuote, resolveDeliveryZone, withQuotedFee } from "@/core/delivery/quote";
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
import { consumeOrderCoupon, findPersonalCoupons } from "@/infra/coupons";
import { sendOrderToSaipos } from "@/lib/saipos";
import { formatCents } from "@/lib/utils";

import { getBrazilianPhoneVariants } from "./phone";
import { checkoutUrl, getTenantId, toCustomerPhone, type ToolContext } from "./shared";

export type Coords = { lat: number; lon: number; city: string };

type Priced =
  | {
      ok: true;
      calc: Extract<CalculateCartResult, { ok: true }>;
      zone: CatalogDeliveryZone | null;
      autoAccept: boolean;
      /** Cupom que entrou no cálculo (null = nenhum ou não atingiu o mínimo). */
      coupon: { id: string; code: string } | null;
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
  personalCoupons: { couponId: string; coupon: CartCoupon }[] = [],
  changeForCents?: number | null,
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

  const calculate = (coupon: CartCoupon | null) =>
    calculateCart({
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
      changeForCents,
      coupon,
    });
  // Sem cupom primeiro: dá o subtotal real e valida o carrinho.
  let calc = calculate(null);
  if (!calc.ok) return { ok: false, error: calc.errors.map((e) => e.message).join(" ") };

  // Um só cupom por fechamento: o de MAIOR desconto entre os que o pedido alcança (nunca soma).
  let appliedCoupon: { id: string; code: string } | null = null;
  const subtotal = calc.subtotalCents;
  const best = personalCoupons
    .filter((c) => subtotal >= c.coupon.minOrderCents)
    .map((c) => ({ c, discount: couponDiscountCents(subtotal, c.coupon) }))
    .filter((x) => x.discount > 0)
    .sort((a, b) => b.discount - a.discount)[0];
  if (best) {
    const withCoupon = calculate(best.c.coupon);
    if (withCoupon.ok) {
      calc = withCoupon;
      appliedCoupon = { id: best.c.couponId, code: best.c.coupon.code };
    }
  }
  return { ok: true, calc, zone, autoAccept: settings.autoAcceptOrders, coupon: appliedCoupon };
}

/** Cliente por telefone; cria (sem senha, telefone já provado pelo próprio WhatsApp) se não existir. */
export async function ensureCustomer(tenantId: string, phone: string, name: string | null) {
  const local = toCustomerPhone(phone);
  if (!local) return null;
  // Com e sem o 9º dígito: o wa_id da Meta pode divergir de como o cliente se cadastrou.
  const variants = getBrazilianPhoneVariants(phone);
  const find = async () => {
    const [row] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), inArray(customers.phone, variants)))
      .limit(1);
    return row;
  };
  const existing = await find();
  if (existing || !name) return existing ?? null;
  await db
    .insert(customers)
    .values({ tenantId, name, phone: local, phoneVerifiedAt: new Date() })
    .onConflictDoNothing();
  return (await find()) ?? null;
}

/* ------------------------------------------------------------------ */
/* Finalização                                                         */
/* ------------------------------------------------------------------ */

const finalizeInputSchema = z.object({
  /** Omitido: usa a forma de pagamento já gravada na sessão. */
  paymentMethod: z.enum(["PIX", "CREDIT_CARD", "CARD_ON_DELIVERY", "CASH"]).nullish(),
  /** CPF/CNPJ: obrigatório para pagar online na primeira vez (exigência do Asaas). */
  documentNumber: z.string().trim().max(18).nullish(),
  changeForCents: z.number().int().positive().nullish(),
  /** Observações do cliente (Cardápio Rápido), somadas às de cada item. */
  extraNotes: z.string().trim().max(400).nullish(),
  /** Só o Cardápio Rápido: permite pagar na entrega/retirada (cartão na máquina ou dinheiro). O bot segue só online. */
  allowOffline: z.boolean().optional(),
});

export type FinalizeResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: number;
      amountFormatted: string;
      /** Cupom pessoal aplicado (desconto só sobre os itens). */
      couponCode?: string;
      discountFormatted?: string;
      paymentMethod: PaymentMethod;
      deliveryType: "DELIVERY" | "PICKUP";
      /** Pix: código Copia e Cola. O agente o envia como mensagem própria; o modelo nunca o vê. */
      pixPayload?: string;
      /** Cartão: página segura de pagamento. */
      checkoutUrl?: string;
      /** Pix: cobrança não criada (Asaas fora); o pedido existe aguardando pagamento. */
      chargeError?: boolean;
      /** Pagamento na entrega/retirada: o pedido já foi aceito (sem página de pagamento). */
      offline?: boolean;
    }
  | { ok: false; error: string; needsDocument?: boolean };

/** Texto único da mensagem de fechamento (botão "Ir para pagamento"). */
export function checkoutBodyText(r: { orderNumber: number; amountFormatted: string; couponCode?: string; discountFormatted?: string }): string {
  const coupon = r.couponCode && r.discountFormatted ? ` Cupom ${r.couponCode} aplicado (-${r.discountFormatted}).` : "";
  return `Pedido #${r.orderNumber} anotado!${coupon} Total ${r.amountFormatted}. Toque abaixo para escolher como pagar e mandar pra chapa 👇`;
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export async function finalizeOrderAndCheckout(ctx: ToolContext, input: unknown): Promise<FinalizeResult> {
  const parsed = finalizeInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Forma de pagamento inválida." };
  const providedDocument = parsed.data.documentNumber ? onlyDigits(parsed.data.documentNumber) : null;

  const tenantId = await getTenantId();
  if (!tenantId) return { ok: false, error: "Loja não encontrada." };

  const [session] = await db
    .select()
    .from(whatsappSessions)
    .where(eq(whatsappSessions.phone, ctx.phone))
    .limit(1);
  // Pagamento sempre online, escolhido na página (Pix é só o padrão inicial; lá o cliente troca para cartão).
  const requested = parsed.data.paymentMethod ?? session?.paymentMethod ?? null;
  const paymentMethod: PaymentMethod =
    parsed.data.allowOffline && (requested === "CASH" || requested === "CARD_ON_DELIVERY")
      ? requested
      : requested === "CREDIT_CARD"
        ? "CREDIT_CARD"
        : "PIX";
  const online = paymentMethod === "PIX" || paymentMethod === "CREDIT_CARD";
  const changeForCents = paymentMethod === "CASH" ? (parsed.data.changeForCents ?? null) : null;
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

  /* CPF informado agora (válido) ou já salvo no cadastro; senão a página de pagamento o coleta. */
  const providedValid = providedDocument && !documentError(providedDocument) ? providedDocument : null;
  const documentNumber = providedValid ?? customer.documentNumber ?? null;

  /* Recalcula tudo agora (preço/loja podem ter mudado desde o rascunho). Nada vem do modelo. */
  const address = session.deliveryAddress;
  const deliveryType = address ? ("DELIVERY" as const) : ("PICKUP" as const);
  const coords: Coords | null =
    address && address.latitude != null && address.longitude != null
      ? { lat: address.latitude, lon: address.longitude, city: address.city ?? "" }
      : null;
  const personalCoupons = await findPersonalCoupons(tenantId, customer.id).catch(() => []);
  const priced = await priceCart(tenantId, draft, deliveryType, coords, address?.district ?? null, paymentMethod, personalCoupons, changeForCents);
  if (!priced.ok) return priced;
  const { calc, zone, coupon: appliedCoupon, autoAccept } = priced;

  /*
   * Reivindica o rascunho de forma atômica (duas finalizações simultâneas não criam dois pedidos) e já
   * isola a sessão: novo sessionStartedAt, carrinho vazio, endereço/pagamento limpos, estado IDLE.
   */
  const claimed = await db
    .update(whatsappSessions)
    .set({
      draftCart: [],
      addressConfirmed: false,
      paymentMethod: null,
      state: "IDLE",
      sessionStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(whatsappSessions.phone, ctx.phone), sql`jsonb_array_length(${whatsappSessions.draftCart}) > 0`))
    .returning({ phone: whatsappSessions.phone });
  if (claimed.length === 0) return { ok: false, error: "Esse pedido já foi finalizado." };

  const restoreDraft = () =>
    db
      .update(whatsappSessions)
      .set({
        draftCart: draft,
        addressConfirmed: session.addressConfirmed,
        paymentMethod: session.paymentMethod,
        state: session.state,
        sessionStartedAt: session.sessionStartedAt,
      })
      .where(eq(whatsappSessions.phone, ctx.phone));

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
  const allNotes = [parsed.data.extraNotes ?? "", ...noteLines].filter(Boolean);
  const notes = allNotes.length > 0 ? allNotes.join("\n") : null;

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
            changeForCents,
            subtotalCents: calc.subtotalCents,
            deliveryFeeCents: calc.deliveryFeeCents,
            discountCents: calc.discountCents,
            couponId: appliedCoupon?.id ?? null,
            couponCode: appliedCoupon?.code ?? null,
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

  const base = {
    ok: true as const,
    orderId: created.orderId,
    orderNumber: created.orderNumber,
    amountFormatted: formatCents(calc.totalCents),
    ...(appliedCoupon && calc.discountCents > 0
      ? { couponCode: appliedCoupon.code, discountFormatted: formatCents(calc.discountCents) }
      : {}),
    paymentMethod,
    deliveryType,
  };

  /* Pagamento na entrega/retirada: pedido já aceito (cupom consumido e Saipos), sem página de pagamento. */
  if (!online) {
    await consumeOrderCoupon(created.orderId).catch(() => undefined);
    const orderIdToSync = created.orderId;
    after(() => sendOrderToSaipos(orderIdToSync));
    return { ...base, offline: true };
  }

  // Uma única mensagem: botão nativo cta_url para a página de pagamento (token ORDER_PAYMENT, 2 h, sem login).
  const payUrl = checkoutUrl(created.orderId, ctx.phone);
  ctx.cta = {
    buttonText: "Ir para pagamento",
    url: payUrl,
    bodyText: checkoutBodyText(base),
  };
  return { ...base, checkoutUrl: payUrl };
}
