"use client";

import { Check, ChevronDown, ChevronUp, Loader2, Minus, Plus, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { PublicTenant } from "@/actions/storefront";
import type { CatalogCategory } from "@/core/schemas/product";
import type { StoreStatus } from "@/core/store/opening-hours";
import { Menu } from "@/components/storefront/menu";
import { CartProvider, useCart } from "@/components/storefront/cart-provider";
import { lineUnitTotal } from "@/components/storefront/cart-storage";
import { OverlayProvider, useOverlayOpen } from "@/components/storefront/overlay-context";
import { brandStyle, cn, formatCents } from "@/lib/utils";

type Phase = "idle" | "sending" | "done";

function QuickMenuInner({
  tenant,
  store,
  categories,
  token,
}: {
  tenant: PublicTenant;
  store: StoreStatus;
  categories: CatalogCategory[];
  token: string;
}) {
  const { lines, count, subtotalCents, hydrated, setQuantity, removeLine, clear } = useCart();
  const overlayOpen = useOverlayOpen();
  const [bagOpen, setBagOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const empty = !hydrated || count === 0;

  async function submit() {
    if (phase !== "idle" || empty) return;
    setPhase("sending");
    setError(null);
    try {
      const res = await fetch("/api/whatsapp/cart-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          items: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            addons: l.addons.map((a) => ({ addonId: a.addonId, quantity: a.quantity })),
            notes: l.note || undefined,
          })),
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; redirectUrl: string }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !data || !data.ok) {
        setError((data && !data.ok && data.error) || "Não foi possível enviar. Tente novamente.");
        setPhase("idle");
        return;
      }
      clear();
      setBagOpen(false);
      setPhase("done");
      const url = data.redirectUrl;
      timer.current = window.setTimeout(() => {
        window.location.href = url;
      }, 1000);
    } catch {
      setError("Sem conexão. Tente novamente.");
      setPhase("idle");
    }
  }

  if (phase === "done") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#071329] p-8 text-center text-white">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
          <Check className="h-8 w-8" />
        </span>
        <p className="text-lg font-bold">Itens enviados para o atendente!</p>
        <p className="flex items-center gap-2 text-sm text-white/70">
          <Loader2 className="h-4 w-4 animate-spin" />
          Voltando para o WhatsApp...
        </p>
      </div>
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
          Escolha seus itens e toque em enviar: o atendente continua o pedido no WhatsApp.
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
            {error ? (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">
                {error}
              </p>
            ) : null}
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
              onClick={submit}
              disabled={empty || phase === "sending" || !store.isOpen}
              className={cn(
                "flex h-14 w-full items-center justify-center gap-2 rounded-2xl px-4 font-bold shadow-lg transition active:scale-[0.99]",
                empty || !store.isOpen
                  ? "cursor-not-allowed bg-slate-200 text-slate-400"
                  : "bg-[#25D366] text-[#052e16] hover:brightness-105",
              )}
            >
              {phase === "sending" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              {empty ? "Escolha seus itens" : `Enviar itens para o WhatsApp (${formatCents(subtotalCents)})`}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Cardápio Rápido: mesmo cardápio do site (Menu + ProductModal), sem login, endereço nem pagamento.
 * A sacola usa chave de armazenamento própria para não misturar com o carrinho do site.
 */
export function QuickMenu(props: {
  tenant: PublicTenant;
  store: StoreStatus;
  categories: CatalogCategory[];
  token: string;
}) {
  return (
    <CartProvider tenantId={`quick-${props.tenant.id}`}>
      <OverlayProvider>
        <QuickMenuInner {...props} />
      </OverlayProvider>
    </CartProvider>
  );
}
