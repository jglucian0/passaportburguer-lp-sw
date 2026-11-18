import { normalizeCity, SERVICE_CITY_KEY } from "@/core/delivery/quote";

import { photonSearch, UA } from "@/app/api/address/_lib";

export type GeocodedAddress = {
  lat: number;
  lon: number;
  city: string;
  neighborhood: string | null;
  postalCode: string | null;
};

type NominatimHit = {
  lat?: string;
  lon?: string;
  address?: {
    house_number?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    suburb?: string;
    neighbourhood?: string;
    postcode?: string;
  };
};

/**
 * Geocodifica "número + rua" em Maringá-PR (o bot não tem o seletor de mapa do site).
 * Mesma estratégia da rota /api/address/geocode: Nominatim estruturado e Photon como reserva.
 * Retorna null se não achar (o bot pede para o cliente confirmar rua/número).
 */
export async function geocodeAddress(street: string, number: string): Promise<GeocodedAddress | null> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("street", `${number} ${street}`);
    url.searchParams.set("city", "Maringá");
    url.searchParams.set("state", "Paraná");
    url.searchParams.set("country", "Brasil");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "3");
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (res.ok) {
      const hits = (await res.json()) as NominatimHit[];
      const inCity = hits.filter((h) => {
        const a = h.address;
        return normalizeCity(a?.city ?? a?.town ?? a?.village ?? a?.municipality ?? "") === SERVICE_CITY_KEY;
      });
      const best = inCity.find((h) => h.address?.house_number) ?? inCity[0];
      const lat = Number(best?.lat);
      const lon = Number(best?.lon);
      if (best && Number.isFinite(lat) && Number.isFinite(lon)) {
        return {
          lat,
          lon,
          city: "Maringá",
          neighborhood: best.address?.suburb ?? best.address?.neighbourhood ?? null,
          postalCode: best.address?.postcode?.replace(/\D/g, "").slice(0, 8) || null,
        };
      }
    }
  } catch {
    /* tenta o Photon */
  }

  try {
    const hits = await photonSearch(`${street} ${number} Maringá PR`, 5);
    const inCity = hits.filter((h) => normalizeCity(h.city) === SERVICE_CITY_KEY);
    const best = inCity.find((h) => h.number === number) ?? inCity[0];
    if (best) {
      return {
        lat: best.lat,
        lon: best.lon,
        city: "Maringá",
        neighborhood: best.neighborhood || null,
        postalCode: best.postalCode || null,
      };
    }
  } catch {
    /* sem resultado */
  }
  return null;
}
