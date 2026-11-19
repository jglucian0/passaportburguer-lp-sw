/**
 * Regras puras do programa de milhas (sem banco): quanto um pedido rende e como o saldo é calculado.
 * O saldo nunca é guardado: sai do extrato, com validade e consumo FIFO (as milhas mais antigas saem primeiro).
 */

export type MilesConfig = {
  enabled: boolean;
  milesPerReal: number;
  validityMonths: number;
  rewardCouponValidDays: number;
};

export const DEFAULT_MILES_CONFIG: MilesConfig = {
  enabled: false,
  milesPerReal: 5,
  validityMonths: 12,
  rewardCouponValidDays: 15,
};

/** Milhas de um pedido: R$ em itens (já com o desconto do cupom, sem a taxa de entrega) × milhas por R$. */
export function milesForOrder(itemsAfterDiscountCents: number, milesPerReal: number): number {
  if (itemsAfterDiscountCents <= 0 || milesPerReal <= 0) return 0;
  return Math.floor((itemsAfterDiscountCents * milesPerReal) / 100);
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
};

export type MilesBalance = {
  /** Milhas que o cliente pode usar agora. */
  available: number;
  /** Milhas que vencem nos próximos `soonDays` dias (parte do disponível). */
  expiringSoon: number;
  /** Quando vence a próxima leva de milhas disponíveis (null se nada vence). */
  nextExpiry: Date | null;
};

/**
 * Saldo disponível. Cada crédito é um "balde" com validade; débitos (resgate, estorno) consomem os baldes
 * mais antigos primeiro. Balde vencido que ainda não tinha sido gasto se perde; o saldo nunca fica negativo.
 */
export function computeBalance(entries: LedgerEntry[], now: Date = new Date(), soonDays = 30): MilesBalance {
  const sorted = [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const buckets: { remaining: number; expiresAt: Date | null }[] = [];

  for (const entry of sorted) {
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

  const soonLimit = now.getTime() + soonDays * 24 * 60 * 60 * 1000;
  let available = 0;
  let expiringSoon = 0;
  let nextExpiry: Date | null = null;
  for (const bucket of buckets) {
    if (bucket.remaining <= 0) continue;
    if (bucket.expiresAt && bucket.expiresAt.getTime() <= now.getTime()) continue; // vencida
    available += bucket.remaining;
    if (bucket.expiresAt) {
      if (bucket.expiresAt.getTime() <= soonLimit) expiringSoon += bucket.remaining;
      if (!nextExpiry || bucket.expiresAt < nextExpiry) nextExpiry = bucket.expiresAt;
    }
  }
  return { available, expiringSoon, nextExpiry };
}
