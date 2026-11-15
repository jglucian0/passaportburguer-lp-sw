"use client";

import { LogOut, Settings, ShoppingBag, UtensilsCrossed, Bike } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { logoutAdmin } from "@/actions/auth";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Pedidos", icon: ShoppingBag },
  { href: "/admin/cardapio", label: "Cardápio", icon: UtensilsCrossed },
  { href: "/admin/entregas", label: "Entregas", icon: Bike },
  { href: "/admin/config", label: "Config", icon: Settings },
] as const;

export function AdminShell({
  userName,
  role,
  children,
}: {
  userName: string;
  role: "OWNER" | "STAFF";
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-extrabold tracking-tight">
              Passaport<span className="text-brand">Admin</span>
            </span>
            <nav className="hidden items-center gap-1 sm:flex">
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition",
                      active ? "bg-brand/15 text-brand" : "text-muted hover:bg-surface-2 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted md:block">
              {userName} • {role === "OWNER" ? "Proprietário" : "Equipe"}
            </span>
            <form action={logoutAdmin}>
              <button
                type="submit"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-foreground"
              >
                <LogOut className="h-4 w-4" />
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6 pb-24 sm:pb-6">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-background/95 backdrop-blur sm:hidden">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold",
                active ? "text-brand" : "text-muted",
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
