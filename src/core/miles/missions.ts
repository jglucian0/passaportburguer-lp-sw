/**
 * Missões do programa de milhas (regras puras): "Peça 3x no mês", "Peça 2x na semana".
 * O progresso sai dos pedidos válidos do período; ao bater a meta, o bônus é pago uma vez por período.
 */

export type MissionPeriod = "WEEK" | "MONTH";

export type MissionRule = {
  period: MissionPeriod;
  targetOrders: number;
  /** Só contam pedidos com itens (já com desconto) a partir deste valor. */
  minOrderCents: number;
};

export type PeriodRange = {
  /** Início (inclusive) em UTC. */
  start: Date;
  /** Fim (exclusivo) em UTC. */
  end: Date;
  /** Identifica o período: "2026-W47" ou "2026-11". É o que impede pagar o mesmo bônus duas vezes. */
  key: string;
};

const SP_OFFSET_HOURS = 3; // America/Sao_Paulo = UTC-3 (sem horário de verão desde 2019)

function localParts(now: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayIndex: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday: weekdayIndex[get("weekday")] ?? 0 };
}

/** Meia-noite de Brasília daquele dia, em UTC. */
const localMidnightUtc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day, SP_OFFSET_HOURS, 0, 0));

/** Semana = segunda a domingo; mês = mês civil. Sempre no horário de Brasília. */
export function periodRange(period: MissionPeriod, now: Date = new Date()): PeriodRange {
  const { year, month, day, weekday } = localParts(now);
  if (period === "MONTH") {
    return {
      start: localMidnightUtc(year, month, 1),
      end: localMidnightUtc(year, month + 1, 1),
      key: `${year}-${String(month).padStart(2, "0")}`,
    };
  }
  const sinceMonday = (weekday + 6) % 7;
  const start = localMidnightUtc(year, month, day - sinceMonday);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  // Semana ISO simplificada: ano e nº da semana pela quinta-feira daquela semana.
  const thursday = new Date(start.getTime() + 3 * 24 * 60 * 60 * 1000);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.floor((thursday.getTime() - yearStart) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return { start, end, key: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}` };
}

export type CountableOrder = { createdAt: Date; itemsAfterDiscountCents: number };

export type MissionProgress = { done: number; target: number; completed: boolean; range: PeriodRange };

/** Quantos pedidos do período contam para a missão e se ela foi cumprida. */
export function missionProgress(rule: MissionRule, orders: CountableOrder[], now: Date = new Date()): MissionProgress {
  const range = periodRange(rule.period, now);
  const done = orders.filter(
    (o) =>
      o.createdAt.getTime() >= range.start.getTime() &&
      o.createdAt.getTime() < range.end.getTime() &&
      o.itemsAfterDiscountCents >= rule.minOrderCents,
  ).length;
  return { done: Math.min(done, rule.targetOrders), target: rule.targetOrders, completed: done >= rule.targetOrders, range };
}
