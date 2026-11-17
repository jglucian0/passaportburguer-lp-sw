"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { CatalogProduct } from "@/core/schemas/product";
import { cn } from "@/lib/utils";
import { scrollToElement } from "@/lib/smooth-scroll";

import { ApprovedStamp, CircleStamp } from "./brand-marks";
import { PASSPORT_SELECT_EVENT, type Destination } from "./destinations";
import { useHeroSync } from "./hero-sync";
import { ImageFrame } from "./image-placeholder";
import { PassportStamp } from "./passport-stamp";

export type CarouselCard = {
  destination: Destination;
  imageUrl: string | null;
  dish: string;
  /** Produto exibido no cartão; permite pedir direto pelo cartão de embarque. */
  product: CatalogProduct | null;
};

const AUTOPLAY_MS = 4500;

type Slot = -1 | 0 | 1 | 2;

function slotClass(slot: Slot): string {
  switch (slot) {
    // Central maior (~1.16x) e laterais encostando nele, como no layout de referência.
    case -1:
      return "-translate-x-[75%] -rotate-[4deg] scale-[0.93] opacity-100 z-10 max-md:-translate-x-[62%] max-md:scale-[0.88]";
    case 0:
      return "translate-x-0 rotate-0 scale-[1.08] opacity-100 z-30";
    case 1:
      return "translate-x-[75%] rotate-[4deg] scale-[0.93] opacity-100 z-10 max-md:translate-x-[62%] max-md:scale-[0.88]";
    default:
      return "translate-x-0 rotate-0 scale-75 opacity-0 z-0";
  }
}

function slotOfIndex(i: number, index: number, count: number): Slot {
  const d = (i - index + count) % count;
  if (d === 0) return 0;
  if (d === 1 && count > 1) return 1;
  if (d === count - 1 && count > 2) return -1;
  return 2;
}

function selectDestination(id: string) {
  window.dispatchEvent(new CustomEvent(PASSPORT_SELECT_EVENT, { detail: id }));
  scrollToElement(document.getElementById("cardapio"));
}

/** Artes prontas dos cartões, por id de destino. Adicione novas entradas aqui. */
const CARD_IMAGES: Record<string, string> = {
  "buenos-aires": "/cards/buenosaires-card.webp",
  tokyo: "/cards/tokyo-card.webp",
  mexico: "/cards/mexico-card.webp",
  "st-louis": "/cards/st-louis-desktop-card.webp",
  milao: "/cards/gorgonzola-milao-desktop-card.webp",
  cremona: "/cards/cremona-desktop-card.webp",
  corbin: "/cards/corbin-desktop-card.webp",
  gwangju: "/cards/gwangju-desktop-card.webp",
};

function PassportCard({ card, active }: { card: CarouselCard; active: boolean }) {
  const { destination } = card;
  const artwork = CARD_IMAGES[destination.id];

  if (artwork) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={artwork}
        alt={destination.cardTitle}
        width={509}
        height={801}
        draggable={false}
        className={cn(
          "block h-auto w-full max-md:h-full max-md:object-contain",
          active ? "drop-shadow-2xl" : "drop-shadow-xl",
        )}
      />
    );
  }

  return (
    <article
      className={cn(
        "paper-grain relative flex aspect-[2/3] flex-col max-md:aspect-auto max-md:h-full overflow-hidden rounded-2xl bg-paper transition-shadow",
        active ? "shadow-2xl ring-1 ring-ink/10" : "shadow-xl",
      )}
    >
      {/* Faixa superior: marca d'água + carimbos, na cor do destino */}
      <div className="relative z-10 shrink-0 pt-3" style={{ color: destination.accent }}>
        <p className="text-center font-display text-[10px] font-semibold uppercase tracking-[0.4em] text-ink/30">
          Passaporte
        </p>
        <ApprovedStamp
          key={active ? "on" : "off"}
          width={70}
          className={cn(
            "absolute -left-2 top-4 -rotate-12 drop-shadow-sm",
            active && "animate-stamp-in",
          )}
        />
        <CircleStamp
          id={`card-dest-${destination.id}`}
          topText="PASSAPORTE"
          bottomText="BURGUER"
          size={52}
          className="absolute -right-2 top-2 rotate-[14deg] drop-shadow-sm"
        />
      </div>

      {/* Foto do lanche: domina o cartão. Placeholder até existir image_url. */}
      <div className="relative mx-3 mb-2 mt-1 min-h-0 flex-1">
        {card.imageUrl ? (
          <ImageFrame src={card.imageUrl} alt={card.dish} fill />
        ) : (
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-b from-[#13264D] to-[#0A162E]">
            <PassportStamp
              stamp={destination.stamp}
              destinationId={destination.id}
              size={120}
              tone="white"
              className="-rotate-12 opacity-15"
            />
          </div>
        )}
      </div>

      {/* Rodapé */}
      <div className="shrink-0 px-3 pb-3 max-md:pb-2.5">
        <div
          className="border-t-2 border-dotted opacity-70"
          style={{ borderColor: destination.accent }}
        />
        <p className="pt-2 text-center font-display text-xl font-black uppercase leading-none tracking-wide text-ink sm:text-2xl">
          {destination.cardTitle}
        </p>
      </div>
    </article>
  );
}

/**
 * Carrossel em leque: setas, arraste e clique nos cartões laterais trazem o
 * destino para o centro. Clicar no cartão central filtra o cardápio.
 */
export function PassportCarousel({ cards }: { cards: CarouselCard[] }) {
  const count = cards.length;
  const { index, setIndex } = useHeroSync();
  const pointerStart = useRef<number | null>(null);
  const swiped = useRef(false);
  const prevSlots = useRef<Record<string, Slot>>({});
  const wrapped = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    prevSlots.current = Object.fromEntries(
      cards.map((c, i) => [c.destination.id, slotOfIndex(i, index, count)]),
    );
  });

  /* Avanço automático: troca de cartão a cada AUTOPLAY_MS sem interação. Qualquer troca
   * manual muda `index` e reinicia o relógio; hover/foco/toque pausam. */
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (count < 2 || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % count), AUTOPLAY_MS);
    return () => window.clearTimeout(id);
  }, [index, count, paused, setIndex]);

  if (count === 0) return null;

  // Cartão que pularia de -1 para +1 (ou o inverso) atravessaria o palco por
  // cima do central. Esse cartão não desliza: troca de lugar e entra com fade.
  const nextWrapped = new Set<string>();
  cards.forEach((c, i) => {
    const before = prevSlots.current[c.destination.id];
    const now = slotOfIndex(i, index, count);
    if (before !== undefined && before !== now && Math.abs(before - now) === 2 && before !== 2 && now !== 2) {
      nextWrapped.add(c.destination.id);
    }
  });
  wrapped.current = nextWrapped;

  const go = (delta: number) => setIndex((i) => (i + delta + count) % count);

  const slotOf = (i: number): Slot => slotOfIndex(i, index, count);

  return (
    <div
      className="mb-[10px]"
      onPointerEnter={(e) => e.pointerType === "mouse" && setPaused(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* Controles */}
      <div className="mb-2 flex items-center justify-center gap-10 max-md:hidden">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={count < 2}
          aria-label="Destino anterior"
          className="flex h-10 w-10 items-center justify-center text-gold transition duration-200 hover:scale-110 hover:text-white active:scale-90 disabled:opacity-30"
        >
          <ArrowLeft className="h-7 w-7" strokeWidth={2.5} />
        </button>
        <div className="text-center leading-tight">
          <p className="font-display text-2xl font-semibold text-white">Destinos</p>
          <p className="text-sm text-slate-300">(Hambúrgueres)</p>
        </div>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={count < 2}
          aria-label="Próximo destino"
          className="flex h-10 w-10 items-center justify-center text-gold transition hover:scale-110 hover:text-white disabled:opacity-30"
        >
          <ArrowRight className="h-7 w-7" strokeWidth={2.5} />
        </button>
      </div>

      {/* Palco */}
      <div
        className="relative mx-auto w-full max-w-[520px] touch-pan-y select-none px-4 py-8 max-md:py-3"
        onPointerDown={(e) => {
          pointerStart.current = e.clientX;
          swiped.current = false;
        }}
        onPointerUp={(e) => {
          if (pointerStart.current === null) return;
          const dx = e.clientX - pointerStart.current;
          pointerStart.current = null;
          if (Math.abs(dx) > 40) {
            swiped.current = true;
            go(dx < 0 ? 1 : -1);
          }
        }}
      >
        {/* Espaçador invisível: dá altura natural ao palco */}
        <div aria-hidden="true" className="invisible mx-auto w-[220px] max-md:h-[clamp(205px,32svh,280px)] max-md:w-[calc(clamp(205px,32svh,280px)*0.635)] sm:w-[235px] max-md:sm:w-[calc(clamp(205px,32svh,280px)*0.635)]">
          <PassportCard card={cards[index]} active={false} />
        </div>

        <div className="absolute inset-0 flex items-center justify-center">
          {cards.map((card, i) => {
            const slot = slotOf(i);
            const isCenter = slot === 0;
            const isWrapping = wrapped.current.has(card.destination.id);

            return (
              <div
                key={card.destination.id}
                role="button"
                tabIndex={slot === 2 ? -1 : 0}
                aria-hidden={slot === 2}
                aria-label={
                  isCenter
                    ? `Ver lanches de ${card.destination.cardTitle}`
                    : `Trazer ${card.destination.cardTitle} para o centro`
                }
                onClick={() => {
                  if (swiped.current) return;
                  if (isCenter) selectDestination(card.destination.id);
                  else setIndex(i);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  if (isCenter) selectDestination(card.destination.id);
                  else setIndex(i);
                }}
                className={cn(
                  "absolute w-[220px] cursor-pointer will-change-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold max-md:h-[clamp(205px,32svh,280px)] max-md:w-[calc(clamp(205px,32svh,280px)*0.635)] max-md:overflow-hidden max-md:rounded-xl sm:w-[235px] max-md:sm:w-[calc(clamp(205px,32svh,280px)*0.635)]",
                  isWrapping
                    ? "animate-card-wrap-in transition-none"
                    : "transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  slotClass(slot),
                  slot === 2 && "pointer-events-none",
                )}
              >
                <PassportCard card={card} active={isCenter} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Indicadores */}
      {count > 1 ? (
        <div className="mt-3 flex items-center justify-center gap-1.5 max-md:mt-1.5" aria-hidden="true">
          {cards.map((card, i) => (
            <span
              key={card.destination.id}
              className={cn(
                "h-1.5 rounded-full transition-all duration-500 ease-out",
                i === index ? "w-6 bg-gold" : "w-1.5 bg-gold/30",
              )}
            />
          ))}
        </div>
      ) : null}

    </div>
  );
}
