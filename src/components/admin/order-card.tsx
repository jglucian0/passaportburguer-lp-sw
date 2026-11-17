"use client";

import { Bike, Loader2, MessageCircle, Phone, Store, X } from "lucide-react";
import { useState } from "react";

import { advanceOrder, cancelOrder, type AdminOrderView } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ORDER_STATUS_LABELS, canCancel, getNextStatus } from "@/core/orders/state-machine";
import type { OrderStatus, PaymentMethod } from "@/core/schemas/common";
import { formatDocument } from "@/core/validation/document";
import { cn, formatCents, formatDateTime, formatPhone, whatsappLink } from "@/lib/utils";

import { useRunAction } from "./use-run-action";

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  PIX: "PIX",
  CARD_ON_DELIVERY: "Cartão na entrega",
  CASH: "Dinheiro",
};

function advanceLabel(order: AdminOrderView): string {
  switch (order.status) {
    case "AWAITING_PAYMENT":
      return "Confirmar pagamento";
    case "RECEIVED":
      return "Iniciar preparo";
    case "PREPARING":
      return order.deliveryType === "DELIVERY" ? "Saiu para entrega" : "Entregue ao cliente";
    case "OUT_FOR_DELIVERY":
      return "Marcar como entregue";
    default:
      return "";
  }
}

const STATUS_TONE: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: "bg-amber-500/15 text-amber-400",
  RECEIVED: "bg-sky-500/15 text-sky-400",
  PREPARING: "bg-brand/15 text-brand",
  OUT_FOR_DELIVERY: "bg-violet-500/15 text-violet-400",
  DELIVERED: "bg-emerald-500/15 text-emerald-400",
  CANCELED: "bg-red-500/15 text-red-400",
};

export function OrderCard({ order }: { order: AdminOrderView }) {
  const { run, isPending, error, setError } = useRunAction();
  const [canceling, setCanceling] = useState(false);
  const [reason, setReason] = useState("");

  const next = getNextStatus(order.status, order.deliveryType);
  const cancelable = canCancel(order.status, order.deliveryType);
  const address = order.addressSnapshot;

  return (
    <article className="space-y-3 rounded-2xl border border-border bg-surface p-4 text-sm">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-extrabold">#{order.orderNumber}</h3>
          <p className="text-xs text-muted">{formatDateTime(order.createdAt)}</p>
        </div>
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", STATUS_TONE[order.status])}>
          {ORDER_STATUS_LABELS[order.status]}
        </span>
      </header>

      <div className="space-y-1">
        <p className="font-semibold">{order.customerName}</p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <a href={`tel:+55${order.customerPhone}`} className="inline-flex items-center gap-1 hover:text-foreground">
            <Phone className="h-3.5 w-3.5" /> {formatPhone(order.customerPhone)}
          </a>
          <a
            href={whatsappLink(`55${order.customerPhone}`, `Olá ${order.customerName}! Sobre seu pedido #${order.orderNumber}:`)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </a>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-surface-2 p-2.5 text-xs">
        {order.deliveryType === "DELIVERY" ? (
          <Bike className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        ) : (
          <Store className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        )}
        <div>
          <p className="font-semibold">{order.deliveryType === "DELIVERY" ? "Entrega" : "Retirada no balcão"}</p>
          {address ? (
            <p className="text-muted">
              {address.street}, {address.number}
              {address.complement ? ` - ${address.complement}` : ""} • {address.neighborhood}
              {address.reference ? ` (Ref: ${address.reference})` : ""}
            </p>
          ) : null}
        </div>
      </div>

      <ul className="space-y-1.5">
        {order.items.map((item, index) => (
          <li key={`${item.name}-${index}`}>
            <span className="font-semibold">
              {item.quantity}x {item.name}
            </span>
            {item.addons.length > 0 ? (
              <span className="block pl-4 text-xs text-muted">
                {item.addons.map((a) => (a.quantity > 1 ? `${a.quantity}x ${a.name}` : a.name)).join(", ")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {order.documentNumber ? (
        <p className="text-xs text-slate-300">
          {order.documentNumber.length === 14 ? "CNPJ" : "CPF"} na nota: {formatDocument(order.documentNumber)}
        </p>
      ) : null}

      {order.notes ? (
        <p className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-400">Obs: {order.notes}</p>
      ) : null}

      <div className="flex items-center justify-between border-t border-border pt-2 text-xs">
        <span className="text-muted">
          {PAYMENT_LABELS[order.paymentMethod]}
          {order.paymentMethod === "CASH" && order.changeForCents
            ? ` • troco p/ ${formatCents(order.changeForCents)}`
            : ""}
        </span>
        <span className="text-base font-extrabold text-brand">{formatCents(order.totalCents)}</span>
      </div>

      {order.status === "CANCELED" && order.cancelReason ? (
        <p className="rounded-lg bg-red-500/10 p-2 text-xs text-red-400">Cancelado: {order.cancelReason}</p>
      ) : null}

      {error ? <p className="text-xs text-red-400">{error}</p> : null}

      {next ? (
        <div className="space-y-2">
          {canceling ? (
            <div className="space-y-2 rounded-xl border border-red-500/30 p-2.5">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Motivo do cancelamento"
                maxLength={200}
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  className="flex-1"
                  disabled={isPending || reason.trim().length < 3}
                  onClick={() =>
                    run(
                      () => cancelOrder({ orderId: order.id, reason }),
                      () => {
                        setCanceling(false);
                        setReason("");
                      },
                    )
                  }
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Confirmar cancelamento
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCanceling(false);
                    setError(null);
                  }}
                >
                  Voltar
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={isPending}
                onClick={() => run(() => advanceOrder({ orderId: order.id }))}
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {advanceLabel(order)}
              </Button>
              {cancelable ? (
                <Button variant="outline" size="icon" aria-label="Cancelar pedido" onClick={() => setCanceling(true)}>
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}
