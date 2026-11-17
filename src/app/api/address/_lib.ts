import { buildLabel, type AddressSuggestion } from "@/core/delivery/address";
import { STORE_ORIGIN } from "@/core/delivery/quote";

export const UA = "delivery-storefront-address/1.0";

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number;
    osm_type?: string;
    osm_key?: string;
    type?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    suburb?: string;
    locality?: string;
    city?: string;
    county?: string;
    state?: string;
    postcode?: string;
    countrycode?: string;
  };
};

function isParana(state?: string): boolean {
  if (!state) return true;
  const s = state.trim();
  return /^paran[aá]$/i.test(s) || s.toUpperCase() === "PR";
}

export function mapPhotonFeature(f: PhotonFeature): AddressSuggestion | null {
  const p = f.properties;
  const [lon, lat] = f.geometry?.coordinates ?? [];
  if (!p || typeof lat !== "number" || typeof lon !== "number") return null;
  if (p.countrycode && p.countrycode.toUpperCase() !== "BR") return null;
  if (!isParana(p.state)) return null;

  const isStreet = p.osm_key === "highway" || p.type === "street";
  const street = p.street ?? (isStreet ? p.name : undefined);
  if (!street) return null;

  const number = p.housenumber?.trim() || null;
  const neighborhood = p.district ?? p.suburb ?? p.locality ?? "";
  const city = p.city ?? p.county ?? "";
  const state = "PR";

  return {
    id: `${p.osm_type ?? "x"}${p.osm_id ?? ""}:${lat.toFixed(5)},${lon.toFixed(5)}`,
    street,
    number,
    neighborhood,
    city,
    state,
    postalCode: (p.postcode ?? "").replace(/\D/g, "").slice(0, 8),
    lat,
    lon,
    formattedLabel: buildLabel({ street, number, neighborhood, city, state }),
  };
}

/** Consulta o Photon (Komoot), com viés de localização para Maringá. */
export async function photonSearch(query: string, limit: number): Promise<AddressSuggestion[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("lang", "default"); // o Photon não aceita "pt"; "default" traz os nomes locais
  url.searchParams.set("lat", String(STORE_ORIGIN.lat));
  url.searchParams.set("lon", String(STORE_ORIGIN.lon));

  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(8000),
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  const data = (await res.json()) as { features?: PhotonFeature[] };

  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const f of data.features ?? []) {
    const item = mapPhotonFeature(f);
    if (!item || seen.has(item.formattedLabel)) continue;
    seen.add(item.formattedLabel);
    out.push(item);
  }
  return out;
}
