import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
};

/**
 * Converte coordenadas em endereço (geocodificação reversa via OpenStreetMap).
 * Só repassa latitude/longitude; nada sobre a loja ou o cliente é enviado.
 */
export async function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const lon = Number(request.nextUrl.searchParams.get("lon"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: "Coordenadas inválidas." }, { status: 400 });
  }

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", lat.toFixed(6));
    url.searchParams.set("lon", lon.toFixed(6));
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "pt-BR");

    const response = await fetch(url, {
      headers: { "User-Agent": "delivery-storefront-reverse-geocode/1.0" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`geocoder ${response.status}`);

    const data = (await response.json()) as { address?: NominatimAddress };
    const a = data.address ?? {};

    return NextResponse.json(
      {
        street: a.road ?? a.pedestrian ?? null,
        number: a.house_number ?? null,
        neighborhood: a.suburb ?? a.neighbourhood ?? a.city_district ?? a.quarter ?? null,
        city: a.city ?? a.town ?? a.village ?? null,
        postcode: a.postcode ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Não foi possível identificar o endereço." }, { status: 502 });
  }
}
