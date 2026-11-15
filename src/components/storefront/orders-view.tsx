"use client";

import { Check, MessageCircle, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { clearCustomerSession, type CustomerOrderView } from "@/actions/storefront";
import { isTerminalStatus, ORDER_STATUS_LABELS } from "@/core/orders/state-machine";
import type { OrderStatus, PaymentMethod } from "@/core/schemas/common";
import type { CatalogProduct } from "@/core/schemas/product";
import { cn, formatCents, formatDateTime, whatsappLink } from "@/lib/utils";

import {
  buildLineKey,
  clearStoredCart,
  CUSTOMER_PREFILL_KEY,
  loadCart,
  MAX_LINE_QUANTITY,
  ORDER_PLACED_FLAG,
  saveCart,
  type CartLine,
  type CartLineAddon,
} from "./cart-storage";

const POLL_INTERVAL_MS = 15_000;

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  PIX: "PIX",
  CARD_ON_DELIVERY: "Cartão na entrega",
  CASH: "Dinheiro",
};

type FlightStep = { label: string; hint: string; reached: (status: OrderStatus) => boolean };

/* Etapas temáticas. Retirada não tem o status "saiu para entrega", então pula a etapa de voo. */
function getFlightSteps(deliveryType: CustomerOrderView["deliveryType"]): FlightStep[] {
  const steps: FlightStep[] = [
    { label: "Check-in realizado", hint: "Pedido recebido", reached: () => true },
    {
      label: "Na chapa",
      hint: "Em preparo",
      reached: (s) => ["PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"].includes(s),
    },
  ];
  if (deliveryType === "DELIVERY") {
    steps.push({
      label: "Em rota de voo",
      hint: "Saiu para entrega",
      reached: (s) => ["OUT_FOR_DELIVERY", "DELIVERED"].includes(s),
    });
  }
  steps.push({
    label: "Desembarque concluído",
    hint: deliveryType === "DELIVERY" ? "Entregue" : "Retirado",
    reached: (s) => s === "DELIVERED",
  });
  return steps;
}

function FlightProgress({ order }: { order: CustomerOrderView }) {
  const steps = getFlightSteps(order.deliveryType);
  let current = 0;
  steps.forEach((step, i) => {
    if (step.reached(order.status)) current = i;
  });
  const delivered = order.status === "DELIVERED";

  return (
    <ol className="flex items-start">
      {steps.map((step, index) => {
        const done = index <= current;
        const active = index === current && !delivered;
        return (
          <li key={step.label} className="relative flex flex-1 flex-col items-center gap-1.5 text-center">
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute right-1/2 top-3.5 h-0.5 w-full -translate-y-1/2",
                  done ? "bg-[#F59E0B]" : "bg-slate-200",
                )}
              />
            ) : null}
            <span
              className={cn(
                "relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold",
                done
                  ? "border-[#F59E0B] bg-[#F59E0B] text-[#0A2540]"
                  : "border-slate-300 bg-white text-slate-400",
                active && "ring-4 ring-[#F59E0B]/25",
              )}
            >
              {done ? <Check className="h-4 w-4" strokeWidth={2.5} /> : index + 1}
            </span>
            <span
              className={cn(
                "text-[11px] leading-tight",
                done ? "font-semibold text-[#0A2540]" : "text-slate-400",
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function OrderCard({
  order,
  whatsapp,
  onReorder,
  highlight,
}: {
  order: CustomerOrderView;
  whatsapp: string | null;
  onReorder: (order: CustomerOrderView) => void;
  highlight: boolean;
}) {
  const canceled = order.status === "CANCELED";
  const awaitingPayment = order.status === "AWAITING_PAYMENT";
  const currentStep = (() => {
    const steps = getFlightSteps(order.deliveryType);
    let current = 0;
    steps.forEach((step, i) => {
      if (step.reached(order.status)) current = i;
    });
    return steps[current];
  })();

  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border bg-white shadow-sm",
        highlight ? "border-[#F59E0B]/50" : "border-slate-200",
      )}
    >
      {/* Cabeçalho do cartão de embarque */}
      <header className="flex items-center justify-between gap-3 bg-[#0A162B] px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#D4A03E]">
            Boarding pass
          </p>
          <h3 className="text-lg font-extrabold leading-tight">Pedido #{order.orderNumber}</h3>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
            canceled
              ? "bg-red-100 text-red-700"
              : order.status === "DELIVERED"
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-900",
          )}
        >
          {awaitingPayment ? "Aguardando PIX" : ORDER_STATUS_LABELS[order.status]}
        </span>
      </header>

      <div className="space-y-4 p-4">
        <p className="text-xs text-slate-500">
          {formatDateTime(order.createdAt)} • {order.deliveryType === "DELIVERY" ? "Entrega" : "Retirada"} •{" "}
          {PAYMENT_LABELS[order.paymentMethod]}
        </p>

        {highlight && !canceled ? (
          <div className="space-y-3 border-y border-dashed border-slate-300 py-4">
            <FlightProgress order={order} />
            <p className="text-center text-xs text-slate-500">
              Agora: <span className="font-semibold text-[#0A2540]">{currentStep.hint}</span>
            </p>
            {awaitingPayment ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Aguardando a confirmação do pagamento PIX. Assim que confirmado, seu pedido vai para a
                cozinha.
              </p>
            ) : null}
          </div>
        ) : null}

        {canceled && order.cancelReason ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Motivo: {order.cancelReason}
          </p>
        ) : null}

        <ul className="space-y-1.5 text-sm">
          {order.items.map((item, index) => (
            <li key={`${item.name}-${index}`} className="flex justify-between gap-3">
              <span>
                {item.quantity}x {item.name}
                {item.addons.length > 0 ? (
                  <span className="block text-xs text-slate-500">
                    {item.addons
                      .map((a) => (a.quantity > 1 ? `${a.quantity}x ${a.name}` : a.name))
                      .join(", ")}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0">{formatCents(item.totalItemCents)}</span>
            </li>
          ))}
        </ul>

        <footer className="space-y-3 border-t border-slate-200 pt-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Total</span>
            <span className="text-base font-extrabold">{formatCents(order.totalCents)}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {highlight && whatsapp ? (
              <a
                href={whatsappLink(
                  whatsapp,
                  `Olá! Preciso de ajuda com o pedido #${order.orderNumber}.`,
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-[#0A2540] hover:bg-slate-50"
              >
                <MessageCircle className="h-4 w-4" strokeWidth={1.75} /> Falar no WhatsApp
              </a>
            ) : null}
            {isTerminalStatus(order.status) ? (
              <button
                type="button"
                onClick={() => onReorder(order)}
                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-[#F59E0B] px-4 text-sm font-bold text-[#0A2540] hover:brightness-105"
              >
                <RotateCcw className="h-4 w-4" strokeWidth={2} /> Pedir novamente
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </article>
  );
}

export function OrdersView({
  tenantId,
  customerName,
  orders,
  catalog,
  whatsapp,
}: {
  tenantId: string;
  customerName: string;
  orders: CustomerOrderView[];
  catalog: CatalogProduct[];
  whatsapp: string | null;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [switching, startSwitching] = useTransition();

  const active = orders.filter((o) => !isTerminalStatus(o.status));
  const history = orders.filter((o) => isTerminalStatus(o.status));
  const hasActive = active.length > 0;

  // Pedido recém-criado: limpa o carrinho persistido.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(ORDER_PLACED_FLAG) === tenantId) {
        clearStoredCart(tenantId);
        window.sessionStorage.removeItem(ORDER_PLACED_FLAG);
      }
    } catch {
      /* ignorar */
    }
  }, [tenantId]);

  // Acompanhamento ao vivo: atualiza a cada 15s apenas com a aba visível.
  useEffect(() => {
    if (!hasActive) return;

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };

    const interval = window.setInterval(refreshIfVisible, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [hasActive, router]);

  function handleReorder(order: CustomerOrderView) {
    const productsById = new Map(catalog.map((p) => [p.id, p]));
    const newLines: CartLine[] = [];
    let skipped = 0;

    for (const item of order.items) {
      const product = item.productId ? productsById.get(item.productId) : undefined;
      if (!product || !product.isAvailable) {
        skipped++;
        continue;
      }

      const allAddons = product.addonGroups.flatMap((g) => g.addons);
      const addons: CartLineAddon[] = [];
      let addonsOk = true;

      for (const snap of item.addons) {
        const match = allAddons.find((a) => a.name === snap.name && a.isAvailable);
        if (!match) {
          addonsOk = false;
          break;
        }
        addons.push({
          addonId: match.id,
          name: match.name,
          priceCents: match.priceCents,
          quantity: snap.quantity,
        });
      }

      if (!addonsOk) {
        skipped++;
        continue;
      }

      newLines.push({
        key: buildLineKey(product.id, addons),
        productId: product.id,
        name: product.name,
        imageUrl: product.imageUrl,
        unitPriceCents: product.priceCents,
        quantity: item.quantity,
        addons,
      });
    }

    if (newLines.length === 0) {
      setNotice("Não foi possível repetir este pedido: os itens não estão mais disponíveis.");
      return;
    }

    const merged = loadCart(tenantId);
    for (const line of newLines) {
      const existing = merged.find((l) => l.key === line.key);
      if (existing) existing.quantity = Math.min(MAX_LINE_QUANTITY, existing.quantity + line.quantity);
      else merged.push(line);
    }
    saveCart(tenantId, merged);

    router.push(skipped > 0 ? "/checkout?parcial=1" : "/checkout");
  }

  function handleChangeNumber() {
    startSwitching(async () => {
      try {
        const raw = window.localStorage.getItem(CUSTOMER_PREFILL_KEY);
        const saved = raw ? (JSON.parse(raw) as { name?: string; phone?: string }) : {};
        delete saved.phone;
        window.localStorage.setItem(CUSTOMER_PREFILL_KEY, JSON.stringify(saved));
      } catch {
        /* ignorar */
      }
      await clearCustomerSession();
      router.refresh();
    });
  }

  const greeting = (
    <div className="flex items-center justify-between gap-3 text-sm">
      <p className="text-slate-600">Olá, {customerName}!</p>
      <button
        type="button"
        onClick={handleChangeNumber}
        disabled={switching}
        className="text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-[#0A2540] disabled:opacity-50"
      >
        Trocar número
      </button>
    </div>
  );

  if (orders.length === 0) {
    return (
      <div className="space-y-6">
        {greeting}
        <p className="py-10 text-center text-sm text-slate-500">Você ainda não tem pedidos.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {greeting}

      {notice ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>
      ) : null}

      {active.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-extrabold text-[#0A2540]">Em andamento</h2>
          {active.map((order) => (
            <OrderCard key={order.id} order={order} whatsapp={whatsapp} onReorder={handleReorder} highlight />
          ))}
        </section>
      ) : null}

      {history.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-extrabold text-[#0A2540]">Histórico</h2>
          {history.map((order) => (
            <OrderCard key={order.id} order={order} whatsapp={whatsapp} onReorder={handleReorder} highlight={false} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
