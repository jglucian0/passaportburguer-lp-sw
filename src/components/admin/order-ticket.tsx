"use client";

import { Printer, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import type { PaymentMethod } from "@/core/schemas/common";
import type { AdminOrderView } from "@/infra/db/admin-orders";
import { formatCents, formatPhone } from "@/lib/utils";

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  PIX: "PIX",
  CARD_ON_DELIVERY: "Cartão na entrega",
  CASH: "Dinheiro",
};

type PaperWidth = 58 | 80;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

/**
 * Visualização da comanda para impressora térmica (58mm/80mm).
 * Renderizada em um portal no <body>; as regras `@media print` de globals.css
 * escondem todo o resto da página e o fundo escuro durante a impressão.
 */
export function OrderTicketDialog({
  order,
  storeName,
  onClose,
}: {
  order: AdminOrderView;
  storeName: string;
  onClose: () => void;
}) {
  const [width, setWidth] = useState<PaperWidth>(80);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = Number(window.localStorage.getItem("kds:paper-width"));
      if (saved === 58 || saved === 80) setWidth(saved);
    } catch {
      /* armazenamento indisponível: segue com o padrão */
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function chooseWidth(next: PaperWidth) {
    setWidth(next);
    try {
      window.localStorage.setItem("kds:paper-width", String(next));
    } catch {
      /* ignora */
    }
  }

  if (!mounted) return null;

  const address = order.addressSnapshot;
  const isDelivery = order.deliveryType === "DELIVERY";
  const change =
    order.paymentMethod === "CASH" && order.changeForCents && order.changeForCents > order.totalCents
      ? order.changeForCents - order.totalCents
      : null;

  return createPortal(
    <div className="ticket-print-root admin-light fixed inset-0 z-[100] flex flex-col bg-black/80">
      {/* Tamanho do papel enviado ao driver da impressora */}
      <style>{`@media print { @page { size: ${width}mm auto; margin: 0; } }`}</style>

      <div className="ticket-no-print flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">Comanda #{order.orderNumber}</span>
          <div className="flex overflow-hidden rounded-lg border border-border text-sm font-semibold">
            {([58, 80] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => chooseWidth(w)}
                className={w === width ? "bg-brand px-3 py-1.5 text-black" : "px-3 py-1.5 text-muted hover:bg-surface-2"}
              >
                {w}mm
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Imprimir
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>
            <X className="h-4 w-4" /> Fechar
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <article
          className="ticket-paper mx-auto bg-white p-2 font-mono text-[12px] leading-snug text-black"
          style={{ width: `${width}mm` }}
        >
          <header className="border-b border-dashed border-black pb-2 text-center">
            <p className="text-sm font-bold uppercase">{storeName}</p>
            <p className="mt-1 text-2xl font-extrabold">PEDIDO #{order.orderNumber}</p>
            <p>{formatTime(order.createdAt)}</p>
            <p className="mt-1 inline-block border-2 border-black px-2 text-base font-extrabold">
              {isDelivery ? "ENTREGA" : "RETIRADA"}
            </p>
          </header>

          <section className="border-b border-dashed border-black py-2">
            <p className="font-bold">{order.customerName}</p>
            <p>{formatPhone(order.customerPhone)}</p>
            {isDelivery && address ? (
              <p className="mt-1">
                {address.street}, {address.number}
                {address.complement ? ` - ${address.complement}` : ""}
                <br />
                Bairro: {address.neighborhood}
                {address.reference ? (
                  <>
                    <br />
                    Ref: {address.reference}
                  </>
                ) : null}
              </p>
            ) : null}
          </section>

          <section className="border-b border-dashed border-black py-2">
            <ul className="space-y-1.5">
              {order.items.map((item, index) => (
                <li key={`${item.name}-${index}`}>
                  <p className="flex justify-between gap-2 font-bold">
                    <span>
                      {item.quantity}x {item.name}
                    </span>
                    <span className="shrink-0">{formatCents(item.totalItemCents)}</span>
                  </p>
                  {item.addons.map((addon, i) => (
                    <p key={`${addon.name}-${i}`} className="pl-3">
                      + {addon.quantity > 1 ? `${addon.quantity}x ` : ""}
                      {addon.name}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </section>

          {order.notes ? (
            <section className="border-b border-dashed border-black py-2">
              <p className="font-extrabold uppercase">OBS: {order.notes}</p>
            </section>
          ) : null}

          <section className="space-y-0.5 py-2">
            <p className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatCents(order.subtotalCents)}</span>
            </p>
            {isDelivery ? (
              <p className="flex justify-between">
                <span>Taxa de entrega</span>
                <span>{formatCents(order.deliveryFeeCents)}</span>
              </p>
            ) : null}
            <p className="flex justify-between text-base font-extrabold">
              <span>TOTAL</span>
              <span>{formatCents(order.totalCents)}</span>
            </p>
            <p className="pt-1 font-bold">Pagamento: {PAYMENT_LABELS[order.paymentMethod]}</p>
            {order.paymentMethod === "CASH" ? (
              order.changeForCents ? (
                <p className="font-bold">
                  Troco p/ {formatCents(order.changeForCents)}
                  {change ? ` (devolver ${formatCents(change)})` : ""}
                </p>
              ) : (
                <p className="font-bold">Sem troco</p>
              )
            ) : null}
          </section>

          <p className="border-t border-dashed border-black pt-2 text-center text-[10px]">Obrigado pela preferência!</p>
        </article>
      </div>
    </div>,
    document.body,
  );
}
