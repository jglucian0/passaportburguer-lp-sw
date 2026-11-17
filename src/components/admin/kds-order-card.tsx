"use client";

import { Bike, Check, Clock, Copy, ExternalLink, Loader2, MapPin, MessageCircle, Printer, Store, X } from "lucide-react";
import { useState, useTransition } from "react";

import { advanceOrder, cancelOrder } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { canCancel, getNextStatus } from "@/core/orders/state-machine";
import { formatDocument } from "@/core/validation/document";
import type { AdminOrderView } from "@/infra/db/admin-orders";
import { cn, formatCents, formatPhone, whatsappLink } from "@/lib/utils";

import { actionErrorMessage } from "./use-run-action";
import { PAYMENT_LABELS } from "./order-ticket";

/** SLA de preparo: âmbar após 15 min, vermelho após 25 min. */
export const SLA_WARN_MINUTES = 15;
export const SLA_LATE_MINUTES = 25;

export function advanceLabel(order: AdminOrderView): string {
  switch (order.status) {
    case "AWAITING_PAYMENT":
      return "Confirmar pagamento";
    case "RECEIVED":
      return "Aceitar Pedido";
    case "PREPARING":
      return "Pronto / Despachar";
    case "OUT_FOR_DELIVERY":
      return "Concluir Entrega";
    case "READY_FOR_PICKUP":
      return "Concluir Retirada";
    default:
      return "";
  }
}

function SlaBadge({ createdAt, now }: { createdAt: string; now: number }) {
  const minutes = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60_000));
  const tone =
    minutes >= SLA_LATE_MINUTES
      ? "bg-red-600 text-white"
      : minutes >= SLA_WARN_MINUTES
        ? "bg-amber-400 text-black"
        : "bg-emerald-600 text-white";

  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-extrabold tabular-nums", tone)}
      title="Tempo desde a criação do pedido"
    >
      <Clock className="h-3 w-3" />
      {minutes} min
    </span>
  );
}

function PinMenu({ latitude, longitude }: { latitude: number; longitude: number }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`https://maps.google.com/?q=${latitude},${longitude}`);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setOpen(false);
      }, 1500);
    } catch {
      /* clipboard indisponível: "Abrir no Google Maps" continua funcionando */
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:text-slate-900"
      >
        <MapPin size={12} /> Ver pino
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-border bg-background text-xs font-medium shadow-lg">
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 hover:bg-surface-2"
            >
              <ExternalLink size={12} /> Abrir no Google Maps
            </a>
            <button
              type="button"
              onClick={copy}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2"
            >
              {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
              {copied ? "Link copiado!" : "Copiar link pro motoboy"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function KdsOrderCard({
  order,
  now,
  onChanged,
  onPrint,
  dragging = false,
  detailed = false,
  onDragStartCard,
  onDragEndCard,
}: {
  order: AdminOrderView;
  now: number;
  /** Modo detalhado: mostra telefone, referência completa e CPF/CNPJ na nota. */
  detailed?: boolean;
  dragging?: boolean;
  onDragStartCard?: (order: AdminOrderView) => void;
  onDragEndCard?: () => void;
  /** Chamado após uma mudança bem-sucedida, para recarregar a lista imediatamente. */
  onChanged: () => void;
  onPrint: (order: AdminOrderView) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [reason, setReason] = useState("");

  const isActive = order.status !== "DELIVERED" && order.status !== "CANCELED";
  const next = getNextStatus(order.status, order.deliveryType);
  const cancelable = canCancel(order.status, order.deliveryType);
  const address = order.addressSnapshot;
  const isDelivery = order.deliveryType === "DELIVERY";

  function advance() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await advanceOrder({ orderId: order.id });
        if (!result.ok) setError(actionErrorMessage(result));
        onChanged();
      } catch {
        setError("Não foi possível concluir a ação. Tente novamente.");
      }
    });
  }

  function confirmCancel() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await cancelOrder({ orderId: order.id, reason });
        if (!result.ok) {
          setError(actionErrorMessage(result));
          return;
        }
        setCanceling(false);
        setReason("");
        onChanged();
      } catch {
        setError("Não foi possível cancelar. Tente novamente.");
      }
    });
  }

  return (
    <article
      draggable={next !== null && !canceling}
      onDragStart={(event) => {
        if (!next) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", order.id);
        onDragStartCard?.(order);
      }}
      onDragEnd={() => onDragEndCard?.()}
      className={cn(
        "space-y-2 rounded-xl border bg-surface p-3 text-sm transition",
        order.status === "CANCELED" ? "border-red-500/50 opacity-80" : "border-border",
        next && "cursor-grab active:cursor-grabbing",
        dragging && "scale-[0.98] opacity-50",
      )}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-xl font-extrabold leading-none">#{order.orderNumber}</h3>
        <span className="text-xs text-muted tabular-nums">
          {new Date(order.createdAt).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "America/Sao_Paulo",
          })}
        </span>
        {isActive ? <SlaBadge createdAt={order.createdAt} now={now} /> : null}
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-extrabold uppercase",
            isDelivery ? "bg-violet-500 text-white" : "bg-sky-400 text-black",
          )}
        >
          {isDelivery ? <Bike className="h-3 w-3" /> : <Store className="h-3 w-3" />}
          {isDelivery ? "Entrega" : "Retirada"}
        </span>
      </header>

      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{order.customerName}</p>
          {detailed ? <p className="text-xs text-muted">{formatPhone(order.customerPhone)}</p> : null}
        </div>
        <a
          href={whatsappLink(
            `55${order.customerPhone}`,
            `Olá ${order.customerName}! Sobre seu pedido #${order.orderNumber} no Passaporte Burguer:`,
          )}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Chamar no WhatsApp"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-2 text-xs font-bold text-white hover:bg-emerald-500"
        >
          <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
        </a>
      </div>

      {isDelivery && address ? (
        <div className="flex items-start justify-between gap-2 rounded-lg bg-surface-2 px-2 py-1.5 text-xs">
          <p className={detailed ? undefined : "line-clamp-2"}>
            {address.street}, {address.number}
            {address.complement ? ` - ${address.complement}` : ""} • {address.neighborhood}
            {address.reference && detailed ? ` (Ref: ${address.reference})` : ""}
          </p>
          {order.latitude != null && order.longitude != null ? (
            <PinMenu latitude={order.latitude} longitude={order.longitude} />
          ) : null}
        </div>
      ) : null}

      <ul className="space-y-1">
        {order.items.map((item, index) => (
          <li key={`${item.name}-${index}`}>
            <p className="text-base font-extrabold leading-tight">
              {item.quantity}x {item.name}
            </p>
            {item.addons.length > 0 ? (
              <p className="mt-0.5 rounded-md bg-amber-300 px-2 py-1 text-xs font-bold text-black">
                + {item.addons.map((a) => (a.quantity > 1 ? `${a.quantity}x ${a.name}` : a.name)).join(", ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {order.notes ? (
        <p className="rounded-md border border-amber-400 bg-amber-300 px-2 py-1 text-xs font-extrabold text-black">
          ⚠ OBS: {order.notes}
        </p>
      ) : null}

      {detailed && order.documentNumber ? (
        <p className="text-xs text-muted">
          {order.documentNumber.length === 14 ? "CNPJ" : "CPF"} na nota: {formatDocument(order.documentNumber)}
        </p>
      ) : null}

      {order.status === "CANCELED" && order.cancelReason ? (
        <p className="rounded-md bg-red-100 p-1.5 text-xs font-semibold text-red-700">
          Cancelado: {order.cancelReason}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs font-semibold text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2 border-t border-border pt-2">
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[11px] text-muted">
            {PAYMENT_LABELS[order.paymentMethod]}
            {order.paymentMethod === "CASH" && order.changeForCents
              ? ` • troco p/ ${formatCents(order.changeForCents)}`
              : ""}
          </p>
          <p className="text-lg font-extrabold text-brand">{formatCents(order.totalCents)}</p>
        </div>
        {next ? (
          <Button className="h-10 px-3 text-sm" disabled={isPending} onClick={advance}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {advanceLabel(order)}
          </Button>
        ) : null}
        {next && cancelable ? (
          <Button
            variant="outline"
            className="h-10 w-10 shrink-0 px-0"
            aria-label="Cancelar pedido"
            onClick={() => setCanceling(true)}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
        <Button
          variant="secondary"
          className="h-10 w-10 shrink-0 px-0"
          aria-label="Imprimir comanda"
          title="Imprimir comanda"
          onClick={() => onPrint(order)}
        >
          <Printer className="h-4 w-4" />
        </Button>
      </div>

      {canceling ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Cancelar pedido ${order.orderNumber}`}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget && !isPending) setCanceling(false);
          }}
        >
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-background p-5">
            <div>
              <h4 className="text-lg font-extrabold">Cancelar pedido #{order.orderNumber}?</h4>
              <p className="text-sm text-muted">O motivo fica registrado no pedido.</p>
            </div>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Motivo do cancelamento (ex.: item em falta)"
              maxLength={200}
              autoFocus
              className="min-h-24 w-full rounded-xl border border-border bg-surface p-3 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
            {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}
            <div className="flex gap-2">
              <Button
                variant="danger"
                className="flex-1"
                disabled={isPending || reason.trim().length < 3}
                onClick={confirmCancel}
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Confirmar cancelamento
              </Button>
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() => {
                  setCanceling(false);
                  setError(null);
                }}
              >
                Voltar
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
