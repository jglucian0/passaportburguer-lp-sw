"use client";

import {
  ArrowLeft,
  Banknote,
  Bike,
  Check,
  CreditCard,
  ExternalLink,
  Loader2,
  QrCode,
  Store,
  UtensilsCrossed,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { createOrder, validateCoupon } from "@/actions/storefront";
import { trackInitiateCheckout } from "@/lib/track";
import { Input, Textarea } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { calculateCart, type CartCoupon } from "@/core/cart/calculate-cart";
import {
  calculateDeliveryQuote,
  normalizeCity,
  resolveDeliveryZone,
  withQuotedFee,
} from "@/core/delivery/quote";
import { OTHER_ZONE_NAME } from "@/core/store/maringa-zones";
import { minOrderMessage } from "@/core/store/min-order";
import { documentError, formatDocument, onlyDigits } from "@/core/validation/document";
import type { DeliveryType, PaymentMethod } from "@/core/schemas/common";
import type { CatalogDeliveryZone, CatalogProduct } from "@/core/schemas/product";
import { BUSINESS } from "@/lib/site";
import { cn, formatCents, formatPhone } from "@/lib/utils";

import { useCart } from "./cart-provider";
import type { ConfirmedAddress } from "./address-book";
import { AddressPicker } from "./address-picker";
import { PhoneLookup } from "./phone-lookup";
import { CUSTOMER_PREFILL_KEY, lineTotal, ORDER_PLACED_FLAG } from "./cart-storage";

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

/* Visual claro do checkout: sobrescreve o tema escuro dos inputs compartilhados. */
const inputClass =
  "h-12 rounded-xl border-slate-300 bg-white text-base text-slate-900 placeholder:text-slate-400 focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/30";
const cardClass = "space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) : null;
}

/** Como o cliente recebe. "Consumir no local" é retirada no balcão/salão (vai para a cozinha com essa observação). */
type Receive = "DELIVERY" | "DINE_IN" | "PICKUP";

/** Opções de pagamento da tela; cada uma vira um PaymentMethod do sistema. */
type PayChoice = "PIX" | "ONLINE_CARD" | "ONSITE_CREDIT" | "ONSITE_DEBIT" | "CASH";

const PAY_METHOD: Record<PayChoice, PaymentMethod> = {
  PIX: "PIX",
  ONLINE_CARD: "CREDIT_CARD",
  ONSITE_CREDIT: "CARD_ON_DELIVERY",
  ONSITE_DEBIT: "CARD_ON_DELIVERY",
  CASH: "CASH",
};

const PAY_LABEL: Record<PayChoice, string> = {
  PIX: "PIX",
  ONLINE_CARD: "Cartão de crédito (online)",
  ONSITE_CREDIT: "Cartão de crédito",
  ONSITE_DEBIT: "Cartão de débito",
  CASH: "Dinheiro",
};

const STORE_LINE = `${BUSINESS.address.streetAddress} — ${BUSINESS.address.addressLocality}/${BUSINESS.address.addressRegion}`;
const STORE_MAPS_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Passaporte Burguer ${STORE_LINE}`)}`;

type Step = 1 | 2 | 3;

export function CheckoutForm({
  catalog,
  zones,
  minOrderCents,
  storeOpen,
  customer,
  prefill,
}: {
  catalog: CatalogProduct[];
  zones: CatalogDeliveryZone[];
  minOrderCents: number;
  storeOpen: boolean;
  /**
   * Conta logada: o servidor usa a sessão; aqui só exibimos. `null` = visitante: preenche os dados no passo 1 e
   * confirma o WhatsApp por código (modal) só depois da revisão. `needsRegistration`: logado, falta nome/CPF.
   */
  customer: { name: string; phone: string; needsRegistration?: boolean } | null;
  /** Dados de pedidos anteriores: último endereço (com pino) e CPF/CNPJ já salvo. */
  prefill?: { documentNumber: string | null; lastAddress: Omit<ConfirmedAddress, "id" | "usedAt"> | null };
}) {
  const { tenantId, lines, hydrated } = useCart();
  const [isPending, startTransition] = useTransition();

  const [step, setStep] = useState<Step>(1);
  const isGuest = !customer;
  const needsProfile = !!customer?.needsRegistration;
  const askData = isGuest || needsProfile;
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(formatPhone(customer?.phone ?? ""));
  const [authOpen, setAuthOpen] = useState(false);
  const [receive, setReceive] = useState<Receive>("DELIVERY");
  const [address, setAddress] = useState<ConfirmedAddress | null>(null);
  const [payChoice, setPayChoice] = useState<PayChoice>("PIX");
  const [changeFor, setChangeFor] = useState("");
  const [noChange, setNoChange] = useState(true);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [includeDocument, setIncludeDocument] = useState(false);
  const [documentValue, setDocumentValue] = useState(() =>
    prefill?.documentNumber ? formatDocument(prefill.documentNumber) : "",
  );
  const [documentTouched, setDocumentTouched] = useState(false);
  /* Muda só quando um envio falha (nenhum pedido criado); reenvio/duplo clique reaproveita a chave. */
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const deliveryType: DeliveryType = receive === "DELIVERY" ? "DELIVERY" : "PICKUP";
  const paymentMethod = PAY_METHOD[payChoice];
  const onlinePayment = payChoice === "PIX" || payChoice === "ONLINE_CARD";
  const onsiteLabel = receive === "DELIVERY" ? "Pagar na entrega" : "Pagar na retirada / balcão";

  /* Cupom: aplicado só sobre os itens; o servidor valida e recalcula tudo ao criar o pedido. */
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<CartCoupon | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);

  async function applyCoupon() {
    if (!couponInput.trim() || couponLoading) return;
    setCouponLoading(true);
    setCouponError(null);
    try {
      const result = await validateCoupon(couponInput);
      if (result.ok) setCoupon(result.coupon);
      else {
        setCoupon(null);
        setCouponError(result.error);
      }
    } catch {
      setCouponError("Não foi possível validar o cupom. Tente novamente.");
    } finally {
      setCouponLoading(false);
    }
  }
  function removeCoupon() {
    setCoupon(null);
    setCouponInput("");
    setCouponError(null);
  }

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
  const changeForCents = payChoice === "CASH" && !noChange ? parseReaisToCents(changeFor) : null;

  const items = useMemo(
    () =>
      lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        addons: l.addons.map((a) => ({ addonId: a.addonId, quantity: a.quantity })),
      })),
    [lines],
  );

  /* Observações por item e detalhes da escolha entram nas notas do pedido para a cozinha/entregador. */
  const combinedNotes = [
    receive === "DINE_IN" ? "CONSUMIR NO LOCAL (salão)." : "",
    payChoice === "ONSITE_CREDIT" ? "Pagamento: cartão de CRÉDITO na máquina." : "",
    payChoice === "ONSITE_DEBIT" ? "Pagamento: cartão de DÉBITO na máquina." : "",
    notes.trim(),
    ...lines.filter((l) => l.note).map((l) => `${l.quantity}x ${l.name}: ${l.note}`),
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
        coupon,
      }),
    [items, catalog, deliveryType, zone, minOrderCents, paymentMethod, changeForCents, coupon],
  );

  const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const fee = deliveryType === "DELIVERY" && zone ? zone.feeCents : 0;
  const total = calc.ok ? calc.totalCents : subtotal + fee;
  const discount = calc.ok ? calc.discountCents : 0;

  /* Anúncios: o cliente chegou ao checkout com itens no carrinho (uma vez por visita). */
  const checkoutTracked = useRef(false);
  useEffect(() => {
    if (checkoutTracked.current || lines.length === 0) return;
    checkoutTracked.current = true;
    trackInitiateCheckout(subtotal, lines.length);
  }, [lines.length, subtotal]);

  /* Pedido mínimo: só entrega, sobre o subtotal dos produtos (sem a taxa). */
  const missingMinCents = deliveryType === "DELIVERY" ? Math.max(0, minOrderCents - subtotal) : 0;
  const belowMin = missingMinCents > 0;

  /* CPF/CNPJ: obrigatório no pagamento online; opcional (nota) no dinheiro. */
  const docRequired = onlinePayment || (payChoice === "CASH" && includeDocument);
  const docDigits = onlyDigits(documentValue);
  const docError = docRequired ? documentError(documentValue) : null;
  const showDocError = !!docError && (documentTouched || docDigits.length >= 11);

  /* Validação por etapa (o botão do rodapé só habilita com dados válidos). */
  /* Visitante / cadastro incompleto: nome e WhatsApp (só visitante) entram no passo 1; o CPF só é pedido no pagamento online. */
  const profileError = !askData
    ? null
    : name.trim().length < 2
      ? "Informe seu nome."
      : isGuest && onlyDigits(phone).length < 10
        ? "Informe o WhatsApp com DDD."
        : null;
  const step1Ready = receive !== "DELIVERY" || (!!address && !!quote?.deliverable && !!zone);
  const step2Ready = !docError && (payChoice !== "CASH" || noChange || changeForCents !== null);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  function goBackTop() {
    setError(null);
    setStep((s) => (s > 1 ? ((s - 1) as Step) : s));
  }

  function selectPay(choice: PayChoice) {
    setPayChoice(choice);
    setError(null);
    if (choice === "CASH") {
      setIncludeDocument(false);
      setDocumentTouched(false);
    }
  }

  function handleNext() {
    setError(null);
    if (step === 1) {
      if (!step1Ready) {
        setError(
          receive === "DELIVERY" && quote && !quote.deliverable ? quote.message : "Escolha um endereço de entrega.",
        );
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (docError) {
        setDocumentTouched(true);
        setError(docError);
        return;
      }
      if (payChoice === "CASH" && !noChange && changeForCents === null) {
        setError("Informe para quanto você precisa de troco.");
        return;
      }
      setStep(3);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (step !== 3) {
      handleNext();
      return;
    }
    setError(null);

    if (deliveryType === "DELIVERY") {
      if (!address) {
        setError("Escolha um endereço de entrega.");
        setStep(1);
        return;
      }
      if (quote && !quote.deliverable) {
        setError(quote.message);
        setStep(1);
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
      setStep(2);
      return;
    }

    if (profileError) {
      setError(profileError);
      return;
    }

    if (!calc.ok) {
      setError(calc.errors.map((e) => e.message).join(" "));
      return;
    }

    if (isGuest) {
      /* Revisão pronta: agora confirma o WhatsApp (modal). O pedido só é criado depois da validação. */
      setAuthOpen(true);
      return;
    }
    if (needsProfile) {
      startTransition(async () => {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, ...(docDigits.length === 11 && !documentError(documentValue) ? { document: documentValue } : {}) }),
        }).catch(() => null);
        if (!res || !res.ok) {
          const data = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
          setError(data?.error ?? "Não foi possível concluir seu cadastro. Tente novamente.");
          return;
        }
        placeOrder();
      });
      return;
    }
    placeOrder();
  }

  /** Cria o pedido (a sessão já existe). Em sucesso o servidor redireciona para o pagamento. */
  function placeOrder() {
    try {
      window.localStorage.setItem(CUSTOMER_PREFILL_KEY, JSON.stringify({ name, phone }));
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
          addr && usingFallback && addr.neighborhood ? `Bairro: ${addr.neighborhood.slice(0, 40)}` : null,
        paymentMethod,
        changeForCents,
        notes: combinedNotes || null,
        documentNumber: docRequired ? docDigits : null,
        idempotencyKey,
        couponCode: coupon?.code ?? null,
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
        setError(fieldMessages ? `${result.error} ${fieldMessages}` : result.error);
      }
    });
  }

  if (!hydrated) {
    return (
      <div className="flex min-h-[60dvh] justify-center bg-[#F8FAFC] py-20">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="min-h-[60dvh] bg-[#F8FAFC] px-4 py-20 text-center">
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

  /* Cards de seleção: borda + fundo suave âmbar quando ativos. */
  const selectable = (active: boolean) =>
    cn(
      "rounded-xl border-2 text-left transition active:scale-[0.99]",
      active ? "border-[#F59E0B] bg-amber-50 text-[#0A2540]" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    );

  const receiveOptions: { id: Receive; label: string; icon: React.ReactNode }[] = [
    { id: "DELIVERY", label: "Entrega", icon: <Bike className="h-6 w-6" strokeWidth={1.75} /> },
    { id: "DINE_IN", label: "Consumir no local", icon: <UtensilsCrossed className="h-6 w-6" strokeWidth={1.75} /> },
    { id: "PICKUP", label: "Retirada", icon: <Store className="h-6 w-6" strokeWidth={1.75} /> },
  ];

  const payOption = (choice: PayChoice, icon: React.ReactNode, hint?: string) => (
    <button
      key={choice}
      type="button"
      aria-pressed={payChoice === choice}
      onClick={() => selectPay(choice)}
      className={cn(selectable(payChoice === choice), "flex w-full items-center gap-3 px-4 py-3.5")}
    >
      <span className="shrink-0 text-[#0A2540]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{PAY_LABEL[choice].replace(" (online)", "")}</span>
        {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
          payChoice === choice ? "border-[#F59E0B] bg-[#F59E0B] text-[#0A2540]" : "border-slate-300",
        )}
      >
        {payChoice === choice ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
      </span>
    </button>
  );

  const documentField = (
    <div className="space-y-1.5">
      <Input
        className={inputClass}
        value={documentValue}
        onChange={(e) => setDocumentValue(formatDocument(e.target.value))}
        onBlur={() => setDocumentTouched(true)}
        inputMode="numeric"
        autoComplete="off"
        placeholder="CPF ou CNPJ"
        aria-label="CPF ou CNPJ"
        aria-invalid={showDocError}
        maxLength={18}
      />
      {showDocError ? (
        <p role="alert" className="text-xs font-medium text-red-700">
          {docError}
        </p>
      ) : null}
    </div>
  );

  const receiveSummary =
    receive === "DELIVERY"
      ? address
        ? `Entrega • ${address.street}, ${address.number}`
        : "Entrega"
      : receive === "DINE_IN"
        ? "Consumir no local"
        : "Retirada na loja";

  const primaryLabel = step === 1 ? "Continuar para Pagamento" : "Revisar Pedido";
  const primaryDisabled =
    step === 1
      ? !step1Ready
      : step === 2
        ? !step2Ready
        : isPending || !storeOpen || !calc.ok || belowMin || !!docError || !!profileError;

  return (
    <div className="min-h-[calc(100dvh-64px)] bg-[#F8FAFC] text-[#0A2540]">
      <nav aria-label="Navegação do checkout" className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-12 max-w-xl items-center px-4">
          {step === 1 ? (
            <Link
              href="/#cardapio"
              className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-[#0A2540] transition hover:bg-slate-100 active:scale-95"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </Link>
          ) : (
            <button
              type="button"
              onClick={goBackTop}
              className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-[#0A2540] transition hover:bg-slate-100 active:scale-95"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </button>
          )}
        </div>
      </nav>

      <form onSubmit={handleSubmit} className="mx-auto max-w-xl space-y-4 px-4 pb-48 pt-6">
        <div key={step} className="animate-in fade-in slide-in-from-right-2 space-y-4 duration-300">
          {/* ------------------------------ ETAPA 1 ------------------------------ */}
          {step === 1 ? (
            <>
              <h1 className="text-2xl font-extrabold">Como deseja receber?</h1>
              <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Como deseja receber">
                {receiveOptions.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={receive === o.id}
                    onClick={() => {
                      setReceive(o.id);
                      setError(null);
                    }}
                    className={cn(
                      selectable(receive === o.id),
                      "flex min-h-[88px] flex-col items-center justify-center gap-1.5 px-1 text-center",
                    )}
                  >
                    {o.icon}
                    <span className="text-xs font-semibold leading-tight">{o.label}</span>
                  </button>
                ))}
              </div>

              {receive === "DELIVERY" ? (
                <section className={cardClass}>
                  <AddressPicker
                    defaultAddress={prefill?.lastAddress ?? null}
                    value={address}
                    onChange={setAddress}
                    estimatedMinutes={zone?.estimatedMinutes ?? null}
                  />
                </section>
              ) : null}

              {receive === "DINE_IN" ? (
                <section className={cardClass}>
                  <p className="font-bold">Consumir no salão</p>
                  <p className="text-sm text-slate-600">
                    Seu pedido será preparado para consumo no salão da hamburgueria. Taxa de entrega:{" "}
                    <strong>R$ 0,00</strong>.
                  </p>
                  <p className="text-xs text-slate-500">{STORE_LINE}</p>
                </section>
              ) : null}

              {receive === "PICKUP" ? (
                <section className={cardClass}>
                  <p className="font-bold">Retire no balcão</p>
                  <p className="text-sm text-slate-600">{STORE_LINE}</p>
                  <p className="text-xs text-slate-500">Avisaremos pelo acompanhamento quando estiver pronto.</p>
                  <a
                    href={STORE_MAPS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-[#0A2540] transition hover:bg-slate-50"
                  >
                    <ExternalLink className="h-4 w-4" strokeWidth={1.75} /> Ver no mapa
                  </a>
                </section>
              ) : null}
            </>
          ) : null}

          {/* ------------------------------ ETAPA 2 ------------------------------ */}
          {step === 2 ? (
            <>
              <h1 className="text-2xl font-extrabold">Forma de pagamento</h1>

              <section className={cardClass}>
                <div className="flex items-center gap-2">
                  <QrCode className="h-4 w-4 text-[#0A2540]" strokeWidth={1.75} />
                  <h2 className="font-bold">Pagar online</h2>
                </div>
                <div className="space-y-2.5">
                  {payOption("PIX", <QrCode className="h-5 w-5" strokeWidth={1.75} />, "Aprovação na hora")}
                  {payChoice === "PIX" ? (
                    <div className="space-y-3 rounded-xl bg-slate-50 p-3">
                      <p className="text-sm text-slate-600">
                        Seu pedido vai para a cozinha assim que o PIX for confirmado.
                      </p>
                      <Field label="CPF/CNPJ (obrigatório para pagar online)">{documentField}</Field>
                    </div>
                  ) : null}
                  {payOption(
                    "ONLINE_CARD",
                    <CreditCard className="h-5 w-5" strokeWidth={1.75} />,
                    "Você informa os dados na próxima tela",
                  )}
                  {payChoice === "ONLINE_CARD" ? (
                    <div className="space-y-3 rounded-xl bg-slate-50 p-3">
                      <p className="text-sm text-slate-600">
                        Você informa os dados do cartão na próxima tela, em ambiente seguro. Eles não ficam salvos no
                        nosso sistema.
                      </p>
                      <Field label="CPF/CNPJ (obrigatório para pagar online)">{documentField}</Field>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className={cardClass}>
                <div className="flex items-center gap-2">
                  {receive === "DELIVERY" ? (
                    <Bike className="h-4 w-4 text-[#0A2540]" strokeWidth={1.75} />
                  ) : (
                    <Store className="h-4 w-4 text-[#0A2540]" strokeWidth={1.75} />
                  )}
                  <h2 className="font-bold">{onsiteLabel}</h2>
                </div>
                <div className="space-y-2.5">
                  {payOption("ONSITE_CREDIT", <CreditCard className="h-5 w-5" strokeWidth={1.75} />, "Cartão de crédito")}
                  {payOption("ONSITE_DEBIT", <CreditCard className="h-5 w-5" strokeWidth={1.75} />, "Cartão de débito")}
                  {payOption("CASH", <Banknote className="h-5 w-5" strokeWidth={1.75} />)}
                  {payChoice === "CASH" ? (
                    <div className="space-y-3 rounded-xl bg-slate-50 p-3">
                      <p className="text-sm font-medium text-slate-700">Troco para quanto?</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          className={cn(selectable(noChange), "h-12 px-2 text-center text-sm font-semibold")}
                          onClick={() => setNoChange(true)}
                        >
                          Não preciso de troco
                        </button>
                        <button
                          type="button"
                          className={cn(selectable(!noChange), "h-12 px-2 text-center text-sm font-semibold")}
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
                      <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
                        <label htmlFor="checkout-doc-switch" className="text-sm font-medium text-slate-700">
                          Incluir CPF/CNPJ na nota
                        </label>
                        <Switch
                          id="checkout-doc-switch"
                          checked={includeDocument}
                          onCheckedChange={(on) => {
                            setIncludeDocument(on);
                            if (!on) setDocumentTouched(false);
                          }}
                          className="bg-slate-300 focus-visible:ring-[#F59E0B] data-[state=checked]:bg-[#F59E0B]"
                        />
                      </div>
                      {includeDocument ? documentField : null}
                    </div>
                  ) : null}
                </div>
              </section>
            </>
          ) : null}

          {/* ------------------------------ ETAPA 3 ------------------------------ */}
          {step === 3 ? (
            <>
              <h1 className="text-2xl font-extrabold">Revise seu pedido</h1>

              <section className={cardClass}>
                <h2 className="font-bold">Entrega & pagamento</h2>
                <div className="space-y-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recebimento</p>
                      <p className="font-medium">{receiveSummary}</p>
                      {receive === "DELIVERY" && address ? (
                        <p className="truncate text-xs text-slate-500">
                          {[address.neighborhood, `${address.city} - ${address.state}`].filter(Boolean).join(" • ")}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="shrink-0 text-xs font-semibold text-[#0A2540] underline underline-offset-2"
                    >
                      Alterar
                    </button>
                  </div>
                  <div className="flex items-start justify-between gap-3 border-t border-slate-100 pt-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pagamento</p>
                      <p className="font-medium">
                        {PAY_LABEL[payChoice]}
                        {!onlinePayment ? ` • ${onsiteLabel.toLowerCase()}` : ""}
                      </p>
                      {payChoice === "CASH" ? (
                        <p className="text-xs text-slate-500">
                          {noChange ? "Sem troco" : changeForCents ? `Troco para ${formatCents(changeForCents)}` : ""}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="shrink-0 text-xs font-semibold text-[#0A2540] underline underline-offset-2"
                    >
                      Alterar
                    </button>
                  </div>
                </div>
              </section>

              <section className={cardClass}>
                <h2 className="font-bold">Seus dados</h2>
                <Field label="Nome">
                  <Input
                    className={inputClass}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    readOnly={!askData}
                    autoComplete="name"
                    maxLength={80}
                    placeholder="Seu nome"
                    required
                  />
                </Field>
                <Field label="WhatsApp">
                  <Input
                    className={inputClass}
                    value={phone}
                    onChange={(e) => setPhone(formatPhone(e.target.value))}
                    readOnly={!isGuest}
                    inputMode="tel"
                    autoComplete="tel-national"
                    placeholder="(XX) XXXXX-XXXX"
                    required
                  />
                </Field>
                {isGuest ? (
                  <p className="text-xs text-slate-500">
                    Ao enviar o pedido você confirma o número por um código no WhatsApp. Sem senha, sem cadastro separado.
                  </p>
                ) : null}
              </section>

              <section className={cardClass}>
                <h2 className="font-bold">Itens do pedido</h2>
                <ul className="space-y-2 text-sm">
                  {lines.map((l) => (
                    <li key={l.key} className="flex justify-between gap-3">
                      <span>
                        {l.quantity}x {l.name}
                        {l.addons.length > 0 ? (
                          <span className="block text-xs text-slate-500">
                            {l.addons.map((a) => (a.quantity > 1 ? `${a.quantity}x ${a.name}` : a.name)).join(", ")}
                          </span>
                        ) : null}
                        {l.note ? <span className="block text-xs italic text-slate-500">Obs: {l.note}</span> : null}
                      </span>
                      <span className="shrink-0 font-semibold">{formatCents(lineTotal(l))}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {isGuest ? null : (
              <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
                <label htmlFor="coupon" className="font-semibold">
                  Cupom de desconto
                </label>
                {coupon ? (
                  <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
                    <span>
                      {coupon.code} aplicado{" "}
                      {coupon.freeShipping ? "(frete grátis)" : calc.ok ? `(-${formatCents(calc.discountCents)})` : ""}
                    </span>
                    <button type="button" onClick={removeCoupon} className="font-semibold underline">
                      Remover
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      id="coupon"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        /* Enter aplica o cupom; nunca envia o pedido sem querer. */
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void applyCoupon();
                        }
                      }}
                      placeholder="Digite seu cupom"
                      maxLength={40}
                      autoCapitalize="characters"
                      autoComplete="off"
                      className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-base uppercase text-slate-900 placeholder:text-slate-400 focus:border-[#F59E0B] focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/30"
                    />
                    <button
                      type="button"
                      onClick={() => void applyCoupon()}
                      disabled={couponLoading || !couponInput.trim()}
                      className="h-11 rounded-xl bg-[#071329] px-4 font-semibold text-white disabled:opacity-50"
                    >
                      {couponLoading ? "..." : "Aplicar"}
                    </button>
                  </div>
                )}
                {couponError ? <p className="text-red-700">{couponError}</p> : null}
              </section>
              )}

              <section className={cardClass}>
                <Field label="Observações (opcional)">
                  <Textarea
                    className={cn(inputClass, "h-auto min-h-24 py-3")}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={300}
                  />
                </Field>
              </section>

              <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Subtotal</span>
                  <span>{formatCents(subtotal)}</span>
                </div>
                {coupon ? (
                  <div className="flex justify-between text-emerald-700">
                    <span>Cupom {coupon.code}</span>
                    <span>-{formatCents(discount)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <span className="text-slate-500">Taxa de entrega</span>
                  <span>{deliveryType === "DELIVERY" ? (zone ? formatCents(fee) : "—") : "Grátis"}</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-extrabold">
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
            </>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {/* Rodapé fixo: progresso (4 pontos; o 4º é a tela de pagamento) + ação principal */}
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
          <div className="mx-auto max-w-xl space-y-2.5 p-3">
            {storeOpen && belowMin && step === 3 ? (
              <p
                role="status"
                className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs font-medium text-amber-900"
              >
                {minOrderMessage(minOrderCents, missingMinCents)}
              </p>
            ) : null}
            {!storeOpen ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs font-medium text-amber-900">
                A loja está fechada no momento. Não é possível finalizar o pedido agora.
              </p>
            ) : null}

            <ol aria-label={`Etapa ${step} de 3`} className="mx-auto flex w-full max-w-[220px] items-center">
              {[1, 2, 3, 4].map((n) => (
                <li
                  key={n}
                  className="flex flex-1 items-center last:flex-none"
                  aria-current={n === step ? "step" : undefined}
                >
                  <span
                    className={cn(
                      "h-3 w-3 shrink-0 rounded-full border-2 transition-colors",
                      n <= step ? "border-[#F59E0B] bg-[#F59E0B]" : "border-slate-300 bg-white",
                    )}
                  />
                  {n < 4 ? (
                    <span className={cn("h-0.5 flex-1 transition-colors", n < step ? "bg-[#F59E0B]" : "bg-slate-200")} />
                  ) : null}
                </li>
              ))}
            </ol>

            {step === 3 ? (
              <button
                key="confirm"
                type="submit"
                disabled={primaryDisabled}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#F59E0B] text-base font-bold text-[#0A2540] transition hover:brightness-105 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                {isPending ? "Enviando pedido..." : `Confirmar pedido • ${formatCents(total)}`}
              </button>
            ) : (
              <button
                key="next"
                type="button"
                onClick={handleNext}
                disabled={primaryDisabled}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#F59E0B] text-base font-bold text-[#0A2540] transition hover:brightness-105 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {primaryLabel}
              </button>
            )}
          </div>
        </div>
      </form>

      {isGuest ? (
        <Sheet open={authOpen} onOpenChange={setAuthOpen} title="Confirme seu WhatsApp">
          <div className="overflow-y-auto">
            {authOpen ? (
              <PhoneLookup
                embedded
                autoStart={{ phone, name, cpf: documentValue }}
                onAuthenticated={() => {
                  setAuthOpen(false);
                  placeOrder();
                }}
              />
            ) : null}
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
