"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Minus, Plus, Stamp, X } from "lucide-react";
import { useMemo, useState } from "react";

import { getProductDisplayPrice } from "@/core/menu/pricing";
import type { CatalogAddon, CatalogAddonGroup, CatalogProduct } from "@/core/schemas/product";
import { cn, formatCents } from "@/lib/utils";

import { useCart } from "./cart-provider";
import { matchDestination } from "./destinations";
import { MAX_LINE_QUANTITY, type CartLine, type CartLineAddon } from "./cart-storage";
import { useRegisterOverlay } from "./overlay-context";
import { MAIN_CATEGORY, isDrinkGroup, isDrinkProduct } from "./upsell";

const NOTE_MAX = 140;

/* Fotos das cidades em public/cidades (nomes dos arquivos como estão na pasta). */
const CITY_BACKGROUNDS: Record<string, string> = {
  "st-louis": "/cidades/backgorund-stloius.webp",
  mexico: "/cidades/backgorund-mexico.webp",
  tokyo: "/cidades/backgorund-tokyo.webp",
  "buenos-aires": "/cidades/backgorund-buenosaires.webp",
  milao: "/cidades/backgorund-milao.webp",
  cremona: "/cidades/backgorund-cremona.webp",
  corbin: "/cidades/backgorund-corbin.webp",
  gwangju: "/cidades/backgorund-gwangju.webp",
};

function groupHint(group: CatalogAddonGroup): string {
  if (group.minSelections > 0 && group.minSelections === group.maxSelections) {
    return `Escolha ${group.minSelections}`;
  }
  if (group.minSelections > 0) return `Escolha de ${group.minSelections} a ${group.maxSelections}`;
  return `Opcional, até ${group.maxSelections}`;
}

/** Botão +/- padronizado (adicionais e rodapé). */
function StepButton({
  kind,
  label,
  disabled,
  onClick,
}: {
  kind: "minus" | "plus";
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const Icon = kind === "plus" ? Plus : Minus;
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition",
        disabled
          ? "cursor-not-allowed bg-slate-100 text-slate-300"
          : kind === "plus"
            ? "bg-[#F59E0B] text-[#0A2540] hover:brightness-105"
            : "bg-slate-200 text-[#0A2540] hover:bg-slate-300",
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={2.5} />
    </button>
  );
}

export function ProductModal({
  product,
  storeOpen,
  onClose,
  editing,
  categoryName,
  upsells = [],
}: {
  product: CatalogProduct;
  storeOpen: boolean;
  onClose: () => void;
  /** Linha do carrinho a editar: o modal abre preenchido e substitui a linha ao confirmar. */
  editing?: CartLine;
  /** Categoria do produto: a prateleira "Complete seu embarque" só aparece em Hambúrgueres/Kids. */
  categoryName?: string;
  upsells?: CatalogProduct[];
}) {
  const { addLine, removeLine } = useCart();
  useRegisterOverlay();
  const [extras, setExtras] = useState<Set<string>>(() => new Set());
  const [quantity, setQuantity] = useState(editing?.quantity ?? 1);
  const [selection, setSelection] = useState<Record<string, number>>(() =>
    Object.fromEntries((editing?.addons ?? []).map((a) => [a.addonId, a.quantity])),
  );
  const [note, setNote] = useState(editing?.note ?? "");

  const groups = useMemo(
    () => [...product.addonGroups].sort((a, b) => a.sortOrder - b.sortOrder),
    [product.addonGroups],
  );

  const displayPrice = getProductDisplayPrice(product);

  /* Fundo desfocado: hambúrguer usa a foto da cidade (public/cidades/<destino>.webp);
   * combos, bebidas etc. usam a própria foto do produto. */
  const destination =
    categoryName && MAIN_CATEGORY.test(categoryName)
      ? matchDestination(categoryName, product.name)
      : null;
  const cityUrl = destination ? CITY_BACKGROUNDS[destination.id] : undefined;
  const atmosphereUrl = cityUrl ?? product.imageUrl;

  const groupCount = (group: CatalogAddonGroup) =>
    group.addons.reduce((sum, a) => sum + (selection[a.id] ?? 0), 0);

  const isValid = groups.every((g) => {
    const count = groupCount(g);
    return count >= g.minSelections && count <= g.maxSelections;
  });

  const selectedAddons: CartLineAddon[] = groups.flatMap((g) =>
    g.addons
      .filter((a) => (selection[a.id] ?? 0) > 0)
      .map((a) => ({
        addonId: a.id,
        name: a.name,
        priceCents: a.priceCents,
        quantity: selection[a.id],
      })),
  );

  const unitTotal =
    product.priceCents + selectedAddons.reduce((sum, a) => sum + a.priceCents * a.quantity, 0);
  const shelf = useMemo(
    () => {
      if (editing || !categoryName || !MAIN_CATEGORY.test(categoryName)) return [];
      const norm = (v: string) => v.trim().toLowerCase();
      const hasDrinkGroup = groups.some((g) => isDrinkGroup(g.name));
      const addonNames = new Set(groups.flatMap((g) => g.addons.map((a) => norm(a.name))));
      return upsells.filter(
        (u) =>
          u.id !== product.id &&
          !addonNames.has(norm(u.name)) &&
          !(hasDrinkGroup && isDrinkProduct(u.name)),
      );
    },
    [editing, categoryName, upsells, product.id, groups],
  );
  const chosenExtras = shelf.filter((u) => extras.has(u.id));
  const total =
    unitTotal * quantity + chosenExtras.reduce((sum, u) => sum + u.priceCents, 0);

  function toggleExtra(id: string) {
    setExtras((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function pickSingle(group: CatalogAddonGroup, addonId: string) {
    setSelection((prev) => {
      const next = { ...prev };
      const wasSelected = (prev[addonId] ?? 0) > 0;
      for (const a of group.addons) delete next[a.id];
      if (!(wasSelected && group.minSelections === 0)) next[addonId] = 1;
      return next;
    });
  }

  function changeMulti(group: CatalogAddonGroup, addon: CatalogAddon, delta: number) {
    const addonId = addon.id;
    setSelection((prev) => {
      const current = prev[addonId] ?? 0;
      const count = group.addons.reduce((sum, a) => sum + (prev[a.id] ?? 0), 0);
      if (delta > 0 && (count >= group.maxSelections || current >= addon.maxQuantity)) return prev;
      const nextQty = Math.max(0, current + delta);
      const next = { ...prev };
      if (nextQty === 0) delete next[addonId];
      else next[addonId] = nextQty;
      return next;
    });
  }

  function handleAdd() {
    const trimmed = note.trim();
    if (editing) removeLine(editing.key);
    addLine({
      productId: product.id,
      name: product.name,
      imageUrl: product.imageUrl,
      unitPriceCents: product.priceCents,
      quantity,
      addons: selectedAddons,
      ...(trimmed ? { note: trimmed } : {}),
    });
    for (const extra of chosenExtras) {
      addLine({
        productId: extra.id,
        name: extra.name,
        imageUrl: extra.imageUrl,
        unitPriceCents: extra.priceCents,
        quantity: 1,
        addons: [],
      });
    }
    onClose();
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        {/* O overlay centraliza o modal; clique fora (ou ESC) fecha via Radix. */}
        <Dialog.Overlay className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
          <Dialog.Content
            aria-describedby={undefined}
            className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white text-[#0A2540] shadow-2xl focus:outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          >
            <Dialog.Title className="sr-only">{product.name}</Dialog.Title>
            <Dialog.Close
              aria-label="Fechar"
              className="absolute right-3 top-3 z-20 flex items-center justify-center rounded-full bg-black/50 p-2 text-white backdrop-blur-md transition hover:bg-black/70"
            >
              <X className="h-5 w-5" />
            </Dialog.Close>

            <div className="light-scrollbar min-h-0 flex-1 overflow-y-auto">
              <div className="relative flex h-56 items-center justify-center overflow-hidden bg-slate-950 sm:h-64">
                {atmosphereUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={atmosphereUrl}
                    alt=""
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-0 h-full w-full object-cover",
                      !cityUrl && "scale-125 opacity-60 blur-sm",
                    )}
                  />
                ) : null}
                {!cityUrl ? <div className="absolute inset-0 bg-black/40" /> : null}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-black/20" />
                {product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <div className="relative z-10 mx-auto h-48 w-48 overflow-hidden rounded-2xl bg-slate-900/50 shadow-[0_16px_32px_rgba(0,0,0,0.6)] ring-2 ring-white/15 sm:h-56 sm:w-56">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="h-full w-full object-contain"
                    />
                  </div>
                ) : (
                  <Stamp className="relative z-10 h-12 w-12 text-slate-500" strokeWidth={1.25} />
                )}
              </div>

              <div className="space-y-5 p-4">
                <div className="border-b border-slate-200 bg-[#F8FAFC] -mx-4 -mt-4 px-4 py-4">
                  <h2 className="text-xl font-extrabold text-[#0A2540]">{product.name}</h2>
                  {product.description ? (
                    <p className="mt-1 text-sm text-slate-600">{product.description}</p>
                  ) : null}
                  <p className="mt-2 text-lg font-extrabold text-[#0A2540]">
                    {displayPrice.from ? (
                      <span className="mr-1 text-xs font-semibold text-slate-500">a partir de</span>
                    ) : null}
                    {formatCents(displayPrice.cents)}
                  </p>
                </div>

                {groups.map((group) => {
                  const count = groupCount(group);
                  const single = group.maxSelections === 1;
                  const invalid = count < group.minSelections;

                  return (
                    <fieldset key={group.id} className="space-y-2">
                      <legend className="flex w-full items-center justify-between gap-2">
                        <span className="font-bold text-[#0A2540]">{group.name}</span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-semibold",
                            invalid ? "bg-amber-100 text-amber-900" : "bg-blue-50 text-blue-900",
                          )}
                        >
                          {groupHint(group)}
                        </span>
                      </legend>

                      <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
                        {group.addons.map((addon) => {
                          const qty = selection[addon.id] ?? 0;
                          const disabled = !addon.isAvailable;

                          return (
                            <div
                              key={addon.id}
                              {...(single
                                ? {
                                    role: "radio",
                                    "aria-checked": qty > 0,
                                    "aria-disabled": disabled,
                                    "aria-label": addon.name,
                                    tabIndex: disabled ? -1 : 0,
                                    onClick: () => {
                                      if (!disabled) pickSingle(group, addon.id);
                                    },
                                    onKeyDown: (e: React.KeyboardEvent) => {
                                      if (disabled || (e.key !== "Enter" && e.key !== " ")) return;
                                      e.preventDefault();
                                      pickSingle(group, addon.id);
                                    },
                                  }
                                : {})}
                              className={cn(
                                "flex items-center justify-between gap-3 px-3 py-2.5 transition-colors",
                                single && !disabled && "cursor-pointer hover:bg-slate-50",
                                single && disabled && "cursor-not-allowed",
                                qty > 0 && "bg-amber-50/40",
                                disabled && "opacity-40",
                              )}
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-[#0A2540]">{addon.name}</p>
                                <p className="text-xs text-slate-500">
                                  {disabled
                                    ? "Indisponível"
                                    : addon.priceCents > 0
                                      ? `+ ${formatCents(addon.priceCents)}`
                                      : "Grátis"}
                                  {!disabled && !single && addon.maxQuantity > 1
                                    ? ` • até ${addon.maxQuantity}x`
                                    : ""}
                                </p>
                              </div>

                              {single ? (
                                <span
                                  aria-hidden="true"
                                  className={cn(
                                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2",
                                    qty > 0 ? "border-[#F59E0B]" : "border-slate-300",
                                  )}
                                >
                                  {qty > 0 ? (
                                    <span className="h-3 w-3 rounded-full bg-[#F59E0B]" />
                                  ) : null}
                                </span>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <StepButton
                                    kind="minus"
                                    label={`Remover ${addon.name}`}
                                    disabled={disabled || qty === 0}
                                    onClick={() => changeMulti(group, addon, -1)}
                                  />
                                  <span className="w-5 text-center text-sm font-bold">{qty}</span>
                                  <StepButton
                                    kind="plus"
                                    label={`Adicionar ${addon.name}`}
                                    disabled={
                                      disabled || count >= group.maxSelections || qty >= addon.maxQuantity
                                    }
                                    onClick={() => changeMulti(group, addon, 1)}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </fieldset>
                  );
                })}

                {shelf.length > 0 ? (
                  <section aria-labelledby="upsell-title" className="space-y-2">
                    <h3 id="upsell-title" className="font-bold text-[#0A2540]">
                      Complete seu embarque
                    </h3>
                    <ul className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1">
                      {shelf.map((item) => {
                        const added = extras.has(item.id);
                        return (
                          <li
                            key={item.id}
                            className={cn(
                              "flex w-32 shrink-0 flex-col rounded-xl border p-2 transition-colors",
                              added ? "border-amber-500 bg-amber-50" : "border-slate-200 bg-white",
                            )}
                          >
                            <div className="flex h-14 w-full items-center justify-center overflow-hidden rounded-lg bg-[#E2E8F0] text-[#94A3B8]">
                              {item.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={item.imageUrl}
                                  alt=""
                                  loading="lazy"
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <Stamp className="h-6 w-6" strokeWidth={1.25} />
                              )}
                            </div>
                            <p className="mt-1.5 line-clamp-2 min-h-[2rem] text-xs font-semibold leading-tight text-[#0A2540]">
                              {item.name}
                            </p>
                            <p className="text-xs font-bold text-slate-600">
                              + {formatCents(item.priceCents)}
                            </p>
                            <button
                              type="button"
                              aria-pressed={added}
                              onClick={() => toggleExtra(item.id)}
                              className={cn(
                                "mt-1.5 h-8 rounded-lg text-xs font-bold transition active:scale-95",
                                added
                                  ? "bg-emerald-600 text-white"
                                  : "bg-[#F59E0B] text-[#0A2540] hover:brightness-105",
                              )}
                            >
                              {added ? "✓ Adicionado" : "Adicionar"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ) : null}

                <div className="space-y-1.5">
                  <label htmlFor="product-note" className="font-bold text-[#0A2540]">
                    Alguma observação?
                  </label>
                  <textarea
                    id="product-note"
                    rows={2}
                    maxLength={NOTE_MAX}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Ex: Tirar cebola roxa, ponto da carne, maionese à parte..."
                    className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#0A2540] placeholder:text-slate-400 focus:border-[#F59E0B] focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/30"
                  />
                  <p className="text-right text-xs tabular-nums text-slate-500">
                    {note.length}/{NOTE_MAX}
                  </p>
                </div>
              </div>
            </div>

            <div className="shrink-0 space-y-3 border-t border-slate-200 bg-white p-4">
              {!storeOpen ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                  Loja fechada: você pode montar o carrinho, mas só conseguirá finalizar quando
                  abrirmos.
                </p>
              ) : null}

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-1.5">
                  <StepButton
                    kind="minus"
                    label="Diminuir quantidade"
                    disabled={quantity <= 1}
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  />
                  <span className="w-6 text-center font-bold">{quantity}</span>
                  <StepButton
                    kind="plus"
                    label="Aumentar quantidade"
                    disabled={quantity >= MAX_LINE_QUANTITY}
                    onClick={() => setQuantity((q) => Math.min(MAX_LINE_QUANTITY, q + 1))}
                  />
                </div>

                <button
                  type="button"
                  disabled={!isValid || !product.isAvailable}
                  onClick={handleAdd}
                  className="flex h-12 flex-1 items-center justify-between rounded-xl bg-[#F59E0B] px-4 font-bold text-[#0A2540] transition hover:brightness-105 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  <span>{isValid ? (editing ? "Atualizar" : "Adicionar") : "Complete as escolhas"}</span>
                  <span>{formatCents(total)}</span>
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
