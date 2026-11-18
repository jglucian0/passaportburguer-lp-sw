import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { calculateCart, type CalculateCartResult } from "@/core/cart/calculate-cart";
import { calculateDeliveryQuote, resolveDeliveryZone, withQuotedFee } from "@/core/delivery/quote";
import { cartItemInputSchema } from "@/core/schemas/cart";
import { deliveryTypeSchema } from "@/core/schemas/common";
import { OTHER_ZONE_NAME } from "@/core/store/maringa-zones";
import { documentError, onlyDigits } from "@/core/validation/document";
import { db } from "@/infra/db";
import { loadCatalog, loadDeliveryZones } from "@/infra/db/queries";
import {
  customers,
  whatsappSessions,
  type AddressSnapshot,
  type PaymentMethod,
  type WhatsAppDraftCartItem,
} from "@/infra/db/schema";
import { formatCents } from "@/lib/utils";

import { geocodeAddress } from "./geocode";
import { ensureCustomer, finalizeOrderAndCheckout, priceCart, type Coords, type FinalizeResult } from "./order-flow";
import { isCheckoutReady, nextStep } from "./session-rules";
import { getTenantId, type ToolContext } from "./shared";
import { getCustomerContext } from "./customer-context";

/* ------------------------------------------------------------------ */
/* Sessão                                                              */
/* ------------------------------------------------------------------ */

async function loadSessionRow(phone: string) {
  const [row] = await db.select().from(whatsappSessions).where(eq(whatsappSessions.phone, phone)).limit(1);
  return row ?? null;
}

/** Zera o pedido e abre uma nova sessão: o histórico anterior deixa de contaminar o próximo pedido. */
export async function resetSession(phone: string): Promise<void> {
  await db
    .update(whatsappSessions)
    .set({
      draftCart: [],
      addressConfirmed: false,
      paymentMethod: null,
      state: "IDLE",
      sessionStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(whatsappSessions.phone, phone));
}

/* ------------------------------------------------------------------ */
/* updateCart                                                          */
/* ------------------------------------------------------------------ */

const updateCartSchema = z.object({
  items: z
    .array(cartItemInputSchema.extend({ notes: z.string().trim().max(200).nullish() }))
    .min(1, "Carrinho vazio.")
    .max(30),
  /** Observação geral do pedido: vale para os itens que não têm observação própria. */
  notes: z.string().trim().max(200).nullish(),
});

const summarize = (calc: Extract<CalculateCartResult, { ok: true }>) => ({
  lines: calc.lines.map((l) => ({
    quantity: l.quantity,
    name: l.productName,
    addons: l.addons.map((a) => `${a.quantity > 1 ? `${a.quantity}x ` : ""}${a.name}`),
    totalItemCents: l.totalItemCents,
  })),
  subtotalCents: calc.subtotalCents,
  subtotalFormatted: formatCents(calc.subtotalCents),
});

export type UpdateCartResult =
  | ({ ok: true; nextStep: ReturnType<typeof nextStep> } & ReturnType<typeof summarize>)
  | { ok: false; error: string };

/**
 * Sobrescreve o carrinho da sessão. Cada item é validado contra o catálogo REAL (produto/adicional
 * inexistente ou indisponível é recusado) e os valores são calculados aqui, em centavos.
 */
export async function updateCartTool(ctx: ToolContext, input: unknown): Promise<UpdateCartResult> {
  const parsed = updateCartSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(" ") };
  const { items: rawItems, notes } = parsed.data;

  const tenantId = await getTenantId();
  if (!tenantId) return { ok: false, error: "Loja não encontrada." };

  const items: WhatsAppDraftCartItem[] = rawItems.map((i) => ({
    productId: i.productId,
    quantity: i.quantity,
    notes: i.notes || notes || null,
    addons: i.addons.map((a) => ({ addonId: a.addonId, quantity: a.quantity })),
  }));

  const catalog = (await loadCatalog(tenantId)).flatMap((c) => c.products);
  const calc = calculateCart({
    items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, addons: i.addons ?? [] })),
    catalog,
    deliveryType: "PICKUP",
    deliveryZone: null,
    minOrderCents: 0, // pedido mínimo e frete são conferidos com o endereço, no fechamento
  });
  if (!calc.ok) return { ok: false, error: calc.errors.map((e) => e.message).join(" ") };

  const session = await loadSessionRow(ctx.phone);
  const state = "CONFIRMING_ORDER" as const;
  await db
    .insert(whatsappSessions)
    .values({ phone: ctx.phone, state, draftCart: items })
    .onConflictDoUpdate({
      target: whatsappSessions.phone,
      set: { state, draftCart: items, updatedAt: new Date() },
    });

  return {
    ok: true,
    nextStep: nextStep({
      draftCart: items,
      addressConfirmed: session?.addressConfirmed ?? false,
      paymentMethod: session?.paymentMethod ?? null,
    }),
    ...summarize(calc),
  };
}

/* ------------------------------------------------------------------ */
/* setDeliveryAndPayment                                               */
/* ------------------------------------------------------------------ */

const addressSchema = z.object({
  street: z.string().trim().min(2).max(120),
  number: z.string().trim().min(1).max(20),
  complement: z.string().trim().max(80).nullish(),
  reference: z.string().trim().max(120).nullish(),
  neighborhood: z.string().trim().max(80).nullish(),
});
type AddressInput = z.infer<typeof addressSchema>;

const deliveryPaymentSchema = z.object({
  deliveryType: deliveryTypeSchema,
  address: addressSchema.nullish(),
  /** O cliente confirmou (ou acabou de informar) o endereço: não perguntar de novo. */
  addressConfirmed: z.boolean(),
  paymentMethod: z.enum(["PIX", "CREDIT_CARD", "CARD_ON_DELIVERY", "CASH"]).nullish(),
  /** Só para cliente novo (cria o cadastro). */
  customerName: z.string().trim().min(2).max(80).nullish(),
  /** CPF, só quando o checkout pedir (needsDocument). */
  documentNumber: z.string().trim().max(18).nullish(),
});

async function buildSnapshot(
  tenantId: string,
  address: AddressInput,
): Promise<{ ok: true; snapshot: AddressSnapshot; coords: Coords } | { ok: false; error: string }> {
  const geo = await geocodeAddress(address.street, address.number);
  if (!geo) return { ok: false, error: "Não consegui localizar esse endereço. Confirme rua e número." };
  const quote = calculateDeliveryQuote(geo.lat, geo.lon, geo.city);
  if (!quote.deliverable) return { ok: false, error: quote.message };
  const zones = await loadDeliveryZones(tenantId, { includeInactive: true });
  const neighborhood = geo.neighborhood ?? address.neighborhood ?? null;
  const base = resolveDeliveryZone(zones, neighborhood, OTHER_ZONE_NAME);
  if (!base) return { ok: false, error: "Não foi possível atender este endereço no momento." };
  const zone = withQuotedFee(base, quote.feeCents);
  return {
    ok: true,
    coords: { lat: geo.lat, lon: geo.lon, city: geo.city },
    snapshot: {
      neighborhood: zone.neighborhood,
      street: address.street,
      number: address.number,
      complement: address.complement ?? null,
      reference: address.reference ?? null,
      deliveryZoneId: zone.id,
      latitude: geo.lat,
      longitude: geo.lon,
      city: geo.city,
      district: neighborhood,
      postalCode: geo.postalCode,
    },
  };
}

export type SetDeliveryResult =
  | {
      ok: true;
      deliveryType: "DELIVERY" | "PICKUP";
      addressConfirmed: boolean;
      addressLabel: string | null;
      paymentMethod: PaymentMethod | null;
      nextStep: ReturnType<typeof nextStep>;
      pricing: (ReturnType<typeof summarize> & { deliveryFeeFormatted: string; totalFormatted: string; estimatedMinutes: number | null }) | null;
    }
  | { ok: false; error: string };

/**
 * Grava entrega, endereço, confirmação e pagamento na sessão (estado explícito, sem depender do histórico).
 * Retirada = endereço nulo + confirmado. Entrega confirmada sem endereço usa o endereço salvo do cliente.
 */
export async function setDeliveryAndPaymentTool(ctx: ToolContext, input: unknown): Promise<SetDeliveryResult> {
  const parsed = deliveryPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(" ") };
  const data = parsed.data;

  const tenantId = await getTenantId();
  if (!tenantId) return { ok: false, error: "Loja não encontrada." };

  const customer = await ensureCustomer(tenantId, ctx.phone, data.customerName ?? null);
  if (!customer) return { ok: false, error: "Cliente novo: pergunte o nome e informe em customerName." };

  if (data.documentNumber) {
    const digits = onlyDigits(data.documentNumber);
    const err = documentError(digits);
    if (err) return { ok: false, error: err };
    await db
      .update(customers)
      .set({ documentNumber: digits })
      .where(and(eq(customers.id, customer.id), eq(customers.tenantId, tenantId)));
  }

  const session = await loadSessionRow(ctx.phone);
  const cart = session?.draftCart ?? [];

  let snapshot: AddressSnapshot | null = null;
  let coords: Coords | null = null;
  let addressConfirmed = data.addressConfirmed;

  if (data.deliveryType === "PICKUP") {
    addressConfirmed = true;
  } else {
    let toGeocode: AddressInput | null = data.address ?? null;
    if (!toGeocode && data.addressConfirmed && !session?.deliveryAddress) {
      // Cliente cadastrado confirmou o endereço salvo.
      const known = await getCustomerContext(ctx.phone);
      if (known.isRegistered && known.defaultAddress) toGeocode = known.defaultAddress;
    }
    if (toGeocode) {
      const built = await buildSnapshot(tenantId, toGeocode);
      if (!built.ok) return built;
      snapshot = built.snapshot;
      coords = built.coords;
    } else if (session?.deliveryAddress) {
      snapshot = session.deliveryAddress;
      coords =
        snapshot.latitude != null && snapshot.longitude != null
          ? { lat: snapshot.latitude, lon: snapshot.longitude, city: snapshot.city ?? "" }
          : null;
    } else {
      return { ok: false, error: "Falta o endereço (rua e número) para a entrega." };
    }
  }

  const paymentMethod = data.paymentMethod ?? session?.paymentMethod ?? null;

  /* Com carrinho, confere loja aberta / área / pedido mínimo e devolve os valores oficiais. */
  let pricing: Extract<SetDeliveryResult, { ok: true }>["pricing"] = null;
  if (cart.length > 0) {
    const priced = await priceCart(
      tenantId,
      cart,
      data.deliveryType,
      coords,
      snapshot?.district ?? snapshot?.neighborhood ?? null,
      paymentMethod ?? undefined,
    );
    if (!priced.ok) return priced;
    pricing = {
      ...summarize(priced.calc),
      deliveryFeeFormatted: formatCents(priced.calc.deliveryFeeCents),
      totalFormatted: formatCents(priced.calc.totalCents),
      estimatedMinutes: priced.zone?.estimatedMinutes ?? null,
    };
  }

  const state = cart.length > 0 ? ("CONFIRMING_ORDER" as const) : ("BROWSING" as const);
  const fields = {
    customerId: customer.id,
    state,
    deliveryAddress: snapshot,
    addressConfirmed,
    paymentMethod,
  };
  await db
    .insert(whatsappSessions)
    .values({ phone: ctx.phone, ...fields })
    .onConflictDoUpdate({ target: whatsappSessions.phone, set: { ...fields, updatedAt: new Date() } });

  return {
    ok: true,
    deliveryType: data.deliveryType,
    addressConfirmed,
    addressLabel: snapshot ? `${snapshot.street}, ${snapshot.number} - ${snapshot.district ?? snapshot.neighborhood}` : null,
    paymentMethod,
    nextStep: nextStep({ draftCart: cart, addressConfirmed, paymentMethod }),
    pricing,
  };
}

/* ------------------------------------------------------------------ */
/* Checkout automático (determinístico)                                */
/* ------------------------------------------------------------------ */

export type AutoCheckoutOutcome =
  | { status: "not-ready" }
  | { status: "done"; result: Extract<FinalizeResult, { ok: true }> }
  | { status: "failed"; error: string; needsDocument: boolean };

/**
 * Carrinho + endereço confirmado + pagamento escolhidos? O backend fecha o pedido AGORA, na mesma
 * execução, sem pedir nova confirmação ao cliente.
 */
export async function runAutoCheckout(ctx: ToolContext): Promise<AutoCheckoutOutcome> {
  const session = await loadSessionRow(ctx.phone);
  if (!session || !isCheckoutReady(session)) return { status: "not-ready" };
  try {
    const result = await finalizeOrderAndCheckout(ctx, {});
    return result.ok
      ? { status: "done", result }
      : { status: "failed", error: result.error, needsDocument: result.needsDocument ?? false };
  } catch (error) {
    console.error("[whatsapp-bot] falha no checkout automático:", error instanceof Error ? error.message : "erro");
    return { status: "failed", error: "Não foi possível registrar o pedido agora.", needsDocument: false };
  }
}

/** Mensagem de fechamento escrita pelo backend (único texto, além do botão, que carrega link). */
export function checkoutMessage(r: Extract<FinalizeResult, { ok: true }>): string {
  const head = `Pedido #${r.orderNumber} confirmado! Total ${r.amountFormatted}.`;
  switch (r.paymentMethod) {
    case "PIX":
      return r.chargeError
        ? `${head} Não consegui gerar o Pix agora. Quer que eu tente de novo ou chamo um atendente?`
        : `${head} Assim que o Pix cair, ele vai pra chapa. O código copia e cola vem na próxima mensagem 👇`;
    case "CREDIT_CARD":
      return `${head} Toque no botão pra pagar com cartão e ele vai pra chapa 👇`;
    default:
      return r.deliveryType === "PICKUP"
        ? `${head} Já foi pra chapa! Você paga na retirada.`
        : `${head} Já foi pra chapa! Você paga na entrega.`;
  }
}
