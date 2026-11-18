"use client";

import { AlertTriangle, History, Loader2, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { getOrderTimeline, reconcileSaiposAdjustment, type OrderTimelineItem } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import type { AdminOrderView } from "@/infra/db/admin-orders";
import { cn, formatCents } from "@/lib/utils";

import { actionErrorMessage } from "./use-run-action";

const alertLabel = (type: AdminOrderView["financialAlertType"]) => (type === "CHARGEBACK" ? "Chargeback" : "Estorno");

/** Badges que separam cancelamento comum de estorno/chargeback pós-aprovação e pendência no Saipos. */
export function FinancialBadges({ order, className }: { order: AdminOrderView; className?: string }) {
  const badges: { key: string; label: string; tone: string }[] = [];
  if (order.financialAlertType === "REFUNDED") {
    badges.push({ key: "refunded", label: "Estornado no Asaas", tone: "bg-amber-500 text-black" });
  }
  if (order.financialAlertType === "CHARGEBACK") {
    badges.push({ key: "chargeback", label: "Chargeback", tone: "bg-red-600 text-white" });
  }
  if (order.saiposCancelStatus === "MANUAL_ACTION_REQUIRED") {
    badges.push({ key: "saipos", label: "Ajustar no Saipos", tone: "bg-red-100 text-red-700 ring-1 ring-red-400" });
  }
  if (badges.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {badges.map((b) => (
        <span key={b.key} className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-extrabold uppercase", b.tone)}>
          {b.label}
        </span>
      ))}
    </span>
  );
}

/** Banner global: pedidos pagos que sofreram estorno/chargeback e ainda precisam de ajuste no Saipos. */
export function SaiposAdjustBanner({
  orders,
  canReconcile,
  onChanged,
}: {
  orders: AdminOrderView[];
  /** Somente o proprietário (OWNER) confirma o ajuste. */
  canReconcile: boolean;
  onChanged: () => void;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const list = orders.filter((o) => o.saiposCancelStatus === "MANUAL_ACTION_REQUIRED");
  if (list.length === 0) return null;
  const hasChargeback = list.some((o) => o.financialAlertType === "CHARGEBACK");

  function reconcile(orderId: string) {
    setError(null);
    setPendingId(orderId);
    startTransition(async () => {
      try {
        const result = await reconcileSaiposAdjustment({ orderId });
        if (!result.ok) setError(actionErrorMessage(result));
        onChanged();
      } catch {
        setError("Não foi possível confirmar o ajuste. Tente novamente.");
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <section
      role="alert"
      className={cn(
        "shrink-0 rounded-xl border-2 p-3 text-sm",
        hasChargeback ? "border-red-500 bg-red-50 text-red-900" : "border-amber-400 bg-amber-50 text-amber-950",
      )}
    >
      <p className="flex items-center gap-2 font-extrabold">
        <AlertTriangle className="h-4 w-4" />
        {list.length === 1 ? "1 pedido precisa de ajuste no Saipos" : `${list.length} pedidos precisam de ajuste no Saipos`}
      </p>
      <p className="text-xs">
        O pagamento foi estornado/contestado, mas o Saipos não cancelou o pedido sozinho. Ajuste no PDV e confirme abaixo.
      </p>
      <ul className="mt-2 space-y-1.5">
        {list.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/70 px-2 py-1.5">
            <span className="font-extrabold">#{o.orderNumber}</span>
            <span className="tabular-nums">{formatCents(o.totalCents)}</span>
            <span className="rounded-md bg-black/10 px-1.5 py-0.5 text-[11px] font-bold uppercase">
              {alertLabel(o.financialAlertType)}
            </span>
            {canReconcile ? (
              <Button
                className="ml-auto h-8 px-3 text-xs"
                disabled={isPending}
                onClick={() => reconcile(o.id)}
              >
                {isPending && pendingId === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Confirmar ajuste no Saipos
              </Button>
            ) : (
              <span className="ml-auto text-[11px] font-semibold">Somente o proprietário confirma.</span>
            )}
          </li>
        ))}
      </ul>
      {error ? <p className="mt-1 text-xs font-semibold text-red-700">{error}</p> : null}
    </section>
  );
}

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

const DOT_TONE: Record<string, string> = {
  PAYMENT_REFUNDED: "bg-amber-500",
  PAYMENT_CHARGEBACK: "bg-red-600",
  SAIPOS_CANCEL_ATTEMPT: "bg-red-400",
  SAIPOS_RECONCILED: "bg-emerald-600",
};

/** Linha do tempo cronológica do pedido (carregada sob demanda). */
export function OrderTimelineDialog({ order, onClose }: { order: AdminOrderView; onClose: () => void }) {
  const [items, setItems] = useState<OrderTimelineItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getOrderTimeline({ orderId: order.id })
      .then((result) => {
        if (!alive) return;
        if (result.ok) setItems(result.data);
        else setError(actionErrorMessage(result));
      })
      .catch(() => alive && setError("Não foi possível carregar o histórico."));
    return () => {
      alive = false;
    };
  }, [order.id]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Histórico do pedido ${order.orderNumber}`}
      className="admin-light fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[85dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-900">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h4 className="text-lg font-extrabold">Histórico do pedido #{order.orderNumber}</h4>
            <FinancialBadges order={order} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}
        {!items && !error ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : null}
        {items && items.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum evento registrado para este pedido.</p>
        ) : null}
        {items && items.length > 0 ? (
          <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
            {items.map((item) => (
              <li key={item.id} className="relative">
                <span
                  className={cn(
                    "absolute -left-[22px] top-1 h-3 w-3 rounded-full ring-2 ring-white",
                    DOT_TONE[item.type] ?? "bg-sky-500",
                  )}
                />
                <p className="text-[11px] font-semibold tabular-nums text-slate-500">{formatWhen(item.createdAt)}</p>
                <p className="text-sm font-bold">{item.title}</p>
                {item.description ? <p className="text-xs text-slate-600">{item.description}</p> : null}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}

export function TimelineButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <Button
      variant="secondary"
      className={cn("h-10 w-10 shrink-0 px-0", className)}
      aria-label="Ver histórico do pedido"
      title="Histórico do pedido"
      onClick={onClick}
    >
      <History className="h-4 w-4" />
    </Button>
  );
}
