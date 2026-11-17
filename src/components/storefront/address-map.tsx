"use client";

import "leaflet/dist/leaflet.css";

import type { Map as LeafletMap } from "leaflet";
import { MapPin } from "lucide-react";
import { useRef, useState } from "react";
import { MapContainer, TileLayer, useMapEvents } from "react-leaflet";

import { calculateDeliveryQuote } from "@/core/delivery/quote";
import { formatCents } from "@/lib/utils";

/*
 * O raster do CARTO (rastertiles/voyager) passou a exigir chave de API e devolve uma imagem
 * "API KEY REQUIRED". Padrão: tiles do OpenStreetMap (sem chave, uso leve). Para outro provedor
 * (MapTiler, Stadia, CARTO com chave), defina NEXT_PUBLIC_MAP_TILES_URL e NEXT_PUBLIC_MAP_TILES_ATTRIBUTION.
 */
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILES_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILES_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function CenterWatcher({ onCenter }: { onCenter: (lat: number, lon: number) => void }) {
  useMapEvents({
    moveend: (e) => {
      const c = e.target.getCenter();
      onCenter(c.lat, c.lng);
    },
  });
  return null;
}

/**
 * Mini-mapa com pino fixo no centro: o cliente arrasta o mapa até o pino ficar em frente ao imóvel.
 * Carregado só no cliente (dynamic import, ssr: false).
 */
export default function AddressMap({
  lat,
  lon,
  city,
  onConfirm,
  onCancel,
}: {
  lat: number;
  lon: number;
  city: string;
  onConfirm: (lat: number, lon: number) => void;
  onCancel: () => void;
}) {
  const mapRef = useRef<LeafletMap | null>(null);
  const [center, setCenter] = useState({ lat, lon });
  const quote = calculateDeliveryQuote(center.lat, center.lon, city);

  function confirm() {
    const c = mapRef.current?.getCenter();
    if (!c) return;
    onConfirm(c.lat, c.lng);
  }

  return (
    <div className="space-y-3">
      <div className="relative h-64 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
        <MapContainer
          ref={mapRef}
          center={[lat, lon]}
          zoom={17}
          minZoom={13}
          maxZoom={19}
          scrollWheelZoom
          className="h-full w-full"
        >
          <TileLayer
            url={TILE_URL}
            attribution={TILE_ATTRIBUTION}
            maxZoom={19}
          />
          <CenterWatcher onCenter={(la, lo) => setCenter({ lat: la, lon: lo })} />
        </MapContainer>

        {/* Pino fixo: a ponta fica exatamente no centro do mapa. */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-full">
          <div className="relative mb-1 whitespace-nowrap rounded-lg bg-[#0A2540] px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg">
            Você está aqui? Ajuste a localização
            <span className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 bg-[#0A2540]" />
          </div>
          <MapPin
            className="mx-auto h-9 w-9 fill-[#F59E0B] text-[#0A2540] drop-shadow"
            strokeWidth={1.75}
          />
        </div>
      </div>

      {quote.deliverable ? (
        <p className="text-xs text-slate-600">
          Entrega neste ponto: <strong>{formatCents(quote.feeCents)}</strong> • {quote.distanceKm.toFixed(1)} km
        </p>
      ) : (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {quote.message}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="h-12 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!quote.deliverable}
          className="h-12 rounded-xl bg-[#F59E0B] text-sm font-bold text-[#0A2540] transition hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          Confirmar localização
        </button>
      </div>
    </div>
  );
}
