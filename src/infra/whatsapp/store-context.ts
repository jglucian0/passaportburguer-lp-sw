import { getStoreStatus, DEFAULT_TIME_ZONE, type OpeningHours } from "@/core/store/opening-hours";
import { effectiveMinOrderCents } from "@/core/store/min-order";
import { db } from "@/infra/db";
import { loadStoreSettings, type StoreSettingsRow } from "@/infra/db/store-settings";
import { milesRewards, tenants } from "@/infra/db/schema";
import { loadMilesConfig } from "@/infra/miles/config";
import { formatCents } from "@/lib/utils";
import { and, asc, eq } from "drizzle-orm";

import { getTenantId } from "./shared";

/** Situação operacional da loja, já em texto, para o prompt do atendente. */
export type StoreContext = { statusText: string; rulesText: string; /** Programa de milhas real (nunca inventar). */ milesText?: string };

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const SHORT_DAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** "18:30" -> "18h30", "18:00" -> "18h". */
export function formatClock(time: string): string {
  const [h, m] = time.split(":");
  return m === "00" ? `${Number(h)}h` : `${Number(h)}h${m}`;
}

function localClock(now: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return { day: SHORT_DAY[get("weekday")] ?? 0, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** Próxima abertura a partir de agora: "hoje às 18h30", "amanhã às 18h" ou "na terça-feira às 18h". */
export function nextOpeningText(openingHours: OpeningHours, now: Date = new Date()): string | null {
  const { day, minutes } = localClock(now);
  for (let offset = 0; offset < 7; offset++) {
    const d = openingHours[String((day + offset) % 7) as keyof OpeningHours];
    if (!d?.enabled) continue;
    if (offset === 0 && toMinutes(d.open) <= minutes) continue; // a janela de hoje já começou/passou
    const when = offset === 0 ? "hoje" : offset === 1 ? "amanhã" : `na ${WEEKDAYS[(day + offset) % 7]}`;
    return `${when} às ${formatClock(d.open)}`;
  }
  return null;
}

/** Horário em que a janela atual fecha (considera a que virou a madrugada), ex.: "23h30". */
function closingTimeNow(openingHours: OpeningHours, now: Date): string | null {
  const { day, minutes } = localClock(now);
  const today = openingHours[String(day) as keyof OpeningHours];
  if (today?.enabled && toMinutes(today.open) <= minutes && (toMinutes(today.close) > minutes || toMinutes(today.close) < toMinutes(today.open))) {
    return formatClock(today.close);
  }
  const yesterday = openingHours[String((day + 6) % 7) as keyof OpeningHours];
  return yesterday?.enabled && toMinutes(yesterday.open) > toMinutes(yesterday.close) ? formatClock(yesterday.close) : null;
}

export function describeStoreStatus(
  settings: Pick<StoreSettingsRow, "openingHours" | "isOpenOverride">,
  now: Date = new Date(),
): string {
  const status = getStoreStatus({ openingHours: settings.openingHours, isOpenOverride: settings.isOpenOverride, now });
  if (status.reason === "MANUALLY_CLOSED") return "Fechada agora (pausa da loja), sem horário de reabertura definido.";
  if (status.isOpen) {
    const closes = status.reason === "OPEN" ? closingTimeNow(settings.openingHours, now) : null;
    return closes ? `Aberta agora, fechamos às ${closes}.` : "Aberta agora.";
  }
  const next = nextOpeningText(settings.openingHours, now);
  return next ? `Fechada agora, abrimos ${next}.` : "Fechada agora (sem horário de abertura cadastrado).";
}

export function describeStoreRules(settings: StoreSettingsRow, minOrderCents: number): string {
  const rules = settings.deliveryRules;
  const fees = rules.bands.map((b) => b.feeCents);
  const feeText = fees.length > 0 ? `frete por distância (de ${formatCents(Math.min(...fees))} a ${formatCents(Math.max(...fees))})` : "frete por distância";
  return [
    "Atendemos só pedidos para agora (não há pedidos agendados).",
    `Tempo médio: cerca de ${settings.estimatedDeliveryMinutes} min (entrega e retirada).`,
    `Entrega só em ${rules.city.replace(/\s*-\s*PR$/i, "")}, até ${rules.maxRadiusKm} km, ${feeText}; também há retirada na loja.`,
    `Pedido mínimo para entrega: ${formatCents(minOrderCents)} (retirada sem mínimo).`,
    "Pagamento online: Pix e cartão de crédito. Na entrega/retirada: Pix, dinheiro e cartões Visa, Mastercard, Elo e Hipercard.",
  ].join(" ");
}

/** Regras REAIS do programa de milhas, para a atendente responder sem inventar. */
async function describeMiles(tenantId: string): Promise<string> {
  const config = await loadMilesConfig(tenantId);
  if (!config.enabled) return "O programa de milhas está desligado no momento: não prometa nem explique milhas.";
  const rewards = await db
    .select({ name: milesRewards.name, milesCost: milesRewards.milesCost })
    .from(milesRewards)
    .where(and(eq(milesRewards.tenantId, tenantId), eq(milesRewards.isActive, true)))
    .orderBy(asc(milesRewards.milesCost))
    .limit(6);
  const list = rewards.length > 0 ? ` Recompensas: ${rewards.map((r) => `${r.name} (${r.milesCost} milhas)`).join(", ")}.` : "";
  return `Programa de milhas ATIVO: cada R$ 1 em itens de pedido pago rende ${config.milesPerReal} milhas (a taxa de entrega não conta). As milhas chegam depois do pagamento, valem ${config.validityMonths} meses e são trocadas por cupons de desconto na página "Minhas milhas" do site (entrando com a conta).${list}`;
}

/** Lê as configurações reais da loja (sem cache: o status muda com o relógio e com a pausa manual). */
export async function loadStoreContext(now: Date = new Date()): Promise<StoreContext | null> {
  const tenantId = await getTenantId();
  if (!tenantId) return null;
  const [settings, [tenant], milesText] = await Promise.all([
    loadStoreSettings(tenantId),
    db.select({ minOrderCents: tenants.minOrderCents }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
    describeMiles(tenantId).catch(() => undefined),
  ]);
  if (!settings) return null;
  return {
    statusText: describeStoreStatus(settings, now),
    rulesText: describeStoreRules(settings, effectiveMinOrderCents(tenant?.minOrderCents ?? 0)),
    ...(milesText ? { milesText } : {}),
  };
}
