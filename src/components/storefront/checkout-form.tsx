"use client";

import { ArrowLeft, Bike, ChevronDown, Loader2, Store } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";

import { createOrder } from "@/actions/storefront";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { calculateCart } from "@/core/cart/calculate-cart";
import {
  calculateDeliveryQuote,
  normalizeCity,
  resolveDeliveryZone,
  withQuotedFee,
} from "@/core/delivery/quote";
import { OTHER_ZONE_NAME } from "@/core/store/maringa-zones";
import { minOrderMessage } from "@/core/store/min-order";
import { documentError, formatDocument, onlyDigits } from "@/core/validation/document";
import { isOnlinePaymentMethod, type DeliveryType, type PaymentMethod } from "@/core/schemas/common";
import type {
  CatalogDeliveryZone,
  CatalogProduct,
} from "@/core/schemas/product";
import { cn, formatCents, formatPhone } from "@/lib/utils";

import { useCart } from "./cart-provider";
import type { ConfirmedAddress } from "./address-book";
import { AddressPicker } from "./address-picker";
import {
  CUSTOMER_PREFILL_KEY,
  lineTotal,
  ORDER_PLACED_FLAG,
} from "./cart-storage";

/** UUID v4 da tentativa de checkout (idempotência no servidor). */
function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  PIX: "PIX",
  CREDIT_CARD: "Cartão de crédito (online)",
  CARD_ON_DELIVERY: "Cartão na entrega",
  CASH: "Dinheiro",
};

/* Visual claro do checkout: sobrescreve o tema escuro dos inputs compartilhados. */
const inputClass =
  "h-12 rounded-xl border-slate-300 bg-white text-base text-slate-900 placeholder:text-slate-400 focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/30";
const cardClass =
  "space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}


function parseReaisToCents(value: string): number | null {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0
    ? Math.round(number * 100)
    : null;
}

export function CheckoutForm({
  catalog,
  zones,
  minOrderCents,
  storeOpen,
  customer,
}: {
  catalog: CatalogProduct[];
  zones: CatalogDeliveryZone[];
  minOrderCents: number;
  storeOpen: boolean;
  /** Dados da conta logada: o servidor usa a sessão; aqui só exibimos. */
  customer: { name: string; phone: string };
}) {
  const { tenantId, lines, hydrated } = useCart();
  const [isPending, startTransition] = useTransition();

  const [name] = useState(customer.name);
  const [phone] = useState(formatPhone(customer.phone));
  const [deliveryType, setDeliveryType] = useState<DeliveryType>("DELIVERY");
  const [address, setAddress] = useState<ConfirmedAddress | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("PIX");
  const [changeFor, setChangeFor] = useState("");
  const [noChange, setNoChange] = useState(true);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [includeDocument, setIncludeDocument] = useState(false);
  const [documentValue, setDocumentValue] = useState("");
  const [documentTouched, setDocumentTouched] = useState(false);
  /* Muda só quando um envio falha (nenhum pedido criado); reenvio/duplo clique reaproveita a chave. */
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const onlinePayment = isOnlinePaymentMethod(paymentMethod);

  /* Frete por distância: o servidor recalcula o mesmo valor ao criar o pedido. */
  const quote = useMemo(
    () => (address ? calculateDeliveryQuote(address.lat, address.lon, address.city) : null),
    [address],
  );
  const baseZone = useMemo(
    () => resolveDeliveryZone(zones, address?.neighborhood, OTHER_ZONE_NAME),
    [zones, address],
  );
  const zone = useMemo(
    () => (baseZone && quote?.deliverable ? withQuotedFee(baseZone, quote.feeCents) : null),
    [baseZone, quote],
  );
  const usingFallback =
    !!baseZone && normalizeCity(baseZone.neighborhood) === normalizeCity(OTHER_ZONE_NAME);
  const changeForCents =
    paymentMethod === "CASH" && !noChange ? parseReaisToCents(changeFor) : null;

  const items = useMemo(
    () =>
      lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        addons: l.addons.map((a) => ({
          addonId: a.addonId,
          quantity: a.quantity,
        })),
      })),
    [lines],
  );

  /* Observações por item entram nas notas do pedido para a cozinha. */
  const combinedNotes = [
    notes.trim(),
    ...lines
      .filter((l) => l.note)
      .map((l) => `${l.quantity}x ${l.name}: ${l.note}`),
  ]
    .filter(Boolean)
    .join("\n");

  const calc = useMemo(
    () =>
      calculateCart({
        items,
        catalog,
        deliveryType,
        deliveryZone: zone,
        minOrderCents,
        paymentMethod,
        changeForCents,
      }),
    [
      items,
      catalog,
      deliveryType,
      zone,
      minOrderCents,
      paymentMethod,
      changeForCents,
    ],
  );

  const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);
  const fee = deliveryType === "DELIVERY" && zone ? zone.feeCents : 0;
  const total = calc.ok ? calc.totalCents : subtotal + fee;

  /* Pedido mínimo: só entrega, sobre o subtotal dos produtos (sem a taxa). */
  const missingMinCents =
    deliveryType === "DELIVERY" ? Math.max(0, minOrderCents - subtotal) : 0;
  const belowMin = missingMinCents > 0;

  /* CPF/CNPJ na nota. */
  const docDigits = onlyDigits(documentValue);
  const docError = includeDocument || onlinePayment ? documentError(documentValue) : null;
  const showDocError = !!docError && (documentTouched || docDigits.length >= 11);


  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (deliveryType === "DELIVERY") {
      if (!address) {
        setError("Escolha um endereço de entrega.");
        return;
      }
      if (quote && !quote.deliverable) {
        setError(quote.message);
        return;
      }
    }

    if (belowMin) {
      setError(minOrderMessage(minOrderCents, missingMinCents));
      return;
    }

    if (docError) {
      setDocumentTouched(true);
      setError(docError);
      return;
    }

    if (!calc.ok) {
      setError(calc.errors.map((e) => e.message).join(" "));
      return;
    }

    try {
      window.localStorage.setItem(
        CUSTOMER_PREFILL_KEY,
        JSON.stringify({ name, phone }),
      );
      window.sessionStorage.setItem(ORDER_PLACED_FLAG, tenantId);
    } catch {
      /* ignorar */
    }

    const addr = deliveryType === "DELIVERY" ? address : null;

    startTransition(async () => {
      const result = await createOrder({
        customerName: name,
        customerPhone: phone,
        deliveryType,
        street: addr?.street ?? null,
        number: addr?.number ?? null,
        complement: addr?.complement || null,
        neighborhood: addr?.neighborhood || null,
        city: addr?.city ?? null,
        postalCode: addr?.postalCode ?? null,
        lat: addr?.lat ?? null,
        lon: addr?.lon ?? null,
        reference:
          addr && usingFallback && addr.neighborhood
            ? `Bairro: ${addr.neighborhood.slice(0, 40)}`
            : null,
        paymentMethod,
        changeForCents,
        notes: combinedNotes || null,
        documentNumber: includeDocument || onlinePayment ? docDigits : null,
        idempotencyKey,
        items,
      });

      // Em sucesso o servidor redireciona; só chegamos aqui em caso de erro.
      if (result && !result.ok) {
        setIdempotencyKey(newIdempotencyKey());
        try {
          window.sessionStorage.removeItem(ORDER_PLACED_FLAG);
        } catch {
          /* ignorar */
        }
        const fieldMessages = Object.values(result.fieldErrors ?? {})
          .flat()
          .filter(Boolean)
          .join(" ");
        setError(
          fieldMessages ? `${result.error} ${fieldMessages}` : result.error,
        );
      }
    });
  }

  if (!hydrated) {
    return (
      <div className="flex min-h-[60dvh] justify-center bg-[#F4F6F9] py-20">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="min-h-[60dvh] bg-[#F4F6F9] px-4 py-20 text-center">
        <div className="mx-auto max-w-md space-y-4">
          <p className="text-slate-600">Seu carrinho está vazio.</p>
          <Link
            href="/#cardapio"
            className="inline-flex h-12 items-center justify-center rounded-xl bg-[#F59E0B] px-6 font-bold text-[#0A2540]"
          >
            Ver cardápio
          </Link>
        </div>
      </div>
    );
  }

  const optionClass = (active: boolean) =>
    cn(
      "flex h-12 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition",
      active
        ? "border-[#F59E0B] bg-amber-50 text-[#0A2540]"
        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
    );

  return (
    <div className="min-h-[calc(100dvh-64px)] bg-[#F4F6F9] text-[#0A2540]">
      <nav aria-label="Navegação do checkout" className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-12 max-w-xl items-center px-4">
          <Link
            href="/#cardapio"
            className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-[#0A2540] transition hover:bg-slate-100 active:scale-95"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar ao cardápio
          </Link>
        </div>
      </nav>
      <form
        onSubmit={handleSubmit}
        className="mx-auto max-w-xl space-y-4 px-4 pb-44 pt-6 md:pb-10"
      >
        <h1 className="text-2xl font-extrabold">Finalizar pedido</h1>

        {/* Resumo: retrátil no mobile */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setSummaryOpen((o) => !o)}
            aria-expanded={summaryOpen}
            className="flex w-full items-center justify-between gap-3 p-4 text-left md:cursor-default"
          >
            <span className="font-bold">
              <span className="md:hidden">
                Resumo do pedido ({itemCount}{" "}
                {itemCount === 1 ? "item" : "itens"}) — {formatCents(subtotal)}
              </span>
              <span className="hidden md:inline">Seu pedido</span>
            </span>
            <ChevronDown
              className={cn(
                "h-5 w-5 shrink-0 transition md:hidden",
                summaryOpen && "rotate-180",
              )}
            />
          </button>
          <div
            className={cn(
              "grid transition-[grid-template-rows] duration-300 ease-out md:grid-rows-[1fr]",
              summaryOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
          >
            <div className="min-h-0 overflow-hidden">
              <ul
                className={cn(
                  "space-y-2 p-4 text-sm",
                  summaryOpen && "border-t border-slate-200",
                  "md:border-t md:border-slate-200",
                )}
              >
                {lines.map((l) => (
                  <li key={l.key} className="flex justify-between gap-3">
                    <span>
                      {l.quantity}x {l.name}
                      {l.addons.length > 0 ? (
                        <span className="block text-xs text-slate-500">
                          {l.addons
                            .map((a) =>
                              a.quantity > 1
                                ? `${a.quantity}x ${a.name}`
                                : a.name,
                            )
                            .join(", ")}
                        </span>
                      ) : null}
                      {l.note ? (
                        <span className="block text-xs italic text-slate-500">
                          Obs: {l.note}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-semibold">
                      {formatCents(lineTotal(l))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Dados */}
        <section className={cardClass}>
          <h2 className="font-bold">Seus dados</h2>
          <Field label="Nome">
            <Input
              className={inputClass}
              value={name}
              readOnly
              autoComplete="name"
              required
            />
          </Field>
          <Field label="WhatsApp">
            <Input
              className={inputClass}
              value={phone}
              readOnly
              inputMode="tel"
              autoComplete="tel"
              placeholder="(44) 99833-3450"
              required
            />
          </Field>
        </section>

        {/* Entrega */}
        <section className={cardClass}>
          <h2 className="font-bold">Como você quer receber?</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className={optionClass(deliveryType === "DELIVERY")}
              onClick={() => setDeliveryType("DELIVERY")}
            >
              <Bike className="h-4 w-4" strokeWidth={1.75} /> Entrega
            </button>
            <button
              type="button"
              className={optionClass(deliveryType === "PICKUP")}
              onClick={() => setDeliveryType("PICKUP")}
            >
              <Store className="h-4 w-4" strokeWidth={1.75} /> Retirada
            </button>
          </div>

          {deliveryType === "DELIVERY" ? (
            <AddressPicker
              value={address}
              onChange={setAddress}
              estimatedMinutes={zone?.estimatedMinutes ?? null}
            />
          ) : (
            <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              Você retira o pedido diretamente na hamburgueria. Avisaremos pelo
              acompanhamento quando estiver pronto.
            </p>
          )}
        </section>

        {/* Pagamento */}
        <section className={cardClass}>
          <h2 className="font-bold">Pagamento</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((method) => (
              <button
                key={method}
                type="button"
                className={cn(
                  optionClass(paymentMethod === method),
                  "h-14 px-1 text-center text-xs leading-tight",
                )}
                onClick={() => {
                  setPaymentMethod(method);
                  if (isOnlinePaymentMethod(method)) setIncludeDocument(true);
                }}
              >
                {PAYMENT_LABELS[method]}
              </button>
            ))}
          </div>

          {paymentMethod === "CASH" ? (
            <div className="space-y-3 rounded-xl bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-700">
                Troco para quanto?
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={optionClass(noChange)}
                  onClick={() => setNoChange(true)}
                >
                  Não preciso de troco
                </button>
                <button
                  type="button"
                  className={optionClass(!noChange)}
                  onClick={() => setNoChange(false)}
                >
                  Preciso de troco
                </button>
              </div>
              {!noChange ? (
                <Input
                  className={inputClass}
                  value={changeFor}
                  onChange={(e) => setChangeFor(e.target.value)}
                  inputMode="decimal"
                  placeholder="Ex: 100,00"
                  aria-label="Troco para quanto?"
                />
              ) : null}
            </div>
          ) : null}

          {paymentMethod === "PIX" ? (
            <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              Seu pedido ficará aguardando a confirmação do pagamento PIX antes
              de ir para a cozinha.
            </p>
          ) : null}

          {paymentMethod === "CREDIT_CARD" ? (
            <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              Você informa os dados do cartão na próxima tela, em ambiente seguro. Eles não ficam
              salvos no nosso sistema.
            </p>
          ) : null}

          <div className="space-y-3 rounded-xl bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="checkout-doc-switch" className="text-sm font-medium text-slate-700">
                {onlinePayment ? "CPF/CNPJ (obrigatório para pagar online)" : "Incluir CPF/CNPJ na nota"}
              </label>
              <Switch
                id="checkout-doc-switch"
                checked={includeDocument || onlinePayment}
                disabled={onlinePayment}
                onCheckedChange={(on) => {
                  setIncludeDocument(on);
                  if (!on) {
                    setDocumentValue("");
                    setDocumentTouched(false);
                  }
                }}
                className="bg-slate-300 focus-visible:ring-[#F59E0B] data-[state=checked]:bg-[#F59E0B]"
              />
            </div>
            {includeDocument || onlinePayment ? (
              <div className="space-y-1.5">
                <Input
                  className={inputClass}
                  value={documentValue}
                  onChange={(e) => setDocumentValue(formatDocument(e.target.value))}
                  onBlur={() => setDocumentTouched(true)}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="CPF ou CNPJ"
                  aria-label="CPF ou CNPJ na nota"
                  aria-invalid={showDocError}
                  maxLength={18}
                />
                {showDocError ? (
                  <p role="alert" className="text-xs font-medium text-red-700">
                    {docError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <Field label="Observações (opcional)">
            <Textarea
              className={cn(inputClass, "h-auto min-h-24 py-3")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={300}
            />
          </Field>
        </section>

        {/* Totais */}
        <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Subtotal</span>
            <span>{formatCents(subtotal)}</span>
          </div>
          {deliveryType === "DELIVERY" ? (
            <div className="flex justify-between">
              <span className="text-slate-500">Taxa de entrega</span>
              <span>{zone ? formatCents(fee) : "Escolha o endereço"}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-extrabold">
            <span>Total</span>
            <span>{formatCents(total)}</span>
          </div>
        </section>

        {!calc.ok && storeOpen && calc.errors.some((e) => e.code !== "MIN_ORDER_NOT_REACHED") ? (
          <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {calc.errors
              .filter((e) => e.code !== "MIN_ORDER_NOT_REACHED")
              .map((e, i) => (
              <li key={`${e.code}-${i}`}>{e.message}</li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {/* CTA: fixo na base no mobile */}
        <div className="fixed inset-x-0 bottom-0 z-40 space-y-2 border-t border-slate-200 bg-white p-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] md:static md:z-auto md:border-0 md:bg-transparent md:p-0 md:shadow-none">
          {storeOpen && belowMin ? (
            <p
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs font-medium text-amber-900"
            >
              {minOrderMessage(minOrderCents, missingMinCents)}
            </p>
          ) : null}
          {!storeOpen ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs font-medium text-amber-900">
              A loja está fechada no momento. Não é possível finalizar o pedido
              agora.
            </p>
          ) : null}
          <button
            type="submit"
            disabled={isPending || !storeOpen || !calc.ok || belowMin || !!docError}
            className="mx-auto flex h-14 w-full max-w-xl items-center justify-center gap-2 rounded-xl bg-[#F59E0B] text-base font-bold text-[#0A2540] transition hover:brightness-105 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
            {isPending
              ? "Enviando pedido..."
              : `Confirmar pedido • ${formatCents(total)}`}
          </button>
        </div>
      </form>
    </div>
  );
}
