import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/infra/db";
import { addons, customers, orderItems, orders, products, tenants } from "@/infra/db/schema";
import { loadStoreSettings } from "@/infra/db/store-settings";

/**
 * Integração com a Saipos Order API (https://order-api.saipos.com).
 *
 * ATENÇÃO: os nomes dos campos do payload e dos códigos de pagamento ficam concentrados em
 * `buildPayload` e `PAYMENT_CODES` abaixo. Valide-os contra a documentação do portal Saipos
 * Developer no ambiente de homologação (loja 99717) antes de ir para produção.
 */

const CHANNEL_NAME = "Passaporte Burguer";
const REQUEST_TIMEOUT_MS = 8_000;
const TOKEN_SAFETY_MARGIN_MS = 60_000;
/** Caso a API não informe a validade do token. */
const DEFAULT_TOKEN_TTL_MS = 55 * 60_000;

/** Código de forma de pagamento aceito pela Saipos para cada método interno. */
const PAYMENT_CODES = {
  PIX: { code: "PIX", description: "PIX" },
  CARD_ON_DELIVERY: { code: "CARD", description: "Cartão na entrega" },
  CASH: { code: "MON", description: "Dinheiro" },
} as const;

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
  const [tenant] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, order.tenantId))
    .limit(1);
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
  const payment = PAYMENT_CODES[order.paymentMethod];

  return {
    id_store: config.storeId,
    cod_store: config.storeId,
    channel: CHANNEL_NAME,
    store_name: tenant?.name,
    order_id: order.id,
    display_id: String(order.orderNumber),
    created_at: order.createdAt.toISOString(),
    notes: order.notes ?? "",
    order_method: {
      mode: isDelivery ? "DELIVERY" : "TAKEOUT",
      scheduled: false,
      delivery_date_time: order.createdAt.toISOString(),
    },
    customer: {
      id: order.customerId,
      name: customer?.name ?? "Cliente",
      phone: customer?.phone ?? "",
      ...(order.documentNumber ? { document: order.documentNumber } : {}),
    },
    ...(isDelivery && address
      ? {
          delivery_address: {
            country: "BR",
            state: process.env.SAIPOS_DEFAULT_STATE || "PR",
            city: settings?.deliveryRules.city ?? "",
            district: address.neighborhood,
            street: address.street,
            number: address.number,
            complement: address.complement ?? "",
            reference: address.reference ?? "",
            coordinates:
              address.latitude != null && address.longitude != null
                ? { latitude: address.latitude, longitude: address.longitude }
                : undefined,
          },
        }
      : {}),
    delivery_fee: toReais(order.deliveryFeeCents),
    total_discount: 0,
    total_amount: toReais(order.totalCents),
    items: items.map((item) => ({
      integration_code: (item.productId && productCodes.get(item.productId)) || undefined,
      desc_item: item.productNameSnapshot,
      quantity: item.quantity,
      unit_price: toReais(item.unitPriceCentsSnapshot),
      total_price: toReais(item.totalItemCents),
      choices: item.addonsSnapshot.map((a) => ({
        integration_code: (a.addon_id && addonCodes.get(a.addon_id)) || undefined,
        desc_item_choice: a.name,
        quantity: a.quantity,
        aditional_price: toReais(a.price_cents),
      })),
    })),
    payment_types: [
      {
        code: payment.code,
        description: payment.description,
        value: toReais(order.totalCents),
        change_for:
          order.paymentMethod === "CASH" && order.changeForCents ? toReais(order.changeForCents) : undefined,
      },
    ],
  };
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
