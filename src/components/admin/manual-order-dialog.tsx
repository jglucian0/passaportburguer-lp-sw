"use client";

import { Loader2, Minus, Plus, Search, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { createManualOrder } from "@/actions/admin";
import type { CatalogCategoryWithStatus } from "@/infra/db/queries";
import { cn, formatCents, normalizeSearch } from "@/lib/utils";

const field =
  "h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#071329] focus:outline-none focus:ring-2 focus:ring-brand/60";

type Channel = "COUNTER" | "WHATSAPP";
type DeliveryType = "DELIVERY" | "PICKUP";
type Payment = "PIX" | "CARD_ON_DELIVERY" | "CASH";

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-full min-w-0 rounded-lg border border-slate-200 bg-slate-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-w-0 flex-1 rounded-md px-2 py-1.5 sm:px-3 text-sm font-semibold transition",
            value === o.value ? "bg-[#071329] text-white shadow-sm" : "text-slate-600 hover:text-slate-900",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Modal rápido para lançar pedidos recebidos fora do site direto na fila "Novos" da cozinha. */
export function ManualOrderDialog({
  menu,
  onClose,
  onCreated,
}: {
  menu: CatalogCategoryWithStatus[];
  onClose: () => void;
  onCreated: (orderNumber: number) => void;
}) {
  const [channel, setChannel] = useState<Channel>("COUNTER");
  const [deliveryType, setDeliveryType] = useState<DeliveryType>("PICKUP");
  const [payment, setPayment] = useState<Payment>("CASH");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [reference, setReference] = useState("");
  const [fee, setFee] = useState("");
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /** Só produtos vendáveis sem adicionais obrigatórios (adicionais não são lançados por aqui). */
  const products = useMemo(
    () =>
      menu
        .filter((c) => c.isActive)
        .flatMap((c) =>
          c.products
            .filter((p) => p.isAvailable && p.addonGroups.every((g) => g.minSelections === 0))
            .map((p) => ({ ...p, category: c.name })),
        ),
    [menu],
  );
  const filtered = useMemo(() => {
    const q = normalizeSearch(query);
    return q ? products.filter((p) => normalizeSearch(`${p.name} ${p.category}`).includes(q)) : products;
  }, [products, query]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const lines = Object.entries(qty).filter(([, q]) => q > 0);
  const subtotal = lines.reduce((sum, [id, q]) => sum + (productById.get(id)?.priceCents ?? 0) * q, 0);
  const feeCents = deliveryType === "DELIVERY" ? Math.round((parseFloat(fee.replace(",", ".")) || 0) * 100) : 0;

  function change(id: string, delta: number) {
    setQty((cur) => ({ ...cur, [id]: Math.max(0, Math.min(50, (cur[id] ?? 0) + delta)) }));
  }

  function submit() {
    setError(null);
    if (lines.length === 0) return setError("Adicione ao menos um item.");
    startTransition(async () => {
      try {
        const result = await createManualOrder({
          channel,
          customerName: name,
          customerPhone: phone,
          deliveryType,
          neighborhood,
          street,
          number,
          reference,
          deliveryFeeCents: feeCents,
          paymentMethod: payment,
          notes: notes || undefined,
          items: lines.map(([productId, quantity]) => ({ productId, quantity })),
        });
        if (!result.ok) {
          const first = result.fieldErrors ? Object.values(result.fieldErrors).flat().find(Boolean) : null;
          setError(first ?? result.error);
          return;
        }
        onCreated(result.data.orderNumber);
      } catch {
        setError("Falha ao lançar o pedido. Tente novamente.");
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Novo pedido balcão ou WhatsApp"
      className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onClose();
      }}
    >
      <div className="flex max-h-[95dvh] w-full min-w-0 max-w-4xl flex-col overflow-x-hidden overflow-hidden rounded-t-2xl bg-white text-slate-900 shadow-2xl sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-extrabold">Novo pedido</h2>
            <p className="text-xs text-slate-500">Entra direto em “Novos” na fila da cozinha.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="Fechar"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-w-0 flex-1 grid-cols-1 overflow-y-auto overflow-x-hidden md:grid-cols-2 md:overflow-hidden">
          <section className="flex min-h-0 min-w-0 flex-col border-b border-slate-200 p-4 sm:p-5 md:border-b-0 md:border-r">
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar item do cardápio"
                className={cn(field, "pl-9")}
              />
            </div>
            <ul className="light-scrollbar max-h-72 space-y-1 overflow-y-auto md:max-h-none md:flex-1">
              {filtered.map((p) => {
                const q = qty[p.id] ?? 0;
                return (
                  <li
                    key={p.id}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg border px-3 py-2",
                      q > 0 ? "border-brand bg-amber-50" : "border-slate-200",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{p.name}</p>
                      <p className="text-xs text-slate-500">{formatCents(p.priceCents)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {q > 0 ? (
                        <>
                          <button
                            type="button"
                            aria-label={`Menos ${p.name}`}
                            onClick={() => change(p.id, -1)}
                            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 hover:bg-slate-100"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="w-6 text-center text-sm font-bold tabular-nums">{q}</span>
                        </>
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Adicionar ${p.name}`}
                        onClick={() => change(p.id, 1)}
                        className="grid h-8 w-8 place-items-center rounded-lg bg-[#071329] text-white hover:bg-slate-800"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
              {filtered.length === 0 ? (
                <li className="p-6 text-center text-sm text-slate-500">Nenhum item encontrado.</li>
              ) : null}
            </ul>
          </section>

          <section className="min-w-0 space-y-4 p-4 sm:p-5 md:overflow-y-auto">
            <Segmented
              label="Origem"
              value={channel}
              onChange={setChannel}
              options={[
                { value: "COUNTER", label: "Balcão" },
                { value: "WHATSAPP", label: "WhatsApp" },
              ]}
            />
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do cliente" className={field} aria-label="Nome do cliente" />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="WhatsApp com DDD" inputMode="tel" className={field} aria-label="WhatsApp" />
            </div>

            <Segmented
              label="Tipo"
              value={deliveryType}
              onChange={setDeliveryType}
              options={[
                { value: "PICKUP", label: "Retirada" },
                { value: "DELIVERY", label: "Entrega" },
              ]}
            />
            {deliveryType === "DELIVERY" ? (
              <div className="grid min-w-0 grid-cols-6 gap-2.5 sm:gap-3">
                <input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Rua" className={cn(field, "col-span-4")} aria-label="Rua" />
                <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Nº" className={cn(field, "col-span-2")} aria-label="Número" />
                <input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Bairro" className={cn(field, "col-span-3")} aria-label="Bairro" />
                <input value={fee} onChange={(e) => setFee(e.target.value)} placeholder="Frete (R$)" inputMode="decimal" className={cn(field, "col-span-3")} aria-label="Frete" />
                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Referência (opcional)" className={cn(field, "col-span-6")} aria-label="Referência" />
              </div>
            ) : null}

            <Segmented
              label="Pagamento"
              value={payment}
              onChange={setPayment}
              options={[
                { value: "CASH", label: "Dinheiro" },
                { value: "CARD_ON_DELIVERY", label: "Cartão" },
                { value: "PIX", label: "PIX" },
              ]}
            />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observações (ex.: sem cebola)"
              maxLength={300}
              className={cn(field, "h-20 py-2")}
              aria-label="Observações"
            />
          </section>
        </div>

        <footer className="space-y-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-5 sm:py-4">
          {error ? (
            <p role="alert" className="text-sm font-semibold text-red-700">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2 sm:gap-3">
            <div className="min-w-0 whitespace-nowrap text-xs sm:text-sm">
              <span className="text-slate-500">Total </span>
              <span className="text-base font-extrabold tabular-nums sm:text-xl">{formatCents(subtotal + feeCents)}</span>
              {feeCents > 0 ? <span className="ml-2 text-xs text-slate-500">(frete {formatCents(feeCents)})</span> : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="h-11 whitespace-nowrap rounded-xl border border-slate-300 px-3 text-xs font-semibold hover:bg-slate-100 sm:px-4 sm:text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={isPending}
                className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-xl bg-brand px-3 text-xs font-extrabold sm:px-5 sm:text-sm text-[#071329] hover:brightness-105 disabled:opacity-60"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Lançar na cozinha
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
