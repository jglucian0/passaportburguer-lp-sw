"use client";

import { Printer, Search } from "lucide-react";
import { useState } from "react";

import { Sheet } from "@/components/ui/sheet";
import type { AdminOrderView } from "@/infra/db/admin-orders";
import { cn, formatCents } from "@/lib/utils";

import { PAYMENT_LABELS } from "./order-ticket";

export function matchesOrderQuery(order: AdminOrderView, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  if (!q) return true;
  return String(order.orderNumber).includes(q) || order.customerName.toLowerCase().includes(q);
}

/** Gaveta lateral com os pedidos já finalizados (entregues e cancelados) do dia. */
export function HistoryDrawer({
  open,
  onOpenChange,
  orders,
  onPrint,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: AdminOrderView[];
  onPrint: (order: AdminOrderView) => void;
}) {
  const [query, setQuery] = useState("");
  const list = orders
    .filter((o) => matchesOrderQuery(o, query))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Histórico de hoje" side="right">
      <div className="space-y-3 border-b border-slate-200 p-4 pr-14">
        <h2 className="text-lg font-extrabold">Histórico Hoje ({orders.length})</h2>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar #número ou nome..."
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </label>
      </div>
      <ul className="flex-1 space-y-2 overflow-y-auto p-4">
        {list.length === 0 ? (
          <li className="rounded-xl border-2 border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            Nenhum pedido encontrado
          </li>
        ) : (
          list.map((order) => {
            const canceled = order.status === "CANCELED";
            return (
              <li
                key={order.id}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3 text-sm",
                  canceled ? "border-red-300 bg-red-50" : "border-slate-200 bg-white",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-extrabold">
                    #{order.orderNumber}
                    <span
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[10px] font-extrabold uppercase",
                        canceled ? "bg-red-600 text-white" : "bg-emerald-600 text-white",
                      )}
                    >
                      {canceled ? "Cancelado" : "Concluído"}
                    </span>
                  </p>
                  <p className="truncate text-xs text-slate-600">{order.customerName}</p>
                  <p className="truncate text-[11px] text-slate-500">
                    {PAYMENT_LABELS[order.paymentMethod]} • {formatCents(order.totalCents)}
                    {canceled && order.cancelReason ? ` • ${order.cancelReason}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onPrint(order)}
                  aria-label={`Reimprimir comanda #${order.orderNumber}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  <Printer className="h-4 w-4" />
                </button>
              </li>
            );
          })
        )}
      </ul>
    </Sheet>
  );
}
