"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { CatalogCategory, CatalogProduct } from "@/core/schemas/product";
import { cn, formatCents } from "@/lib/utils";

import { useCart } from "./cart-provider";
import { lineTotal, type CartLine } from "./cart-storage";
import { ProductModal } from "./product-modal";

const SUGGESTION_CATEGORY = /bebida|acompanh/i;
const MAX_SUGGESTIONS = 3;

function addonsSummary(line: CartLine): string {
  return line.addons.map((a) => (a.quantity > 1 ? `+ ${a.quantity}x ${a.name}` : `+ ${a.name}`)).join(", ");
}

export function CartDrawer({
  minOrderCents,
  storeOpen,
  categories = [],
}: {
  minOrderCents: number;
  storeOpen: boolean;
  categories?: CatalogCategory[];
}) {
  const { lines, subtotalCents, isOpen, closeCart, setQuantity, removeLine, addLine } = useCart();
  const [editing, setEditing] = useState<CartLine | null>(null);
  const missing = Math.max(0, minOrderCents - subtotalCents);

  const productById = useMemo(() => {
    const map = new Map<string, CatalogProduct>();
    for (const category of categories) for (const p of category.products) map.set(p.id, p);
    return map;
  }, [categories]);

  /* Bebidas/acompanhamentos que cabem em um clique (sem escolhas obrigatórias) e ainda não estão no carrinho. */
  const suggestions = useMemo(() => {
    const inCart = new Set(lines.map((l) => l.productId));
    return categories
      .filter((c) => SUGGESTION_CATEGORY.test(c.name))
      .flatMap((c) => c.products)
      .filter(
        (p) =>
          p.isAvailable &&
          p.priceCents > 0 &&
          !inCart.has(p.id) &&
          p.addonGroups.every((g) => g.minSelections === 0),
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [categories, lines]);

  const editingProduct = editing ? productById.get(editing.productId) : undefined;

  return (
    <>
      <Dialog.Root open={isOpen} onOpenChange={(open) => !open && closeCart()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/70 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content
            aria-describedby={undefined}
            className={cn(
              "fixed z-50 flex flex-col bg-white text-[#0A2540] shadow-2xl focus:outline-none",
              "inset-x-0 bottom-0 max-h-[90vh] rounded-t-2xl",
              "md:inset-x-auto md:inset-y-0 md:bottom-auto md:right-0 md:h-full md:max-h-none md:w-full md:max-w-md md:rounded-none",
              "data-[state=closed]:animate-out data-[state=open]:animate-in",
              "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
              "md:data-[state=closed]:slide-out-to-right md:data-[state=open]:slide-in-from-right",
            )}
          >
            {/* Cabeçalho */}
            <div className="shrink-0 rounded-t-2xl border-b border-slate-200 bg-slate-50 md:rounded-none">
              <div aria-hidden="true" className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-300 md:hidden" />
              <div className="flex items-center justify-between px-4 py-3">
                <Dialog.Title className="text-lg font-extrabold text-[#0A2540]">Seu carrinho</Dialog.Title>
                <Dialog.Close
                  aria-label="Fechar carrinho"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-200"
                >
                  <X className="h-5 w-5" />
                </Dialog.Close>
              </div>
            </div>

            {lines.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center text-slate-500">
                <ShoppingBag className="h-12 w-12" strokeWidth={1.5} />
                <p className="text-sm">Seu carrinho está vazio.</p>
                <button
                  type="button"
                  onClick={closeCart}
                  className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-[#0A2540] hover:bg-slate-50"
                >
                  Ver cardápio
                </button>
              </div>
            ) : (
              <>
                <ul className="light-scrollbar min-h-0 flex-1 divide-y divide-slate-200 overflow-y-auto">
                  {lines.map((line) => {
                    const canEdit = productById.has(line.productId);
                    return (
                      <li key={line.key} className="space-y-2 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-bold leading-tight text-[#0A2540]">{line.name}</p>
                            {line.addons.length > 0 ? (
                              <p className="mt-0.5 text-xs text-slate-500">{addonsSummary(line)}</p>
                            ) : null}
                            {line.note ? (
                              <p className="mt-0.5 text-xs italic text-slate-500">Obs: {line.note}</p>
                            ) : null}
                            {canEdit ? (
                              <button
                                type="button"
                                onClick={() => setEditing(line)}
                                className="mt-1 text-xs font-semibold text-slate-500 underline underline-offset-2 hover:text-[#0A2540]"
                              >
                                Editar
                              </button>
                            ) : null}
                          </div>
                          <span className="shrink-0 text-sm font-bold text-[#0A2540]">
                            {formatCents(lineTotal(line))}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
                            <button
                              type="button"
                              aria-label="Diminuir"
                              onClick={() => setQuantity(line.key, line.quantity - 1)}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#0A2540] hover:bg-slate-200"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="w-6 text-center text-sm font-bold">{line.quantity}</span>
                            <button
                              type="button"
                              aria-label="Aumentar"
                              onClick={() => setQuantity(line.key, line.quantity + 1)}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#0A2540] hover:bg-slate-200"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                          <button
                            type="button"
                            aria-label={`Remover ${line.name}`}
                            onClick={() => removeLine(line.key)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {/* Rodapé */}
                <div className="shrink-0 space-y-3 border-t border-slate-200 bg-slate-50 p-4">
                  {suggestions.length > 0 ? (
                    <div>
                      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                        Que tal acompanhar?
                      </p>
                      <ul className="light-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                        {suggestions.map((p) => (
                          <li
                            key={p.id}
                            className="flex w-44 shrink-0 flex-col justify-between gap-2 rounded-xl border border-slate-200 bg-white p-2.5"
                          >
                            <div className="min-w-0">
                              <p className="line-clamp-2 text-xs font-semibold leading-tight text-[#0A2540]">
                                {p.name}
                              </p>
                              <p className="mt-0.5 text-xs text-slate-500">{formatCents(p.priceCents)}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                addLine({
                                  productId: p.id,
                                  name: p.name,
                                  imageUrl: p.imageUrl,
                                  unitPriceCents: p.priceCents,
                                  quantity: 1,
                                  addons: [],
                                })
                              }
                              className="rounded-lg bg-[#F59E0B] px-3 py-1.5 text-xs font-bold text-[#0A2540] hover:brightness-105"
                            >
                              Adicionar
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Subtotal</span>
                    <span className="text-base font-extrabold text-[#0A2540]">
                      {formatCents(subtotalCents)}
                    </span>
                  </div>
                  {missing > 0 ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Faltam {formatCents(missing)} para atingir o pedido mínimo de{" "}
                      {formatCents(minOrderCents)}.
                    </p>
                  ) : null}
                  <Link
                    href="/checkout"
                    onClick={closeCart}
                    aria-disabled={missing > 0}
                    className={cn(
                      "flex h-12 w-full items-center justify-center rounded-xl bg-[#F59E0B] text-base font-bold text-[#0A2540] transition hover:brightness-105",
                      missing > 0 && "pointer-events-none opacity-50",
                    )}
                  >
                    Finalizar pedido
                  </Link>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {editing && editingProduct ? (
        <ProductModal
          key={editing.key}
          product={editingProduct}
          storeOpen={storeOpen}
          editing={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
