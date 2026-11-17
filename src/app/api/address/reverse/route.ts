import { NextResponse, type NextRequest } from "next/server";

import { addressReverseQuery } from "@/core/schemas/auth";
import { parseQuery } from "@/infra/security/validate";

import { buildLabel, type AddressSuggestion } from "@/core/delivery/address";

import { UA } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

type NominatimAddress = {
  road?: string;
  pedestrian?: string;
  house_number?: string;
  suburb?: string;
  neighbourhood?: string;
  city_district?: string;
  quarter?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  state?: string;
  "ISO3166-2-lvl4"?: string;
};

/** Coordenadas do GPS -> endereço estruturado (Nominatim). Só latitude/longitude saem do servidor. */
export async function GET(request: NextRequest) {
  const query = parseQuery(request.nextUrl.searchParams, addressReverseQuery);
  if (query.error) return query.error;
  const { lat, lon } = query.data;

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", lat.toFixed(6));
    url.searchParams.set("lon", lon.toFixed(6));
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "pt-BR");

    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const data = (await res.json()) as { address?: NominatimAddress };
    const a = data.address ?? {};

    const street = a.road ?? a.pedestrian ?? "";
    if (!street) {
      return NextResponse.json(
        { error: "Não encontramos uma rua neste ponto." },
        { status: 404, headers: NO_STORE },
      );
    }
    const number = a.house_number?.trim() || null;
    const neighborhood = a.suburb ?? a.neighbourhood ?? a.city_district ?? a.quarter ?? "";
    const city = a.city ?? a.town ?? a.village ?? a.municipality ?? "";
    const state = a["ISO3166-2-lvl4"]?.split("-")[1] ?? (a.state === "Paraná" ? "PR" : (a.state ?? ""));

    const result: AddressSuggestion = {
      id: `gps:${lat.toFixed(5)},${lon.toFixed(5)}`,
      street,
      number,
      neighborhood,
      city,
      state,
      postalCode: (a.postcode ?? "").replace(/\D/g, "").slice(0, 8),
      lat,
      lon,
      formattedLabel: buildLabel({ street, number, neighborhood, city, state }),
    };
    return NextResponse.json({ result }, { headers: NO_STORE });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível identificar o endereço." },
      { status: 502, headers: NO_STORE },
    );
  }
}
