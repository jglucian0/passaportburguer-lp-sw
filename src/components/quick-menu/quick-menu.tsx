"use client";

import { ChevronDown, ChevronUp, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { useState } from "react";

import type { PublicTenant } from "@/actions/storefront";
import type { CatalogCategory } from "@/core/schemas/product";
import type { StoreStatus } from "@/core/store/opening-hours";
import { Menu } from "@/components/storefront/menu";
import { CartProvider, useCart } from "@/components/storefront/cart-provider";
import { lineUnitTotal } from "@/components/storefront/cart-storage";
import { OverlayProvider, useOverlayOpen } from "@/components/storefront/overlay-context";
import { brandStyle, cn, formatCents } from "@/lib/utils";

import { QuickCheckoutForm, type CheckoutPrefill } from "./quick-checkout-form";

function QuickMenuInner({
  tenant,
  store,
  categories,
  token,
  prefill,
}: {
  tenant: PublicTenant;
  store: StoreStatus;
  categories: CatalogCategory[];
  token: string;
  prefill: CheckoutPrefill;
}) {
  const { lines, count, subtotalCents, hydrated, setQuantity, removeLine, clear } = useCart();
  const overlayOpen = useOverlayOpen();
  const [bagOpen, setBagOpen] = useState(false);
  const [step, setStep] = useState<"menu" | "details">("menu");

  const empty = !hydrated || count === 0;

  if (step === "details" && !empty) {
    return (
      <QuickCheckoutForm
        token={token}
        prefill={prefill}
        subtotalCents={subtotalCents}
        lines={lines.map((l) => ({
          key: l.key,
          text: `${l.quantity}x ${l.name}`,
          detail:
            [
              l.addons.length ? `+ ${l.addons.map((a) => `${a.quantity > 1 ? `${a.quantity}x ` : ""}${a.name}`).join(", ")}` : "",
              l.note ? `obs: ${l.note}` : "",
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
          totalCents: lineUnitTotal(l) * l.quantity,
        }))}
        items={lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          addons: l.addons.map((a) => ({ addonId: a.addonId, quantity: a.quantity })),
          notes: l.note || undefined,
        }))}
        onBack={() => setStep("menu")}
        onSubmitted={clear}
      />
    );
  }

  return (
    <div style={brandStyle(tenant.primaryColor)} className="min-h-dvh bg-[#071329]">
      <header className="flex h-16 items-center justify-center border-b border-white/10 bg-[#071329]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo_passaporteburguer_nav.min.webp" alt={tenant.name} className="h-10 w-auto object-contain" />
      </header>

      <main className="pb-40">
        <p className="bg-[#0A2540] px-4 py-3 text-center text-sm text-white/80">
          Escolha seus itens, informe a entrega e pague pelo link. Eu aviso no WhatsApp quando o pagamento cair.
        </p>
        <Menu categories={categories} storeOpen={store.isOpen} />
      </main>

      {!overlayOpen ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(0,0,0,0.15)]">
          {bagOpen && !empty ? (
            <ul className="max-h-[45dvh] divide-y divide-slate-100 overflow-y-auto px-4">
              {lines.map((l) => (
                <li key={l.key} className="flex items-center gap-3 py-3 text-[#0A2540]">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{l.name}</p>
                    {l.addons.length > 0 ? (
                      <p className="truncate text-xs text-slate-500">
                        + {l.addons.map((a) => `${a.quantity > 1 ? `${a.quantity}x ` : ""}${a.name}`).join(", ")}
                      </p>
                    ) : null}
                    {l.note ? <p className="truncate text-xs italic text-slate-500">obs: {l.note}</p> : null}
                    <p className="text-xs font-bold text-amber-600">{formatCents(lineUnitTotal(l) * l.quantity)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Diminuir"
                      onClick={() => setQuantity(l.key, l.quantity - 1)}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-5 text-center text-sm font-bold">{l.quantity}</span>
                    <button
                      type="button"
                      aria-label="Aumentar"
                      onClick={() => setQuantity(l.key, l.quantity + 1)}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F59E0B]"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Remover item"
                      onClick={() => removeLine(l.key)}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="space-y-2 p-3">
            {!store.isOpen ? (
              <p className="text-center text-xs text-slate-500">A loja está fechada no momento.</p>
            ) : null}
            {!empty ? (
              <button
                type="button"
                onClick={() => setBagOpen((v) => !v)}
                className="mx-auto flex items-center gap-1 text-xs font-semibold text-slate-600"
              >
                Sacola ({count} {count === 1 ? "item" : "itens"})
                {bagOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setStep("details")}
              disabled={empty || !store.isOpen}
              className={cn(
                "flex h-14 w-full items-center justify-center gap-2 rounded-2xl px-4 font-bold shadow-lg transition active:scale-[0.99]",
                empty || !store.isOpen
                  ? "cursor-not-allowed bg-slate-200 text-slate-400"
                  : "bg-[#25D366] text-[#052e16] hover:brightness-105",
              )}
            >
              <ShoppingBag className="h-5 w-5" />
              {empty ? "Escolha seus itens" : `Continuar (${formatCents(subtotalCents)})`}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Cardápio Rápido: mesmo cardápio do site (Menu + ProductModal), sem login. Depois da sacola vem a etapa de
 * dados (entrega/endereço/cadastro) e o pagamento.
 * A sacola usa chave de armazenamento própria para não misturar com o carrinho do site.
 */
export function QuickMenu(props: {
  tenant: PublicTenant;
  store: StoreStatus;
  categories: CatalogCategory[];
  token: string;
  prefill: CheckoutPrefill;
}) {
  return (
    <CartProvider tenantId={`quick-${props.tenant.id}`}>
      <OverlayProvider>
        <QuickMenuInner {...props} />
      </OverlayProvider>
    </CartProvider>
  );
}
