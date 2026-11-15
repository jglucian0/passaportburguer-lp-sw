"use client";

import { ShoppingBag, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { PublicTenant } from "@/actions/storefront";
import type { CatalogCategory } from "@/core/schemas/product";
import type { StoreStatus } from "@/core/store/opening-hours";
import { brandStyle, cn, formatCents } from "@/lib/utils";

import { CartDrawer } from "./cart-drawer";
import { CartProvider, useCart } from "./cart-provider";
import { PASSPORT_SELECT_EVENT } from "./destinations";
import { Header } from "./header";
import { DRINK_CATEGORY, MAIN_CATEGORY } from "./upsell";

const NUDGE_DISMISSED_KEY = "pb:drinks-nudge-dismissed";

function FloatingCartBar({ categories }: { categories: CatalogCategory[] }) {
  const { lines, count, subtotalCents, hydrated, openCart, isOpen } = useCart();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.sessionStorage.getItem(NUDGE_DISMISSED_KEY) === "1");
    } catch {
      /* sessionStorage indisponível: a dica só some até recarregar */
    }
  }, []);

  const drinksCategory = useMemo(
    () => categories.find((c) => DRINK_CATEGORY.test(c.name) && c.products.some((p) => p.isAvailable)),
    [categories],
  );

  /* Há prato principal (Hambúrgueres/Kids) no carrinho e nenhuma bebida? */
  const showNudge = useMemo(() => {
    if (!drinksCategory) return false;
    const categoryByProduct = new Map<string, string>();
    for (const c of categories) for (const p of c.products) categoryByProduct.set(p.id, c.name);
    const names = lines.map((l) => categoryByProduct.get(l.productId) ?? "");
    return names.some((n) => MAIN_CATEGORY.test(n)) && !names.some((n) => DRINK_CATEGORY.test(n));
  }, [categories, lines, drinksCategory]);

  function dismiss() {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(NUDGE_DISMISSED_KEY, "1");
    } catch {
      /* ignorar */
    }
  }

  function goToDrinks() {
    if (!drinksCategory) return;
    // Limpa filtros de destino/busca para que a seção de bebidas exista na página.
    window.dispatchEvent(new CustomEvent(PASSPORT_SELECT_EVENT, { detail: "all" }));
    window.setTimeout(() => {
      document
        .getElementById(`cat-${drinksCategory.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  // Esconde a barra enquanto o carrinho está aberto, para não sobrepor a gaveta.
  if (!hydrated || count === 0 || isOpen) return null;
  const nudge = showNudge && !dismissed;

  return (
    <div className="fixed bottom-3 inset-x-3 z-40 animate-in fade-in slide-in-from-bottom-4 duration-300 md:inset-x-auto md:left-1/2 md:w-full md:max-w-2xl md:-translate-x-1/2">
      {nudge ? (
        <div className="flex items-center justify-between gap-2 rounded-t-xl bg-[#0A2540] px-4 py-2 text-xs text-white">
          <span className="min-w-0 truncate">🥤 Que tal uma bebida gelada para acompanhar?</span>
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={goToDrinks}
              className="rounded-full bg-white/10 px-2.5 py-1 font-bold text-[#F59E0B] transition hover:bg-white/20 active:scale-95"
            >
              Ver Bebidas →
            </button>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dispensar sugestão"
              className="flex h-6 w-6 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      ) : null}
      <button
        type="button"
        onClick={openCart}
        className={cn(
          "flex h-14 w-full items-center justify-between bg-[#F59E0B] px-5 font-bold text-[#0A2540] shadow-xl transition duration-200 hover:brightness-105 active:scale-[0.99]",
          nudge ? "rounded-b-2xl" : "rounded-2xl",
        )}
      >
        <span className="flex items-center gap-2">
          <ShoppingBag className="h-5 w-5" />
          Ver carrinho ({count})
        </span>
        <span>{formatCents(subtotalCents)}</span>
      </button>
    </div>
  );
}

export function StorefrontShell({
  tenant,
  store,
  showCartBar = true,
  categories = [],
  children,
}: {
  tenant: PublicTenant;
  store: StoreStatus;
  showCartBar?: boolean;
  /** Cardápio, usado pelo carrinho para editar itens e sugerir bebidas/acompanhamentos. */
  categories?: CatalogCategory[];
  children: ReactNode;
}) {
  return (
    <CartProvider tenantId={tenant.id}>
      <div style={brandStyle(tenant.primaryColor)} className="min-h-dvh bg-[#071329] pb-28">
        <Header tenant={tenant} store={store} />
        <main>{children}</main>
        <footer className="border-t border-white/10 bg-[#071329] px-4 py-8 text-center text-xs text-muted">
          <p className="mb-3 font-bold text-gold">Não precisa de visto, só de vontade de saborear!</p>
          <p>
            © {new Date().getFullYear()} {tenant.name}. Todos os direitos reservados.
          </p>
          <p className="mt-1">
            <Link href="/meus-pedidos" className="underline hover:text-foreground">
              Acompanhar meus pedidos
            </Link>
          </p>
        </footer>
        {showCartBar ? <FloatingCartBar categories={categories} /> : null}
        <CartDrawer minOrderCents={tenant.minOrderCents} storeOpen={store.isOpen} categories={categories} />
      </div>
    </CartProvider>
  );
}
