"use client";

import type { AdminOrderView } from "@/actions/admin";
import type { OrderStatus } from "@/core/schemas/common";

import { OrderCard } from "./order-card";

type Column = {
  id: string;
  title: string;
  statuses: OrderStatus[];
  alwaysVisible: boolean;
};

const COLUMNS: Column[] = [
  { id: "awaiting", title: "Aguardando pagamento", statuses: ["AWAITING_PAYMENT"], alwaysVisible: false },
  { id: "received", title: "Novos", statuses: ["RECEIVED"], alwaysVisible: true },
  { id: "preparing", title: "Em preparo", statuses: ["PREPARING"], alwaysVisible: true },
  { id: "delivery", title: "Saiu para entrega", statuses: ["OUT_FOR_DELIVERY"], alwaysVisible: true },
  { id: "done", title: "Finalizados (24h)", statuses: ["DELIVERED", "CANCELED"], alwaysVisible: true },
];

export function OrderBoard({ orders }: { orders: AdminOrderView[] }) {
  const columns = COLUMNS.filter(
    (column) => column.alwaysVisible || orders.some((o) => column.statuses.includes(o.status)),
  );

  return (
    <div
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-[repeat(var(--cols),minmax(0,1fr))]"
      style={{ ["--cols" as string]: columns.length } as React.CSSProperties}
    >
      {columns.map((column) => {
        const columnOrders = orders
          .filter((o) => column.statuses.includes(o.status))
          // Mais antigos primeiro nas filas ativas; mais recentes primeiro nos finalizados.
          .sort((a, b) =>
            column.id === "done"
              ? b.updatedAt.localeCompare(a.updatedAt)
              : a.createdAt.localeCompare(b.createdAt),
          );

        return (
          <section key={column.id} className="min-w-0 space-y-3">
            <h2 className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-sm font-bold">
              {column.title}
              <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted">
                {columnOrders.length}
              </span>
            </h2>
            {columnOrders.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted">
                Nenhum pedido
              </p>
            ) : (
              columnOrders.map((order) => <OrderCard key={order.id} order={order} />)
            )}
          </section>
        );
      })}
    </div>
  );
}
