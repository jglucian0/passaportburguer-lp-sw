/**
 * Origem do pedido (anúncios, Instagram, Google...). Capturada no navegador a partir dos parâmetros UTM / fbclid / gclid
 * e guardada em cookie por 30 dias (último clique). Sem dependências de servidor: serve ao cliente e ao servidor.
 */

export const ATTRIBUTION_COOKIE = "pb_attr";
export const ATTRIBUTION_DAYS = 30;

export type Attribution = {
  source: string;
  medium?: string;
  campaign?: string;
  content?: string;
  /** Identificadores de clique dos anúncios (Meta / Google): servem para a API de Conversões. */
  fbclid?: string;
  gclid?: string;
  fbp?: string;
  /** Navegador do cliente no pedido do site (a API de Conversões exige para eventos de site). */
  ua?: string;
  /** Onde o pedido nasceu: site, WhatsApp (cardápio rápido / bot) ou balcão. */
  channel?: "site" | "whatsapp" | "balcao";
};

/** Referência de anúncio "Clique para o WhatsApp" gravada na sessão (vale 7 dias). */
export type AdReferral = { sourceId?: string; headline?: string; ctwaClid?: string; sourceUrl?: string; at: string };

const clean = (value: unknown, max = 80): string | undefined => {
  if (typeof value !== "string") return undefined;
  const v = value.trim().slice(0, max);
  return v ? v : undefined;
};

/** Normaliza o que vem de cookie/JSON de terceiros: só campos conhecidos, tamanho limitado. */
export function sanitizeAttribution(raw: unknown): Attribution | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const source = clean(r.source)?.toLowerCase();
  if (!source) return null;
  const channel = r.channel === "site" || r.channel === "whatsapp" || r.channel === "balcao" ? r.channel : undefined;
  return {
    source,
    medium: clean(r.medium)?.toLowerCase(),
    campaign: clean(r.campaign),
    content: clean(r.content),
    fbclid: clean(r.fbclid, 200),
    gclid: clean(r.gclid, 200),
    fbp: clean(r.fbp, 100),
    ua: clean(r.ua, 300),
    channel,
  };
}

/** Lê UTM/cliques de uma query string. Sem nenhum parâmetro de campanha devolve null. */
export function attributionFromSearch(search: string): Attribution | null {
  const p = new URLSearchParams(search);
  const fbclid = clean(p.get("fbclid"), 200);
  const gclid = clean(p.get("gclid"), 200);
  const source = clean(p.get("utm_source")) ?? (fbclid ? "meta" : gclid ? "google" : undefined);
  if (!source) return null;
  return sanitizeAttribution({
    source,
    medium: p.get("utm_medium") ?? (fbclid || gclid ? "paid" : undefined),
    campaign: p.get("utm_campaign"),
    content: p.get("utm_content"),
    fbclid,
    gclid,
  });
}

/** Rótulo legível para relatórios: "instagram / paid / burger-do-mes". */
export function attributionLabel(a: Attribution | null | undefined): string {
  if (!a) return "direto / sem origem";
  return [a.source, a.medium, a.campaign].filter(Boolean).join(" / ");
}
