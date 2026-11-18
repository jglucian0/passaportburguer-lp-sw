import { NextResponse, type NextRequest } from "next/server";

import { buildLabel, extractAddressNumber, type AddressSuggestion } from "@/core/delivery/address";
import { normalizeCity } from "@/core/delivery/quote";

import { addressSearchQuery } from "@/core/schemas/auth";
import { enforceRateLimit } from "@/infra/security/rate-limit";
import { parseQuery } from "@/infra/security/validate";

import { photonSearch, UA } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

type ViaCep = {
  erro?: boolean | string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

/** CEP -> ViaCEP -> coordenadas (Photon, com Nominatim como reserva). */
async function searchByCep(digits: string): Promise<AddressSuggestion[]> {
  const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
    signal: AbortSignal.timeout(8000),
    next: { revalidate: 86400 },
  });
  if (!res.ok) throw new Error(`viacep ${res.status}`);
  const v = (await res.json()) as ViaCep;
  if (v.erro || !v.logradouro) return [];

  const city = v.localidade ?? "";
  const state = v.uf ?? "";
  const neighborhood = v.bairro ?? "";
  const street = v.logradouro;

  let lat: number | null = null;
  let lon: number | null = null;

  try {
    const hits = await photonSearch([street, neighborhood, city, state].filter(Boolean).join(", "), 5);
    const hit = hits.find((h) => normalizeCity(h.city) === normalizeCity(city));
    if (hit) {
      lat = hit.lat;
      lon = hit.lon;
    }
  } catch {
    /* tenta a reserva */
  }

  if (lat == null || lon == null) {
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("street", street);
      url.searchParams.set("city", city);
      url.searchParams.set("state", state);
      url.searchParams.set("country", "Brasil");
      url.searchParams.set("limit", "1");
      const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
      const arr = (await r.json()) as { lat?: string; lon?: string }[];
      if (arr[0]?.lat && arr[0]?.lon) {
        lat = Number(arr[0].lat);
        lon = Number(arr[0].lon);
      }
    } catch {
      /* sem coordenadas */
    }
  }

  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];

  return [
    {
      id: `cep:${digits}`,
      street,
      number: null,
      neighborhood,
      city,
      state,
      postalCode: digits,
      lat,
      lon,
      formattedLabel: buildLabel({ street, neighborhood, city, state }),
    },
  ];
}

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, "address", 30, 60);
  if (limited) return limited;

  const query = parseQuery(request.nextUrl.searchParams, addressSearchQuery);
  if (query.error) return query.error;
  const q = query.data.q.trim();
  const digits = q.replace(/\D/g, "");

  try {
    if (digits.length === 8 && /^[\d\s.-]+$/.test(q)) {
      return NextResponse.json({ results: await searchByCep(digits) }, { headers: NO_STORE });
    }
    if (q.length < 3) return NextResponse.json({ results: [] }, { headers: NO_STORE });

    /* O número digitado sai da consulta (ruas casam melhor sem ele) e volta anexado às sugestões. */
    const { text, number: extractedNumber } = extractAddressNumber(q);
    const found = await photonSearch(`${text} Maringá PR`, 6);

    const results = extractedNumber
      ? found.map((s) =>
          s.number
            ? s
            : {
                ...s,
                number: extractedNumber,
                formattedLabel: buildLabel({ ...s, number: extractedNumber }),
              },
        )
      : found;
    return NextResponse.json({ results, extractedNumber }, { headers: NO_STORE });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível buscar endereços agora." },
      { status: 502, headers: NO_STORE },
    );
  }
}
