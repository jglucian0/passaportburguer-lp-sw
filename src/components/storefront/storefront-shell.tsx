"use client";

import { ShoppingBag, Ticket, UserCheck, UtensilsCrossed, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { PublicTenant } from "@/actions/storefront";
import type { CatalogCategory } from "@/core/schemas/product";
import type { StoreStatus } from "@/core/store/opening-hours";
import { brandStyle, cn, formatCents } from "@/lib/utils";
import { scrollToElement } from "@/lib/smooth-scroll";

import { CartDrawer } from "./cart-drawer";
import { CartProvider, useCart } from "./cart-provider";
import { ACTIVE_ORDER_KEY, ORDER_PLACED_FLAG } from "./cart-storage";
import { useCustomerFirstName } from "./use-customer";
import { PASSPORT_SELECT_EVENT } from "./destinations";
import { Footer } from "./footer";
import { effectiveMinOrderCents } from "@/core/store/min-order";

import { Header } from "./header";
import { OverlayProvider, useOverlayOpen } from "./overlay-context";
import { DRINK_CATEGORY, MAIN_CATEGORY } from "./upsell";

/** Telas de pagamento (/pedido/[id]/pagamento e /pagamento/[id]): foco total no Pix/cartão, sem sacola nem tab bar. */
export function isPaymentRoute(pathname: string): boolean {
  return /^\/pedido\/[^/]+\/pagamento/.test(pathname) || pathname.startsWith("/pagamento/");
}

/** Pedido recém-criado: ao chegar na tela de pagamento, zera a sacola (memória + localStorage). */
function PaymentCartReset({ tenantId }: { tenantId: string }) {
  const pathname = usePathname();
  const { clear, hydrated } = useCart();

  useEffect(() => {
    if (!hydrated || !isPaymentRoute(pathname)) return;
    try {
      if (window.sessionStorage.getItem(ORDER_PLACED_FLAG) === tenantId) {
        clear();
        window.sessionStorage.removeItem(ORDER_PLACED_FLAG);
      }
    } catch {
      /* sessionStorage indisponível: a sacola segue oculta nesta rota de qualquer forma */
    }
  }, [hydrated, pathname, tenantId, clear]);

  return null;
}

const NUDGE_DISMISSED_KEY = "pb:drinks-nudge-dismissed";

function FloatingCartBar({ categories }: { categories: CatalogCategory[] }) {
  const { lines, count, subtotalCents, hydrated, openCart, isOpen } = useCart();
  const [dismissed, setDismissed] = useState(false);
  const overlayOpen = useOverlayOpen();
  const pathname = usePathname();

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
      scrollToElement(document.getElementById(`cat-${drinksCategory.id}`));
    }, 80);
  }

  // Esconde a barra enquanto o carrinho ou um modal está aberto, para não sobrepor.
  if (!hydrated || count === 0 || isOpen || overlayOpen || isPaymentRoute(pathname)) return null;
  const nudge = showNudge && !dismissed;

  return (
    <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] inset-x-3 z-40 animate-in fade-in slide-in-from-bottom-4 duration-300 md:bottom-3 md:inset-x-auto md:left-1/2 md:w-full md:max-w-2xl md:-translate-x-1/2">
      {nudge ? (
        <div className="flex items-center justify-between gap-2 rounded-t-xl bg-[#0A2540] px-4 py-2 text-xs text-white">
          <span className="min-w-0 truncate">
            <span className="md:hidden">🥤 Que tal uma bebida gelada?</span>
            <span className="hidden md:inline">🥤 Que tal uma bebida gelada para acompanhar?</span>
          </span>
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
          "flex h-14 w-full items-center justify-between bg-[#0A2540] px-5 font-bold text-white shadow-xl ring-2 ring-[#F59E0B] transition duration-200 hover:brightness-110 active:scale-[0.99]",
          nudge ? "rounded-b-2xl" : "rounded-2xl",
        )}
      >
        <span className="flex items-center gap-2">
          <ShoppingBag className="h-5 w-5 text-[#F59E0B]" />
          Ver sacola • {count} {count === 1 ? "item" : "itens"}
        </span>
        <span className="text-[#F59E0B]">{formatCents(subtotalCents)}</span>
      </button>
    </div>
  );
}

function BottomTabBar() {
  const pathname = usePathname();
  const { isOpen, count, hydrated, openCart } = useCart();
  const overlayOpen = useOverlayOpen();
  const [hasActiveOrder, setHasActiveOrder] = useState(false);
  const firstName = useCustomerFirstName();

  useEffect(() => {
    function read() {
      try {
        setHasActiveOrder(window.localStorage.getItem(ACTIVE_ORDER_KEY) === "1");
      } catch {
        /* armazenamento indisponível: sem indicador/nome */
      }
    }
    read();
    window.addEventListener("pb:active-order-change", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("pb:active-order-change", read);
      window.removeEventListener("storage", read);
    };
  }, [pathname]);

  // O checkout tem a própria barra fixa de ação; carrinho/modal abertos também escondem a tab bar.
  if (isOpen || overlayOpen || pathname.startsWith("/checkout") || isPaymentRoute(pathname)) return null;

  const onMenu = pathname === "/";
  const onOrders = pathname.startsWith("/meus-pedidos");

  function goToMenu(event: React.MouseEvent) {
    if (pathname !== "/") return;
    const target = document.getElementById("cardapio");
    if (!target) return;
    event.preventDefault();
    scrollToElement(target);
    window.history.replaceState(null, "", "/#cardapio");
  }

  const itemClass = (active: boolean) =>
    cn(
      "relative flex h-full flex-col items-center justify-center gap-0.5 text-[11px] transition active:scale-95",
      active ? "font-semibold text-amber-500" : "font-medium text-slate-500",
    );
  const indicator = (active: boolean) =>
    active ? <span aria-hidden="true" className="absolute inset-x-6 top-0 h-0.5 rounded-b bg-amber-500" /> : null;

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-30 box-content grid h-14 grid-cols-3 items-center border-t border-slate-200/80 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_rgba(0,0,0,0.06)] backdrop-blur-md md:hidden"
    >
      <Link
        href="/#cardapio"
        onClick={goToMenu}
        aria-current={onMenu ? "page" : undefined}
        className={itemClass(onMenu)}
      >
        {indicator(onMenu)}
        <UtensilsCrossed size={20} strokeWidth={1.75} />
        <span className="max-w-full truncate px-1">Cardápio</span>
      </Link>

      <Link
        href="/meus-pedidos"
        aria-current={onOrders ? "page" : undefined}
        className={itemClass(onOrders)}
      >
        {indicator(onOrders)}
        <span className="relative">
          {firstName ? <UserCheck size={20} strokeWidth={1.75} /> : <Ticket size={20} strokeWidth={1.75} />}
          {hasActiveOrder ? (
            <span className="absolute -right-1 -top-0.5 flex h-2 w-2" aria-label="Pedido em andamento">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
          ) : null}
        </span>
        <span className="max-w-full truncate px-1">{firstName ?? "Passaporte"}</span>
      </Link>

      <button
        type="button"
        onClick={openCart}
        aria-label={`Abrir sacola${hydrated && count > 0 ? ` com ${count} item(ns)` : ""}`}
        className={itemClass(false)}
      >
        <span className="relative">
          <ShoppingBag size={20} strokeWidth={1.75} />
          {hydrated && count > 0 ? (
            <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-slate-950">
              {count}
            </span>
          ) : null}
        </span>
        <span>Sacola</span>
      </button>
    </nav>
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
  const pathname = usePathname();
  return (
    <CartProvider tenantId={tenant.id}>
      <OverlayProvider>
      <div style={brandStyle(tenant.primaryColor)} className="min-h-dvh bg-[#071329]">
        <PaymentCartReset tenantId={tenant.id} />
        <Header tenant={tenant} store={store} />
        <main>{children}</main>
        <Footer tenant={tenant} />
        {showCartBar ? <FloatingCartBar categories={categories} /> : null}
        <BottomTabBar />
        {isPaymentRoute(pathname) ? null : <CartDrawer minOrderCents={effectiveMinOrderCents(tenant.minOrderCents)} storeOpen={store.isOpen} categories={categories} />}
      </div>
      </OverlayProvider>
    </CartProvider>
  );
}
