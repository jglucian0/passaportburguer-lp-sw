"use client";

import { Bike, LogOut, Settings, ShoppingBag, UtensilsCrossed, Wallet } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { logoutAdmin } from "@/actions/auth";
import type { AdminRole } from "@/core/schemas/common";
import { cn } from "@/lib/utils";

import { StoreStatusSwitch } from "./store-status-switch";

const NAV: readonly { href: string; label: string; icon: typeof ShoppingBag; ownerOnly?: boolean }[] = [
  { href: "/admin/pedidos", label: "Pedidos", icon: ShoppingBag },
  { href: "/admin/cardapio", label: "Cardápio", icon: UtensilsCrossed },
  { href: "/admin/financeiro", label: "Financeiro", icon: Wallet, ownerOnly: true },
  { href: "/admin/entregas", label: "Entregas", icon: Bike, ownerOnly: true },
  { href: "/admin/config", label: "Config", icon: Settings, ownerOnly: true },
];

export function AdminShell({
  userName,
  role,
  children,
  fitViewport = false,
}: {
  userName: string;
  role: AdminRole;
  children: ReactNode;
  /** Trava o conteúdo na altura útil da tela (desktop); a rolagem passa a ser interna. */
  fitViewport?: boolean;
}) {
  const pathname = usePathname();
  const nav = NAV.filter((item) => !item.ownerOnly || role === "OWNER");

  return (
    <div className="admin-light min-h-dvh bg-slate-100 text-slate-900">
      <header className="admin-navy sticky top-0 z-40 border-b border-slate-800 bg-[#071329] text-white">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/admin/pedidos" className="flex shrink-0 items-center gap-2" aria-label="Passaporte Burguer — painel">
              <Image
                src="/logo_passaportburguer_nav.webp"
                alt="Passaporte Burguer"
                width={126}
                height={34}
                priority
                className="h-8 w-auto"
              />
            </Link>
            <nav className="hidden items-center gap-1 sm:flex">
              {nav.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition",
                      active
                        ? "bg-brand text-[#071329]"
                        : "text-slate-300 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <StoreStatusSwitch />
            <span className="hidden text-xs text-slate-400 xl:block">
              {userName} • {role === "OWNER" ? "Proprietário" : "Cozinha"}
            </span>
            <form action={logoutAdmin}>
              <button
                type="submit"
                aria-label="Sair"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden md:inline">Sair</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      <main
        className={cn(
          "mx-auto w-full max-w-[1600px] px-4 py-6 pb-24 sm:pb-6",
          fitViewport && "flex flex-col lg:h-[calc(100dvh-64px)] lg:overflow-hidden lg:py-3",
        )}
      >
        {children}
      </main>

      <nav
        className="admin-navy fixed inset-x-0 bottom-0 z-40 grid border-t border-slate-800 bg-[#071329] sm:hidden"
        style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}
      >
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold",
                active ? "text-brand" : "text-slate-400",
              )}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
