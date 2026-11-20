import { createHash } from "node:crypto";

import { and, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/infra/db";
import { customers, orders, whatsappSessions } from "@/infra/db/schema";
import { errorSummary } from "@/infra/whatsapp/log";
import { getBrazilianPhoneVariants } from "@/infra/whatsapp/phone";
import { appUrl } from "@/infra/whatsapp/shared";
import { ATTRIBUTION_COOKIE, sanitizeAttribution, type AdReferral, type Attribution } from "@/lib/attribution";

const AD_REFERRAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Texto livre vindo da Meta/URL: só texto curto. */
const short = (value: unknown, max = 120): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

/** Guarda o anúncio que originou a conversa (mensagem com `referral`). A primeira origem recente é mantida. */
export async function saveAdReferral(phone: string, referral: unknown): Promise<void> {
  if (!referral || typeof referral !== "object") return;
  const r = referral as Record<string, unknown>;
  const value: AdReferral = {
    sourceId: short(r.source_id, 60),
    headline: short(r.headline),
    ctwaClid: short(r.ctwa_clid, 200),
    sourceUrl: short(r.source_url, 300),
    at: new Date().toISOString(),
  };
  if (!value.sourceId && !value.headline && !value.ctwaClid) return;
  await db
    .insert(whatsappSessions)
    .values({ phone, adReferral: value })
    .onConflictDoUpdate({ target: whatsappSessions.phone, set: { adReferral: value } });
}

async function sessionReferral(phone: string): Promise<AdReferral | null> {
  const variants = getBrazilianPhoneVariants(phone);
  if (variants.length === 0) return null;
  const rows = await db
    .select({ adReferral: whatsappSessions.adReferral, phone: whatsappSessions.phone })
    .from(whatsappSessions)
    .where(inArray(whatsappSessions.phone, variants));
  const found = rows.map((r) => r.adReferral).find((r): r is AdReferral => !!r?.at);
  if (!found) return null;
  return Date.now() - new Date(found.at).getTime() <= AD_REFERRAL_DAYS * DAY_MS ? found : null;
}

async function cookieAttribution(): Promise<Attribution | null> {
  try {
    const raw = (await cookies()).get(ATTRIBUTION_COOKIE)?.value;
    if (!raw) return null;
    try {
      return sanitizeAttribution(JSON.parse(raw));
    } catch {
      return sanitizeAttribution(JSON.parse(decodeURIComponent(raw)));
    }
  } catch {
    return null; // fora de uma requisição (webhook/cron) ou cookie inválido
  }
}

/**
 * Origem do pedido: anúncio de clique-para-WhatsApp (se a conversa nasceu dele) > UTM/cliques guardados no navegador >
 * origem padrão do canal. Nunca lança: o pedido não pode falhar por causa de rastreio.
 */
export async function resolveOrderAttribution(opts: {
  channel: "site" | "whatsapp";
  phone?: string | null;
}): Promise<Attribution> {
  try {
    if (opts.phone) {
      const referral = await sessionReferral(opts.phone);
      if (referral) {
        return {
          source: "meta",
          medium: "click_to_whatsapp",
          campaign: referral.headline ?? referral.sourceId,
          content: referral.sourceId,
          channel: opts.channel,
        };
      }
    }
    const fromCookie = await cookieAttribution();
    if (fromCookie) return { ...fromCookie, channel: opts.channel };
  } catch (error) {
    console.error("[marketing] falha ao resolver origem:", errorSummary(error));
  }
  return opts.channel === "site"
    ? { source: "direto", channel: "site" }
    : { source: "whatsapp", medium: "organico", channel: "whatsapp" };
}

const sha256 = (value: string) => createHash("sha256").update(value.trim().toLowerCase()).digest("hex");

/**
 * API de Conversões da Meta: avisa a compra paga do lado do servidor (pega pedidos que o navegador não vê: WhatsApp,
 * pagamento por PIX confirmado depois). Usa o id do pedido como `event_id`: com o evento do Pixel no navegador a Meta
 * conta uma venda só. Precisa de NEXT_PUBLIC_META_PIXEL_ID e META_CAPI_TOKEN; sem eles não faz nada.
 */
export async function sendPurchaseEvent(orderId: string): Promise<void> {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();
  const token = process.env.META_CAPI_TOKEN?.trim();
  if (!pixelId || !token) return;
  try {
    const [row] = await db
      .select({
        total: orders.totalCents,
        createdAt: orders.createdAt,
        attribution: orders.attribution,
        phone: customers.phone,
        name: customers.name,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!row) return;
    const intl = getBrazilianPhoneVariants(row.phone).find((v) => v.startsWith("55"));
    const attr = sanitizeAttribution(row.attribution);
    const userData: Record<string, unknown> = {};
    if (intl) userData.ph = [sha256(intl)];
    const first = row.name.trim().split(/\s+/)[0];
    if (first) userData.fn = [sha256(first)];
    if (attr?.fbp) userData.fbp = attr.fbp;
    if (attr?.fbclid) userData.fbc = `fb.1.${row.createdAt.getTime()}.${attr.fbclid}`;

    const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(pixelId)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: token,
        data: [
          {
            event_name: "Purchase",
            event_time: Math.floor(Date.now() / 1000),
            event_id: orderId,
            action_source: "website",
            event_source_url: appUrl(),
            user_data: userData,
            custom_data: { currency: "BRL", value: row.total / 100 },
          },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error("[marketing] API de Conversões recusou:", res.status);
  } catch (error) {
    console.error("[marketing] falha na API de Conversões:", errorSummary(error));
  }
}

export type SalesBySource = {
  source: string;
  medium: string;
  campaign: string;
  orders: number;
  revenueCents: number;
};

/** Vendas (pedidos válidos) por origem/campanha nos últimos `days` dias. */
export async function getSalesBySource(tenantId: string, days = 30): Promise<SalesBySource[]> {
  const since = new Date(Date.now() - days * DAY_MS);
  const source = sql<string>`coalesce(${orders.attribution}->>'source', 'sem origem')`;
  const medium = sql<string>`coalesce(${orders.attribution}->>'medium', '')`;
  const campaign = sql<string>`coalesce(${orders.attribution}->>'campaign', '')`;
  const rows = await db
    .select({
      source,
      medium,
      campaign,
      orders: sql<number>`count(*)::int`,
      revenueCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, tenantId),
        gte(orders.createdAt, since),
        notInArray(orders.status, ["CANCELED", "AWAITING_PAYMENT"]),
      ),
    )
    .groupBy(source, medium, campaign)
    .orderBy(sql`sum(${orders.totalCents}) desc`);
  return rows;
}
