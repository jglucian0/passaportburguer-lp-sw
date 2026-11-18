import { NextResponse, type NextRequest } from "next/server";

import { addressGeocodeQuery } from "@/core/schemas/auth";
import { enforceRateLimit } from "@/infra/security/rate-limit";
import { parseQuery } from "@/infra/security/validate";

import { normalizeCity, SERVICE_CITY_KEY } from "@/core/delivery/quote";

import { photonSearch, UA } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

type NominatimHit = {
  lat?: string;
  lon?: string;
  addresstype?: string;
  address?: { house_number?: string; city?: string; town?: string; village?: string; municipality?: string };
};

/**
 * Geocodifica "número + rua + Maringá + PR" para achar o ponto mais próximo daquela numeração.
 * `precise` indica que a fonte reconheceu o número predial (e não só a rua).
 */
export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, "address", 30, 60);
  if (limited) return limited;

  const query = parseQuery(request.nextUrl.searchParams, addressGeocodeQuery);
  if (query.error) return query.error;
  const street = query.data.street.trim();
  const number = query.data.number.trim();
  if (street.length < 2 || !number) {
    return NextResponse.json({ error: "Informe rua e número." }, { status: 400, headers: NO_STORE });
  }

  /* 1) Nominatim estruturado: reconhece número predial quando o OSM o tem. */
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
        const c = h.address?.city ?? h.address?.town ?? h.address?.village ?? h.address?.municipality ?? "";
        return normalizeCity(c) === SERVICE_CITY_KEY;
      });
      const best = inCity.find((h) => h.address?.house_number) ?? inCity[0];
      const lat = Number(best?.lat);
      const lon = Number(best?.lon);
      if (best && Number.isFinite(lat) && Number.isFinite(lon)) {
        return NextResponse.json(
          { lat, lon, precise: !!best.address?.house_number },
          { headers: NO_STORE },
        );
      }
    }
  } catch {
    /* tenta o Photon */
  }

  /* 2) Photon com a numeração na consulta. */
  try {
    const hits = await photonSearch(`${street} ${number} Maringá PR`, 5);
    const inCity = hits.filter((h) => normalizeCity(h.city) === SERVICE_CITY_KEY);
    const best = inCity.find((h) => h.number === number) ?? inCity[0];
    if (best) {
      return NextResponse.json({ lat: best.lat, lon: best.lon, precise: best.number === number }, { headers: NO_STORE });
    }
  } catch {
    /* sem resultado */
  }

  return NextResponse.json({ error: "Endereço não localizado." }, { status: 404, headers: NO_STORE });
}
