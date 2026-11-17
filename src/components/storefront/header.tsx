"use client";

import { BookUser, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { PublicTenant } from "@/actions/storefront";
import type { StoreStatus } from "@/core/store/opening-hours";
import { cn } from "@/lib/utils";
import { scrollToElement } from "@/lib/smooth-scroll";

import { useCart } from "./cart-provider";
import { useCustomerFirstName } from "./use-customer";

const LINKS = [
  { href: "/#cardapio", label: "Cardápio", ready: true },
  { href: "/#cardapio", label: "Fidelidade", ready: false },
  { href: "/meus-pedidos", label: "Meu Passaporte", ready: true },
] as const;

export function Header({ tenant, store }: { tenant: PublicTenant; store: StoreStatus }) {
  const { count, hydrated, openCart } = useCart();
  const pathname = usePathname();
  const firstName = useCustomerFirstName();

  /* Já na home: rola direto até o cardápio, sem nova navegação ao servidor. */
  function onNavClick(event: React.MouseEvent, href: string) {
    if (pathname !== "/" || !href.startsWith("/#")) return;
    const target = document.getElementById(href.slice(2));
    if (!target) return;
    event.preventDefault();
    scrollToElement(target);
    window.history.replaceState(null, "", href);
  }

  return (
    <header className="relative z-50 h-20 md:sticky md:top-0 border-b border-white/10 bg-[#071329]">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 px-4">
        {/* Marca */}
        <Link href="/" className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo_passaportburguer_nav.min.webp"
            alt={tenant.name}
            className="h-12 w-auto shrink-0 object-contain"
          />
        </Link>

        {/* Navegação */}
        <nav className="hidden items-center gap-8 md:flex">
          {LINKS.map(({ href, label, ready }) =>
            ready ? (
              <Link
                key={label}
                href={href}
                onClick={(e) => onNavClick(e, href)}
                className="text-sm font-medium text-white transition hover:text-gold"
              >
                {label}
              </Link>
            ) : (
              <span
                key={label}
                title="Em breve"
                className="cursor-default text-sm font-medium text-white/40"
              >
                {label}
                <span className="ml-1 text-[10px] uppercase tracking-wide">em breve</span>
              </span>
            ),
          )}
        </nav>

        {/* Ações */}
        <div className="flex items-center gap-2 sm:gap-3">
          <span
            className={cn(
              "inline-block rounded-full px-2.5 py-1 text-xs font-semibold md:hidden lg:inline-block",
              store.isOpen ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300",
            )}
          >
            {store.isOpen ? "Aberto" : "Fechado"}
          </span>

          <Link
            href="/meus-pedidos"
            className="hidden rounded-lg border border-white/80 px-4 md:block py-2 text-sm font-medium text-white transition hover:bg-white/10"
          >
            {firstName ? (
              <span className="flex items-center gap-2">
                <BookUser className="h-4 w-4 text-gold" strokeWidth={1.75} />
                Olá, {firstName}
              </span>
            ) : (
              "Fazer Login"
            )}
          </Link>

          <button
            type="button"
            onClick={openCart}
            aria-label={`Abrir carrinho${hydrated && count > 0 ? ` com ${count} item(ns)` : ""}`}
            className="relative hidden h-11 w-11 items-center md:flex justify-center rounded-lg text-white transition hover:bg-white/10"
          >
            <ShoppingBag className="h-6 w-6" strokeWidth={1.75} />
            {hydrated && count > 0 ? (
              <span className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-xs font-extrabold text-ink">
                {count}
              </span>
            ) : null}
          </button>
        </div>
      </div>
    </header>
  );
}
