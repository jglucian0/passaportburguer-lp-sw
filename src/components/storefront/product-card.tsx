"use client";

import { Check, Minus, Plus, Stamp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getProductDisplayPrice } from "@/core/menu/pricing";
import type { CatalogProduct } from "@/core/schemas/product";
import { productImageAlt } from "@/lib/site";
import { cn, formatCents } from "@/lib/utils";

import { useCart } from "./cart-provider";
import { MAX_LINE_QUANTITY } from "./cart-storage";
import type { Destination } from "./destinations";
import { isOneTap } from "./upsell";

export function ProductCard({
  product,
  destination = null,
  bestSeller = false,
  priority = false,
  onSelect,
}: {
  /** Imagem crítica (primeiros cards do cardápio): carrega já, sem lazy. */
  priority?: boolean;
  product: CatalogProduct;
  destination?: Destination | null;
  bestSeller?: boolean;
  onSelect: (product: CatalogProduct) => void;
}) {
  const unavailable = !product.isAvailable;
  const price = getProductDisplayPrice(product);
  const { lines, setQuantity, addLine, hydrated } = useCart();

  const productLines = hydrated ? lines.filter((l) => l.productId === product.id) : [];
  const totalQty = productLines.reduce((sum, l) => sum + l.quantity, 0);
  /* Uma única variação no carrinho: -/+ age direto nela. Várias: o "+" abre o modal para montar outra. */
  const single = productLines.length === 1 ? productLines[0] : null;
  const showStepper = !unavailable && totalQty > 0;

  /* "+" rápido: itens sem escolha obrigatória entram direto na sacola; os demais abrem o modal. */
  const quickAdd = isOneTap(product);
  const [justAdded, setJustAdded] = useState(false);
  const flashTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  function handleQuickAdd() {
    if (!quickAdd) {
      onSelect(product);
      return;
    }
    addLine({
      productId: product.id,
      name: product.name,
      imageUrl: product.imageUrl,
      unitPriceCents: product.priceCents,
      quantity: 1,
      addons: [],
    });
    setJustAdded(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setJustAdded(false), 900);
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={unavailable}
        onClick={() => onSelect(product)}
        className={cn(
          "group flex w-full items-start justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 text-left shadow-sm animate-in fade-in duration-150 transition-[box-shadow,transform] ease-out will-change-transform hover:shadow-md active:scale-[0.99] disabled:cursor-not-allowed",
          unavailable && "opacity-60",
        )}
      >
        <div className="min-w-0 flex-1">
          {destination || bestSeller ? (
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              {destination ? (
                <span className="inline-block rounded-full bg-[#0A2540]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#0A2540]/70">
                  {destination.city}
                </span>
              ) : null}
              {bestSeller ? (
                <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                  ★ Mais pedido
                </span>
              ) : null}
            </div>
          ) : null}
          <h3 className="text-[15px] font-bold leading-tight text-[#0A2540]">{product.name}</h3>
          {product.description ? (
            <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-[#475569]">
              {product.description}
            </p>
          ) : null}
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-base font-extrabold text-[#0A2540]">
              {price.from ? (
                <span className="mr-1 text-[11px] font-semibold text-[#475569]">a partir de</span>
              ) : null}
              {formatCents(price.cents)}
            </span>
            {unavailable ? (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                Esgotado
              </span>
            ) : null}
          </div>
        </div>

        <div className="relative aspect-square h-[88px] w-[88px] shrink-0 overflow-hidden rounded-xl bg-[#E2E8F0] sm:h-24 sm:w-24">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt={productImageAlt(product.name, product.description, destination !== null)}
              width={96}
              height={96}
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : "auto"}
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[#94A3B8]">
              <Stamp className="h-8 w-8" strokeWidth={1.25} />
            </div>
          )}
        </div>
      </button>

      {/* Irmãos do card (não filhos): evitam <button> dentro de <button>. Ancorados no canto da foto. */}
      {!unavailable && !showStepper ? (
        <button
          type="button"
          onClick={handleQuickAdd}
          aria-label={
            quickAdd ? `Adicionar ${product.name} à sacola` : `Escolher opções de ${product.name}`
          }
          className={cn(
            "absolute right-[18px] top-[62px] flex h-8 w-8 items-center justify-center rounded-full text-[#0A2540] shadow-md transition active:scale-90 sm:top-[74px]",
            justAdded ? "bg-emerald-500 text-white" : "bg-[#F59E0B]",
          )}
        >
          {justAdded ? (
            <Check className="h-5 w-5" strokeWidth={3} />
          ) : (
            <Plus className="h-5 w-5" strokeWidth={2.5} />
          )}
        </button>
      ) : null}

      {showStepper ? (
        <div
          role="group"
          aria-label={`${product.name} no carrinho`}
          className="absolute right-[18px] top-[58px] flex h-9 items-center rounded-full bg-[#F59E0B] text-[#0A2540] shadow-md sm:top-[70px]"
        >
          {single ? (
            <button
              type="button"
              aria-label={single.quantity <= 1 ? `Remover ${product.name}` : `Diminuir ${product.name}`}
              onClick={() => setQuantity(single.key, single.quantity - 1)}
              className="flex h-9 w-9 items-center justify-center rounded-full transition active:scale-90"
            >
              <Minus className="h-4 w-4" strokeWidth={2.5} />
            </button>
          ) : null}
          <span
            className={cn(
              "min-w-5 text-center text-sm font-extrabold tabular-nums",
              !single && "pl-3",
            )}
          >
            {totalQty}
          </span>
          <button
            type="button"
            aria-label={single ? `Aumentar ${product.name}` : `Montar outro ${product.name}`}
            disabled={single ? single.quantity >= MAX_LINE_QUANTITY : false}
            onClick={() =>
              single ? setQuantity(single.key, single.quantity + 1) : onSelect(product)
            }
            className="flex h-9 w-9 items-center justify-center rounded-full transition active:scale-90 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
