"use client";

import { Plane } from "lucide-react";
import { useState } from "react";

import type { CatalogProduct } from "@/core/schemas/product";
import { cn } from "@/lib/utils";
import { scrollToElement } from "@/lib/smooth-scroll";

import { useHeroSync } from "./hero-sync";
import type { CarouselCard } from "./passport-carousel";
import { ProductModal } from "./product-modal";

type Mode = "DELIVERY" | "PICKUP";

const MODES: { id: Mode; label: string }[] = [
  { id: "DELIVERY", label: "Entrega" },
  { id: "PICKUP", label: "Retirada" },
];

/**
 * Bilhete de embarque: rota no estilo IATA que acompanha o slide ativo do
 * carrossel. "Pedir este destino" abre o lanche daquele slide.
 */
export function DigitalBoardingPass({
  cards,
  storeOpen,
}: {
  cards: CarouselCard[];
  storeOpen: boolean;
}) {
  const { index } = useHeroSync();
  const [mode, setMode] = useState<Mode>("DELIVERY");
  const [ordering, setOrdering] = useState<CatalogProduct | null>(null);

  const active = cards[index] ?? cards[0] ?? null;

  return (
    <div className="relative mx-auto w-full max-w-[345px] max-md:w-[345px] max-md:max-w-full rounded-2xl md:mx-0 md:max-w-md border border-[#D4A03E]/30 bg-[#0A162B] text-white shadow-[0_18px_40px_rgba(0,0,0,0.45)]">
      {/* Costura interna tracejada, como a página de um passaporte */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-1.5 rounded-xl border border-dashed border-[#D4A03E]/20"
      />

      {/* Parte superior: rota */}
      <div className="relative flex items-center gap-4 border-b border-dashed border-slate-700 px-6 py-5 max-md:gap-3 max-md:px-3 max-md:py-1.5">
        <div>
          <p className="font-display text-4xl font-bold leading-none tracking-wider max-md:text-2xl">MGA</p>
          <p className="mt-1.5 text-xs text-[#CBD5E1] max-md:mt-1">Cozinha</p>
        </div>

        <div className="flex flex-1 items-center text-[#F59E0B]" aria-hidden="true">
          <span className="h-px flex-1 bg-slate-600" />
          <Plane className="mx-1.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span className="h-px flex-1 bg-slate-600" />
        </div>

        <div className="min-w-0 text-right" aria-live="polite">
          <p
            key={active?.destination.id}
            className="animate-in fade-in slide-in-from-bottom-2 font-display text-4xl font-bold leading-none tracking-wider text-[#F59E0B] duration-300 max-md:text-2xl"
          >
            {active?.destination.code ?? "---"}
          </p>
          <p
            key={`city-${active?.destination.id}`}
            className="mt-1.5 animate-in truncate text-xs max-md:mt-1 text-[#CBD5E1] duration-300 fade-in"
          >
            {active?.destination.city ?? ""}
          </p>
        </div>
      </div>

      {/* Parte inferior: modalidade + ações */}
      <div className="relative space-y-4 px-6 py-5 max-md:flex max-md:items-center max-md:justify-between max-md:gap-2 max-md:space-y-0 max-md:p-3 max-md:pt-2">
        <div role="radiogroup" aria-label="Modalidade do pedido" className="flex gap-6 max-md:shrink-0 max-md:gap-4">
          {MODES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={mode === id}
              onClick={() => setMode(id)}
              className={cn(
                "border-b-2 pb-1 text-sm transition-colors duration-200",
                mode === id
                  ? "border-[#F59E0B] font-semibold text-[#F59E0B]"
                  : "border-transparent text-[#CBD5E1] hover:text-white",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Mobile: botão direto na mesma linha do seletor */}
        <button
          type="button"
          onClick={() =>
            active?.product
              ? setOrdering(active.product)
              : scrollToElement(document.getElementById("cardapio"))
          }
          className="rounded-lg bg-[#F59E0B] min-w-0 truncate px-3.5 py-2 text-sm font-semibold text-[#0A162B] transition active:scale-[0.97] md:hidden"
        >
          {active?.product ? `Pedir ${active.destination.city}` : "Explorar Cardápio"}
        </button>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 max-md:hidden">
          <button
            type="button"
            onClick={() =>
              scrollToElement(document.getElementById("cardapio"))
            }
            className="rounded-lg bg-[#F59E0B] px-5 py-2.5 max-md:px-4 max-md:py-2 text-sm font-semibold text-[#0A162B] transition duration-200 hover:bg-[#e08f0a] hover:shadow-md active:scale-[0.97]"
          >
            Explorar Cardápio
          </button>

          {active?.product ? (
            <button
              type="button"
              onClick={() => setOrdering(active.product)}
              className="text-sm font-medium text-[#CBD5E1] max-md:w-full max-md:text-center max-md:text-xs underline-offset-4 transition-colors duration-200 hover:text-white hover:underline active:opacity-70"
            >
              Pedir este destino →
            </button>
          ) : null}
        </div>
      </div>

      {ordering ? (
        <ProductModal
          key={ordering.id}
          product={ordering}
          storeOpen={storeOpen}
          onClose={() => setOrdering(null)}
        />
      ) : null}
    </div>
  );
}
