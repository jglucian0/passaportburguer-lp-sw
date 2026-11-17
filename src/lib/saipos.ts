import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/infra/db";
import { addons, customers, orderItems, orders, products } from "@/infra/db/schema";
import { loadStoreSettings } from "@/infra/db/store-settings";

/**
 * Integração com a Saipos Order API (https://order-api.saipos.com).
 *
 * Campos conforme saipos-docs-order-api.readme.io (criar-pedido, formas-de-pagamento).
 * Auth: POST /auth {idPartner, secret}; o token vai cru no header Authorization e vale 2 dias.
 */

const CHANNEL_NAME = "Passaporte Burguer";
const REQUEST_TIMEOUT_MS = 8_000;
const TOKEN_SAFETY_MARGIN_MS = 60_000;
/** Caso a API não informe a validade do token. */
const DEFAULT_TOKEN_TTL_MS = 24 * 60 * 60_000;

type SaiposConfig = {
  baseUrl: string;
  partnerId: string;
  secret: string;
  storeId: string;
};

export type SaiposSyncResult =
  | { ok: true; saiposOrderId: string | null }
  | { ok: false; skipped?: boolean; error: string };

function readConfig(): SaiposConfig | null {
  const partnerId = process.env.SAIPOS_PARTNER_ID;
  const secret = process.env.SAIPOS_SECRET;
  const storeId = process.env.SAIPOS_STORE_ID;
  if (!partnerId || !secret || !storeId) return null;
  const baseUrl = (process.env.SAIPOS_API_URL || "https://order-api.saipos.com").replace(/\/+$/, "");
  return { baseUrl, partnerId, secret, storeId };
}

/* ------------------------------------------------------------------ */
/* Token (cache em memória por instância serverless)                    */
/* ------------------------------------------------------------------ */

let tokenCache: { token: string; expiresAt: number } | null = null;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

async function readErrorBody(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.slice(0, 500) || response.statusText;
}

function pickString(source: Record<string, unknown> | null, keys: string[]): string | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

async function getAccessToken(config: SaiposConfig, forceRefresh = false): Promise<string> {
  if (!forceRefresh && tokenCache && tokenCache.expiresAt > Date.now() + TOKEN_SAFETY_MARGIN_MS) {
    return tokenCache.token;
  }

  const response = await fetchWithTimeout(`${config.baseUrl}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ idPartner: config.partnerId, secret: config.secret }),
  });
  if (!response.ok) {
    throw new Error(`Saipos auth HTTP ${response.status}: ${await readErrorBody(response)}`);
  }

  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const token = pickString(json, ["token", "access_token", "accessToken"]);
  if (!token) throw new Error("Saipos auth: resposta sem token.");

  const expiresInSeconds = Number(json?.expires_in ?? json?.expiresIn);
  const ttl =
    Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds * 1000 : DEFAULT_TOKEN_TTL_MS;
  tokenCache = { token, expiresAt: Date.now() + ttl };
  return token;
}

/* ------------------------------------------------------------------ */
/* Payload                                                              */
/* ------------------------------------------------------------------ */

const toReais = (cents: number) => Math.round(cents) / 100;

async function buildPayload(orderId: string, config: SaiposConfig) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) throw new Error("Pedido não encontrado.");

  const [customer] = await db.select().from(customers).where(eq(customers.id, order.customerId)).limit(1);
  const settings = await loadStoreSettings(order.tenantId);
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));

  /* Códigos PDV (produtos e adicionais). */
  const productIds = items.map((i) => i.productId).filter((id): id is string => !!id);
  const addonIds = items
    .flatMap((i) => i.addonsSnapshot.map((a) => a.addon_id))
    .filter((id): id is string => !!id);

  const productCodes = new Map<string, string | null>();
  if (productIds.length > 0) {
    const rows = await db
      .select({ id: products.id, code: products.saiposCode })
      .from(products)
      .where(and(eq(products.tenantId, order.tenantId), inArray(products.id, productIds)));
    for (const r of rows) productCodes.set(r.id, r.code);
  }
  const addonCodes = new Map<string, string | null>();
  if (addonIds.length > 0) {
    const rows = await db
      .select({ id: addons.id, code: addons.saiposCode })
      .from(addons)
      .where(and(eq(addons.tenantId, order.tenantId), inArray(addons.id, addonIds)));
    for (const r of rows) addonCodes.set(r.id, r.code);
  }

  const isDelivery = order.deliveryType === "DELIVERY";
  const address = order.addressSnapshot;
  const createdAt = order.createdAt.toISOString();
  const notes = [`[${CHANNEL_NAME}]`, order.notes].filter(Boolean).join(" ");

  return {
    order_id: order.id,
    display_id: String(order.orderNumber),
    cod_store: config.storeId,
    created_at: createdAt,
    notes,
    total_discount: 0,
    total_amount: toReais(order.totalCents),
    customer: {
      id: order.customerId,
      name: customer?.name ?? "Cliente",
      phone: customer?.phone ?? "",
      ...(customer?.email ? { email: customer.email } : {}),
      ...(order.documentNumber ? { document_number: order.documentNumber } : {}),
    },
    order_method: isDelivery
      ? {
          mode: "DELIVERY",
          // Entrega própria: o restaurante entrega (exige delivery_address).
          delivery_by: "RESTAURANT",
          delivery_fee: toReais(order.deliveryFeeCents),
          scheduled: false,
          delivery_date_time: createdAt,
        }
      : { mode: "TAKEOUT", scheduled: false, delivery_date_time: createdAt },
    ...(isDelivery && address
      ? {
          delivery_address: {
            country: "BR",
            state: process.env.SAIPOS_DEFAULT_STATE || "PR",
            city: settings?.deliveryRules.city ?? "",
            district: address.neighborhood,
            street_name: address.street,
            street_number: address.number,
            // O checkout não guarda CEP; a Saipos o marca como obrigatório (ver SAIPOS_DEFAULT_POSTAL_CODE).
            postal_code: process.env.SAIPOS_DEFAULT_POSTAL_CODE || "",
            complement: address.complement ?? "",
            reference: address.reference ?? "",
            ...(address.latitude != null && address.longitude != null
              ? { coordinates: { latitude: address.latitude, longitude: address.longitude } }
              : {}),
          },
        }
      : {}),
    items: items.map((item) => ({
      // integration_code é obrigatório na Saipos: sem saiposCode cadastrado, cai no id interno.
      integration_code: (item.productId && productCodes.get(item.productId)) || item.productId || "SEM_CODIGO",
      desc_item: item.productNameSnapshot,
      quantity: item.quantity,
      unit_price: toReais(item.unitPriceCentsSnapshot),
      notes: "",
      choice_items: item.addonsSnapshot.map((a) => ({
        integration_code: (a.addon_id && addonCodes.get(a.addon_id)) || a.addon_id || "SEM_CODIGO",
        desc_item_choice: a.name,
        aditional_price: toReais(a.price_cents),
        quantity: a.quantity,
        notes: "",
      })),
    })),
    payment_types: [buildPayment(order.paymentMethod, order.totalCents, order.changeForCents)],
  };
}

function buildPayment(method: "PIX" | "CARD_ON_DELIVERY" | "CASH", totalCents: number, changeForCents: number | null) {
  const amount = toReais(totalCents);
  switch (method) {
    case "PIX":
      // PIX é pago online no nosso site; só é enviado após a confirmação do pagamento.
      return { code: "PARTNER_PAYMENT", amount, change_for: 0, complement: "pix", type: "ONLINE" };
    case "CARD_ON_DELIVERY":
      return { code: "CARD", amount, change_for: 0, type: "OFFLINE" };
    case "CASH":
      return { code: "DIN", amount, change_for: changeForCents ? toReais(changeForCents) : 0, type: "OFFLINE" };
  }
}

/* ------------------------------------------------------------------ */
/* Envio                                                                */
/* ------------------------------------------------------------------ */

async function postOrder(config: SaiposConfig, payload: unknown): Promise<Response> {
  const send = async (forceRefresh: boolean) =>
    fetchWithTimeout(`${config.baseUrl}/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: await getAccessToken(config, forceRefresh),
      },
      body: JSON.stringify(payload),
    });

  const response = await send(false);
  // Token expirado/invalidado no servidor: renova uma vez e repete.
  return response.status === 401 ? send(true) : response;
}

type SyncValues = Partial<
  Pick<typeof orders.$inferInsert, "saiposSyncStatus" | "saiposOrderId" | "saiposLastError" | "saiposSyncedAt">
>;

async function markSync(orderId: string, values: SyncValues) {
  await db.update(orders).set(values).where(eq(orders.id, orderId));
}

/**
 * Envia o pedido ao Saipos. Nunca lança: o resultado fica em `orders.saipos_*`
 * e a compra do cliente jamais depende dessa chamada. Idempotente (ignora pedidos já SYNCED).
 */
export async function sendOrderToSaipos(orderId: string): Promise<SaiposSyncResult> {
  try {
    const config = readConfig();
    if (!config) {
      await markSync(orderId, { saiposSyncStatus: "DISABLED", saiposLastError: null });
      return { ok: false, skipped: true, error: "Integração Saipos não configurada." };
    }

    const [current] = await db
      .select({ status: orders.saiposSyncStatus, saiposOrderId: orders.saiposOrderId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!current) return { ok: false, error: "Pedido não encontrado." };
    if (current.status === "SYNCED") return { ok: true, saiposOrderId: current.saiposOrderId };

    const payload = await buildPayload(orderId, config);
    const response = await postOrder(config, payload);
    if (!response.ok) {
      throw new Error(`Saipos HTTP ${response.status}: ${await readErrorBody(response)}`);
    }

    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    // Se a Saipos não devolver id próprio, o nosso order_id é a referência.
    const saiposOrderId = pickString(json, ["order_id", "id", "id_order", "orderId"]) ?? orderId;

    await markSync(orderId, {
      saiposSyncStatus: "SYNCED",
      saiposOrderId,
      saiposLastError: null,
      saiposSyncedAt: new Date(),
    });
    return { ok: true, saiposOrderId };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    console.error(`[saipos] falha ao enviar pedido ${orderId}:`, message);
    try {
      await markSync(orderId, { saiposSyncStatus: "FAILED", saiposLastError: message });
    } catch (dbError) {
      console.error("[saipos] falha ao registrar erro:", dbError);
    }
    return { ok: false, error: message };
  }
}
