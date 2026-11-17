import type { DeliveryRules } from "@/infra/db/schema";

export type { DeliveryBand, DeliveryRules } from "@/infra/db/schema";

/** Padrão operacional do Passaporte Burguer (Maringá-PR). */
export const DEFAULT_DELIVERY_RULES: DeliveryRules = {
  restrictToCity: true,
  city: "Maringá - PR",
  maxRadiusKm: 11,
  baseAddress: "Av. São Paulo, 123 - Zona 07, Maringá - PR",
  bands: [
    { maxKm: 6, feeCents: 699 },
    { maxKm: 8.5, feeCents: 999 },
    { maxKm: 11, feeCents: 1299 },
  ],
};

export const DEFAULT_MIN_ORDER_CENTS = 3300;

export function resolveDeliveryRules(stored: DeliveryRules | null | undefined): DeliveryRules {
  return stored ?? DEFAULT_DELIVERY_RULES;
}

/** Frete para uma distância em km; null = fora do raio de entrega. */
export function feeForDistance(rules: DeliveryRules, km: number): number | null {
  if (km > rules.maxRadiusKm) return null;
  return rules.bands.find((b) => km <= b.maxKm)?.feeCents ?? null;
}
