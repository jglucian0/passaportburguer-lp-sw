/**
 * Cercamento e taxa de entrega por distância (Maringá-PR).
 * Módulo puro: roda no cliente (prévia) e no servidor (valor que vale).
 */
import type { CatalogDeliveryZone } from "../schemas/product";

export const STORE_ORIGIN = {
  label: "Av. São Paulo, 123 - Zona 07, Maringá - PR",
  lat: -23.4139,
  lon: -51.9378,
} as const;

/** Fator que converte distância em linha reta numa estimativa de rota urbana. */
export const URBAN_FACTOR = 1.28;
export const MAX_DELIVERY_KM = 11.0;
export const SERVICE_CITY_KEY = "maringa";

/** Faixas de frete (limite superior inclusivo, em km). */
export const FEE_TIERS = [
  { maxKm: 6.0, feeCents: 699 },
  { maxKm: 8.5, feeCents: 999 },
  { maxKm: MAX_DELIVERY_KM, feeCents: 1299 },
] as const;

export const NOT_IN_CITY_MESSAGE = "Entregamos apenas em Maringá-PR.";
export const OUT_OF_RANGE_MESSAGE = `Este endereço está fora da nossa área de entrega (até ${MAX_DELIVERY_KM
  .toFixed(0)} km).`;

export type DeliveryQuote =
  | { deliverable: true; distanceKm: number; feeCents: number }
  | { deliverable: false; distanceKm: number | null; message: string };

export function normalizeCity(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Distância em linha reta (km) entre dois pontos. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function calculateDeliveryQuote(lat: number, lon: number, city: string): DeliveryQuote {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { deliverable: false, distanceKm: null, message: "Não foi possível localizar este endereço." };
  }

  if (normalizeCity(city) !== SERVICE_CITY_KEY) {
    return { deliverable: false, distanceKm: null, message: NOT_IN_CITY_MESSAGE };
  }

  const raw = haversineKm(STORE_ORIGIN.lat, STORE_ORIGIN.lon, lat, lon) * URBAN_FACTOR;
  const distanceKm = Math.round(raw * 100) / 100; // as faixas são definidas em centésimos de km

  const tier = FEE_TIERS.find((t) => distanceKm <= t.maxKm);
  if (!tier) return { deliverable: false, distanceKm, message: OUT_OF_RANGE_MESSAGE };

  return { deliverable: true, distanceKm, feeCents: tier.feeCents };
}

/**
 * Zona do banco que representa o endereço (usada para tempo estimado e vínculo do pedido).
 * Bairro conhecido -> sua zona ativa; senão, a zona "Demais bairros". A taxa NÃO vem daqui:
 * é sobrescrita pelo cálculo por distância.
 */
export function resolveDeliveryZone(
  zones: CatalogDeliveryZone[],
  neighborhood: string | null | undefined,
  fallbackName: string,
): CatalogDeliveryZone | null {
  const active = zones.filter((z) => z.isActive);
  const fallbackKey = normalizeCity(fallbackName);
  const fallback = active.find((z) => normalizeCity(z.neighborhood) === fallbackKey) ?? null;
  const regular = active.filter((z) => z !== fallback);

  const wanted = neighborhood ? normalizeCity(neighborhood) : "";
  if (wanted) {
    const exact = regular.find((z) => normalizeCity(z.neighborhood) === wanted);
    if (exact) return exact;
  }
  return fallback;
}

/** Zona com a taxa substituída pelo frete por distância. */
export function withQuotedFee(zone: CatalogDeliveryZone, feeCents: number): CatalogDeliveryZone {
  return { ...zone, feeCents };
}
