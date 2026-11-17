"use client";

import { Minus, Plus, Stamp } from "lucide-react";

import { getProductDisplayPrice } from "@/core/menu/pricing";
import type { CatalogProduct } from "@/core/schemas/product";
import { productImageAlt } from "@/lib/site";
import { cn, formatCents } from "@/lib/utils";

import { useCart } from "./cart-provider";
import { MAX_LINE_QUANTITY } from "./cart-storage";
import type { Destination } from "./destinations";

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
  const { lines, setQuantity, hydrated } = useCart();

  const productLines = hydrated ? lines.filter((l) => l.productId === product.id) : [];
  const totalQty = productLines.reduce((sum, l) => sum + l.quantity, 0);
  /* Uma única variação no carrinho: -/+ age direto nela. Várias: o "+" abre o modal para montar outra. */
  const single = productLines.length === 1 ? productLines[0] : null;
  const showStepper = !unavailable && totalQty > 0;

  return (
    <div className="relative">
      <button
        type="button"
        disabled={unavailable}
        onClick={() => onSelect(product)}
        className={cn(
          "group flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-sm animate-in fade-in duration-150 transition-[box-shadow,transform] ease-out will-change-transform hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed",
          unavailable && "opacity-60",
        )}
      >
        <div className="min-w-0 flex-1">
          {destination || bestSeller ? (
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
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
          <h3 className="font-bold leading-tight text-[#0A2540]">{product.name}</h3>
          {product.description ? (
            <p className="mt-1 line-clamp-2 text-sm text-[#475569]">{product.description}</p>
          ) : null}
          <div className="mt-2 flex items-center gap-2">
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

        <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-xl bg-[#E2E8F0] sm:h-32 sm:w-32">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt={productImageAlt(product.name, product.description, destination !== null)}
              width={128}
              height={128}
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : "auto"}
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[#94A3B8]">
              <Stamp className="h-10 w-10" strokeWidth={1.25} />
            </div>
          )}
          {!unavailable && !showStepper ? (
            <span className="absolute bottom-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-[#F59E0B] text-[#0A2540] shadow-md transition-transform duration-150 ease-out group-hover:scale-110 group-active:scale-95">
              <Plus className="h-5 w-5" strokeWidth={2.5} />
            </span>
          ) : null}
        </div>
      </button>

      {/* Irmão do card (não filho): evita <button> dentro de <button>. */}
      {showStepper ? (
        <div
          role="group"
          aria-label={`${product.name} no carrinho`}
          className="absolute bottom-[22px] right-[22px] flex h-9 items-center rounded-full bg-[#F59E0B] text-[#0A2540] shadow-md sm:bottom-6 sm:right-6"
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
