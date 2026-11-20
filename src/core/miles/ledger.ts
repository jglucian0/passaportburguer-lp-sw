/**
 * Regras puras do programa de milhas (sem banco): quanto um pedido rende e como o saldo é calculado.
 * O saldo nunca é guardado: sai do extrato, com validade e consumo FIFO (as milhas mais antigas saem primeiro).
 */

export type MilesConfig = {
  enabled: boolean;
  milesPerReal: number;
  validityMonths: number;
  rewardCouponValidDays: number;
  /** Milhas pagas uma vez no primeiro pedido pago do cliente (0 = sem bônus). */
  welcomeBonusMiles: number;
  /** Cashback livre: milhas que valem R$ 1,00 de desconto. */
  cashbackMilesPerReal: number;
  /** Cashback livre: mínimo de milhas por resgate. */
  cashbackMinMiles: number;
  /** Teto do desconto de cashback em % dos itens (0 = sem teto). */
  cashbackCapPercent: number;
  /** Pedido mínimo (itens) para usar cupons de milhas. */
  redeemMinOrderCents: number;
  /** Validade renovável: as milhas vencem X dias depois do último pedido pago (0 = desligado). O teto é `validityMonths`. */
  rollingValidityDays: number;
  /** Níveis: janela (dias) em que se contam os pedidos pagos. */
  tierWindowDays: number;
  /** Pedidos pagos na janela para virar Executiva (0 = níveis desligados). */
  executiveMinOrders: number;
  /** Multiplicador da Executiva em % (120 = 1,2x). */
  executiveMultiplierPct: number;
  /** Pedidos pagos na janela para virar Primeira Classe (0 = sem este nível). */
  firstClassMinOrders: number;
  firstClassMultiplierPct: number;
  /** Benefício mensal (Executiva/Primeira Classe): desconto em centavos acima do pedido mínimo. 0 = desligado. */
  tierBenefitCents: number;
  tierBenefitMinOrderCents: number;
  /** Benefício mensal da Primeira Classe: frete grátis. */
  firstClassFreeShipping: boolean;
};

export const DEFAULT_MILES_CONFIG: MilesConfig = {
  enabled: false,
  milesPerReal: 10,
  validityMonths: 12,
  rewardCouponValidDays: 15,
  welcomeBonusMiles: 150,
  cashbackMilesPerReal: 200,
  cashbackMinMiles: 500,
  cashbackCapPercent: 30,
  redeemMinOrderCents: 3500,
  rollingValidityDays: 45,
  tierWindowDays: 90,
  executiveMinOrders: 4,
  executiveMultiplierPct: 120,
  firstClassMinOrders: 10,
  firstClassMultiplierPct: 150,
  tierBenefitCents: 400,
  tierBenefitMinOrderCents: 5000,
  firstClassFreeShipping: true,
};

export type MilesTierName = "TURISTA" | "EXECUTIVA" | "PRIMEIRA_CLASSE";

export const TIER_LABEL: Record<MilesTierName, string> = {
  TURISTA: "Turista",
  EXECUTIVA: "Executiva",
  PRIMEIRA_CLASSE: "Primeira Classe",
};

export type MilesTier = {
  name: MilesTierName;
  multiplierPct: number;
  /** Próximo nível e quantos pedidos faltam na janela (null no topo ou com níveis desligados). */
  next: { name: MilesTierName; ordersNeeded: number; multiplierPct: number } | null;
};

/** Nível do cliente pelos pedidos pagos na janela. Níveis desligados (executiveMinOrders = 0) = sempre Turista 1x. */
export function tierFor(ordersInWindow: number, config: MilesConfig): MilesTier {
  if (config.executiveMinOrders <= 0) return { name: "TURISTA", multiplierPct: 100, next: null };
  const hasFirst = config.firstClassMinOrders > config.executiveMinOrders;
  if (hasFirst && ordersInWindow >= config.firstClassMinOrders) {
    return { name: "PRIMEIRA_CLASSE", multiplierPct: config.firstClassMultiplierPct, next: null };
  }
  if (ordersInWindow >= config.executiveMinOrders) {
    return {
      name: "EXECUTIVA",
      multiplierPct: config.executiveMultiplierPct,
      next: hasFirst
        ? { name: "PRIMEIRA_CLASSE", ordersNeeded: config.firstClassMinOrders - ordersInWindow, multiplierPct: config.firstClassMultiplierPct }
        : null,
    };
  }
  return {
    name: "TURISTA",
    multiplierPct: 100,
    next: { name: "EXECUTIVA", ordersNeeded: config.executiveMinOrders - ordersInWindow, multiplierPct: config.executiveMultiplierPct },
  };
}

/** O aviso de milhas vencendo sai quando faltam tantos dias para a validade renovável acabar (45 - 7 = dia 38). */
export const MILES_REMINDER_LEAD_DAYS = 7;

/** O cashback livre é resgatado em múltiplos desta quantidade de milhas. */
export const CASHBACK_STEP_MILES = 100;

/** Desconto (centavos) de um resgate de cashback: ex.: 500 milhas com 200 milhas = R$ 1 -> R$ 2,50. */
export function cashbackDiscountCents(miles: number, cashbackMilesPerReal: number): number {
  if (miles <= 0 || cashbackMilesPerReal <= 0) return 0;
  return Math.floor((miles * 100) / cashbackMilesPerReal);
}

/** Milhas de um pedido: R$ em itens (já com o desconto do cupom, sem a taxa de entrega) × milhas por R$. */
export function milesForOrder(itemsAfterDiscountCents: number, milesPerReal: number, multiplierPct = 100): number {
  if (itemsAfterDiscountCents <= 0 || milesPerReal <= 0) return 0;
  return Math.floor((itemsAfterDiscountCents * milesPerReal * multiplierPct) / 10_000);
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Código do cupom gerado no resgate. Ex.: MILHAS-7K2QX. */
export function milesCouponCode(random: () => number = Math.random): string {
  let suffix = "";
  for (let i = 0; i < 5; i++) suffix += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return `MILHAS-${suffix}`;
}

/** Validade a partir de uma data, em meses (0 = sem validade). */
export function expiryFrom(date: Date, validityMonths: number): Date | null {
  if (validityMonths <= 0) return null;
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + validityMonths);
  return d;
}

export type LedgerEntry = {
  miles: number;
  createdAt: Date;
  /** Só nos créditos. */
  expiresAt: Date | null;
  /** Crédito de pedido pago: renova a validade de 45 dias. */
  renews?: boolean;
};

export type MilesBalance = {
  /** Milhas que o cliente pode usar agora. */
  available: number;
  /** Milhas que vencem nos próximos `soonDays` dias (parte do disponível). */
  expiringSoon: number;
  /** Quando vence a próxima leva de milhas disponíveis (null se nada vence). */
  nextExpiry: Date | null;
  /** Quando a validade renovável vence o saldo (null se desligada ou sem pedido). Renova a cada pedido pago. */
  lapsesAt: Date | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Saldo disponível. Cada crédito é um "balde" com validade; débitos (resgate, estorno) consomem os baldes
 * mais antigos primeiro. Balde vencido que ainda não tinha sido gasto se perde; o saldo nunca fica negativo.
 */
export function computeBalance(
  entries: LedgerEntry[],
  now: Date = new Date(),
  soonDays = 30,
  rollingDays = 0,
): MilesBalance {
  const sorted = [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const buckets: { remaining: number; expiresAt: Date | null }[] = [];
  let activityAt: number | null = null;
  /** Passou da janela renovável: tudo o que havia vence (milhas que vencem não voltam com um pedido novo). */
  const lapseIfDue = (at: number) => {
    if (rollingDays > 0 && activityAt !== null && at > activityAt + rollingDays * DAY_MS) {
      for (const b of buckets) b.remaining = 0;
    }
  };

  for (const entry of sorted) {
    lapseIfDue(entry.createdAt.getTime());
    if (entry.renews) activityAt = entry.createdAt.getTime();
    if (entry.miles > 0) {
      buckets.push({ remaining: entry.miles, expiresAt: entry.expiresAt });
      continue;
    }
    let debt = -entry.miles;
    for (const bucket of buckets) {
      if (debt <= 0) break;
      // Só consome o que ainda valia na data do débito.
      if (bucket.expiresAt && bucket.expiresAt.getTime() <= entry.createdAt.getTime()) continue;
      const used = Math.min(bucket.remaining, debt);
      bucket.remaining -= used;
      debt -= used;
    }
  }

  lapseIfDue(now.getTime());
  const lapseAt = rollingDays > 0 && activityAt !== null ? new Date(activityAt + rollingDays * DAY_MS) : null;
  const soonLimit = now.getTime() + soonDays * DAY_MS;
  let available = 0;
  let expiringSoon = 0;
  let nextExpiry: Date | null = null;
  for (const bucket of buckets) {
    if (bucket.remaining <= 0) continue;
    if (bucket.expiresAt && bucket.expiresAt.getTime() <= now.getTime()) continue; // vencida
    available += bucket.remaining;
    // Vence no que vier primeiro: o teto do crédito ou o fim da janela renovável.
    const effective = bucket.expiresAt && lapseAt ? (bucket.expiresAt < lapseAt ? bucket.expiresAt : lapseAt) : (bucket.expiresAt ?? lapseAt);
    if (effective) {
      if (effective.getTime() <= soonLimit) expiringSoon += bucket.remaining;
      if (!nextExpiry || effective < nextExpiry) nextExpiry = effective;
    }
  }
  return { available, expiringSoon, nextExpiry, lapsesAt: available > 0 ? lapseAt : null };
}
