"use client";

import { ArrowLeft, Banknote, Bike, Check, CreditCard, Loader2, QrCode, Store, UtensilsCrossed } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Switch } from "@/components/ui/switch";
import { AddressPicker } from "@/components/storefront/address-picker";
import type { ConfirmedAddress } from "@/components/storefront/address-book";
import { calculateDeliveryQuote } from "@/core/delivery/quote";
import { documentError, formatDocument, onlyDigits } from "@/core/validation/document";
import { cn, formatCents } from "@/lib/utils";

export type CheckoutPrefill = {
  /** Cadastro incompleto: pede só o que falta (nome e/ou CPF). */
  needsProfile: boolean;
  /** Nome já cadastrado ("" se não houver). */
  name: string;
  /** CPF já salvo: não pede de novo. */
  hasDocument: boolean;
  addresses: { id: string; street: string; number: string; complement: string; reference: string }[];
  primaryFeeCents?: number | null;
  /** Último endereço salvo, já localizado: vem selecionado no seletor de endereço. */
  defaultAddress?: Omit<ConfirmedAddress, "id" | "usedAt"> | null;
};

export type SummaryLine = { key: string; text: string; detail?: string; totalCents: number };

type Receive = "DELIVERY" | "DINE_IN" | "PICKUP";
/** Mesmas opções do checkout do site. */
type PayChoice = "PIX" | "ONLINE_CARD" | "ONSITE_CREDIT" | "ONSITE_DEBIT" | "CASH";

const PAY_LABEL: Record<PayChoice, string> = {
  PIX: "PIX",
  ONLINE_CARD: "Cartão de crédito (online)",
  ONSITE_CREDIT: "Cartão de crédito",
  ONSITE_DEBIT: "Cartão de débito",
  CASH: "Dinheiro",
};

const PAY_METHOD: Record<PayChoice, "PIX" | "CREDIT_CARD" | "CARD_ON_DELIVERY" | "CASH"> = {
  PIX: "PIX",
  ONLINE_CARD: "CREDIT_CARD",
  ONSITE_CREDIT: "CARD_ON_DELIVERY",
  ONSITE_DEBIT: "CARD_ON_DELIVERY",
  CASH: "CASH",
};

function parseReaisToCents(value: string): number | null {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) : null;
}
type Step = 1 | 2 | 3;

const inputClass =
  "h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/30";
const cardClass = "space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

const selectable = (active: boolean) =>
  cn(
    "rounded-xl border-2 text-left transition active:scale-[0.99]",
    active ? "border-[#F59E0B] bg-amber-50 text-[#0A2540]" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  );

/**
 * Checkout do Cardápio Rápido: o mesmo passo a passo do site (Receber, Pagamento, Revisão, rodapé com 4 pontos),
 * só que sem login: o link assinado já prova o telefone. Cliente conhecido é chamado pelo nome, vê o endereço salvo
 * e não digita nada; só quem ainda não tem nome/CPF cadastrados informa esses dois dados. O pagamento é sempre online
 * (Pix ou cartão): a escolha aqui só define a opção que já vem marcada na tela de pagamento.
 */
export function QuickCheckoutForm({
  token,
  prefill,
  lines,
  subtotalCents,
  items,
  onBack,
  onSubmitted,
}: {
  token: string;
  prefill: CheckoutPrefill;
  lines: SummaryLine[];
  subtotalCents: number;
  /** Itens da sacola; null = atalho "Repetir pedido" (o servidor usa o rascunho salvo). */
  items: unknown[] | null;
  onBack?: () => void;
  onSubmitted?: () => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [receive, setReceive] = useState<Receive>("DELIVERY");
  const [payChoice, setPayChoice] = useState<PayChoice>("PIX");
  const [changeFor, setChangeFor] = useState("");
  const [noChange, setNoChange] = useState(true);
  const [includeDocument, setIncludeDocument] = useState(false);
  const [offlineDone, setOfflineDone] = useState<{ orderNumber: number; whatsappUrl: string | null } | null>(null);
  const [name, setName] = useState(prefill.name);
  const [cpf, setCpf] = useState("");
  const [address, setAddress] = useState<ConfirmedAddress | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "sending" | "done">("idle");

  const delivery = receive === "DELIVERY";
  const quote = useMemo(
    () => (address ? calculateDeliveryQuote(address.lat, address.lon, address.city) : null),
    [address],
  );
  const knownFee = delivery && quote?.deliverable ? quote.feeCents : null;
  /* Dados pessoais só no fim: CPF na etapa de pagamento (é online), nome na revisão. */
  const askName = prefill.needsProfile && !prefill.name;
  const askDocument = prefill.needsProfile && !prefill.hasDocument;
  const onlinePayment = payChoice === "PIX" || payChoice === "ONLINE_CARD";
  const onsiteLabel = receive === "DELIVERY" ? "Pagar na entrega" : "Pagar na retirada / balcão";
  const changeForCents = payChoice === "CASH" && !noChange ? parseReaisToCents(changeFor) : null;
  /* CPF: obrigatório no online; no dinheiro só se o cliente quiser na nota. */
  const docRequired = askDocument && (onlinePayment || (payChoice === "CASH" && includeDocument));
  const firstName = prefill.name.trim().split(/\s+/)[0];

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  function addressError(): string | null {
    if (!delivery) return null;
    if (!address) return "Escolha um endereço de entrega.";
    if (quote && !quote.deliverable) return quote.message;
    return null;
  }
  function documentStepError(): string | null {
    if (payChoice === "CASH" && !noChange && changeForCents === null) return "Informe para quanto você precisa de troco.";
    if (!docRequired) return null;
    const docErr = documentError(cpf);
    return docErr || onlyDigits(cpf).length !== 11 ? (docErr ?? "Informe um CPF válido.") : null;
  }
  function nameError(): string | null {
    return askName && name.trim().length < 2 ? "Informe seu nome." : null;
  }

  function next() {
    const err = step === 1 ? addressError() : step === 2 ? documentStepError() : null;
    if (err) return setError(err);
    setError(null);
    setStep((s) => (s < 3 ? ((s + 1) as Step) : s));
  }

  function back() {
    setError(null);
    if (step > 1) setStep((s) => (s - 1) as Step);
    else onBack?.();
  }

  async function submit() {
    if (phase !== "idle") return;
    const checks: [Step, string | null][] = [
      [1, addressError()],
      [2, documentStepError()],
      [3, nameError()],
    ];
    const failed = checks.find(([, message]) => message);
    if (failed) {
      setStep(failed[0]);
      return setError(failed[1]);
    }
    setError(null);
    setPhase("sending");
    try {
      const res = await fetch("/api/whatsapp/cart-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          ...(items ? { items } : {}),
          checkout: {
            deliveryType: delivery ? "DELIVERY" : "PICKUP",
            ...(receive === "DINE_IN" ? { dineIn: true } : {}),
            paymentMethod: PAY_METHOD[payChoice],
            ...(payChoice === "ONSITE_CREDIT" ? { onsiteCard: "CREDIT" } : {}),
            ...(payChoice === "ONSITE_DEBIT" ? { onsiteCard: "DEBIT" } : {}),
            ...(changeForCents ? { changeForCents } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
            ...(prefill.needsProfile
              ? {
                  ...(prefill.name ? {} : { name }),
                  ...(prefill.hasDocument || !docRequired ? {} : { document: cpf }),
                }
              : {}),
            ...(delivery && address
              ? {
                  address: {
                    street: address.street,
                    number: address.number,
                    complement: address.complement || undefined,
                    lat: address.lat,
                    lon: address.lon,
                    city: address.city,
                    neighborhood: address.neighborhood || undefined,
                    postalCode: address.postalCode || undefined,
                  },
                }
              : {}),
          },
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; redirectUrl: string }
        | { ok: true; offline: true; orderNumber: number; whatsappUrl: string | null }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !data || !data.ok) {
        setError((data && !data.ok && data.error) || "Não foi possível continuar. Tente novamente.");
        setPhase("idle");
        return;
      }
      onSubmitted?.();
      if ("offline" in data) {
        setOfflineDone({ orderNumber: data.orderNumber, whatsappUrl: data.whatsappUrl });
        setPhase("done");
        return;
      }
      setPhase("done");
      window.location.assign(data.redirectUrl);
    } catch {
      setError("Sem conexão. Tente novamente.");
      setPhase("idle");
    }
  }

  function onFormSubmit(event: FormEvent) {
    event.preventDefault();
    if (step === 3) void submit();
    else next();
  }

  if (phase === "done" && offlineDone) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#F8FAFC] p-8 text-center text-[#0A2540]">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <Check className="h-8 w-8" />
        </span>
        <p className="text-lg font-bold">Pedido #{offlineDone.orderNumber} confirmado!</p>
        <p className="max-w-sm text-sm text-slate-600">
          Já mandamos para a cozinha. O pagamento é feito na {delivery ? "entrega" : "retirada"}: {PAY_LABEL[payChoice].toLowerCase()}.
        </p>
        {offlineDone.whatsappUrl ? (
          <a href={offlineDone.whatsappUrl} className="flex h-12 items-center rounded-xl bg-[#25D366] px-6 font-bold text-[#052e16]">
            Voltar ao WhatsApp
          </a>
        ) : null}
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#F8FAFC] p-8 text-center text-[#0A2540]">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <Check className="h-8 w-8" />
        </span>
        <p className="text-lg font-bold">Pedido anotado!</p>
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Abrindo o pagamento...
        </p>
      </div>
    );
  }

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
      onClick={() => {
        setPayChoice(choice);
        setError(null);
        if (choice === "CASH") setIncludeDocument(false);
      }}
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

  const addressLine = address ? `${address.street}, ${address.number}` : "";
  const receiveSummary =
    receive === "DELIVERY" ? `Entrega • ${addressLine}` : receive === "DINE_IN" ? "Consumir no local" : "Retirada na loja";
  const total = subtotalCents + (knownFee ?? 0);
  const primaryLabel = step === 1 ? "Continuar para Pagamento" : "Revisar Pedido";

  return (
    <div className="min-h-dvh bg-[#F8FAFC] text-[#0A2540]">
      <header className="flex h-16 items-center justify-center bg-[#071329]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo_passaporteburguer_nav.min.webp" alt="Passaporte Burguer" className="h-10 w-auto object-contain" />
      </header>

      <nav aria-label="Navegação do checkout" className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-12 max-w-xl items-center px-4">
          {step > 1 || onBack ? (
            <button
              type="button"
              onClick={back}
              className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold transition hover:bg-slate-100 active:scale-95"
            >
              <ArrowLeft className="h-4 w-4" />
              {step === 1 ? "Voltar ao cardápio" : "Voltar"}
            </button>
          ) : null}
        </div>
      </nav>

      <form onSubmit={onFormSubmit} className="mx-auto max-w-xl space-y-4 px-4 pb-48 pt-6">
        <div key={step} className="animate-in fade-in slide-in-from-right-2 space-y-4 duration-300">
          {/* ------------------------------ ETAPA 1 ------------------------------ */}
          {step === 1 ? (
            <>
              {firstName ? <p className="text-base font-bold">Olá, {firstName}! 👋</p> : null}
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

              {delivery ? (
                <section className={cardClass}>
                  <h2 className="font-bold">Endereço de entrega</h2>
                  <AddressPicker value={address} onChange={setAddress} defaultAddress={prefill.defaultAddress ?? null} />
                  <p className="text-xs text-slate-500">Entregamos só em Maringá-PR.</p>
                </section>
              ) : null}

              {receive === "DINE_IN" ? (
                <section className={cardClass}>
                  <p className="font-bold">Consumir no salão</p>
                  <p className="text-sm text-slate-600">
                    Seu pedido será preparado para consumo no salão. Taxa de entrega: <strong>R$ 0,00</strong>.
                  </p>
                </section>
              ) : null}

              {receive === "PICKUP" ? (
                <section className={cardClass}>
                  <p className="font-bold">Retire no balcão</p>
                  <p className="text-sm text-slate-600">Você retira o pedido aqui na loja. Sem taxa de entrega.</p>
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
                      <p className="text-sm text-slate-600">Seu pedido vai para a cozinha assim que o PIX for confirmado.</p>
                      {askDocument ? (
                        <Field label="CPF/CNPJ (obrigatório para pagar online)">
                          <input
                            className={inputClass}
                            value={cpf}
                            onChange={(e) => setCpf(formatDocument(e.target.value))}
                            inputMode="numeric"
                            autoComplete="off"
                            placeholder="CPF ou CNPJ"
                            maxLength={18}
                          />
                        </Field>
                      ) : null}
                    </div>
                  ) : null}
                  {payOption("ONLINE_CARD", <CreditCard className="h-5 w-5" strokeWidth={1.75} />, "Você informa os dados na próxima tela")}
                  {payChoice === "ONLINE_CARD" ? (
                    <div className="space-y-3 rounded-xl bg-slate-50 p-3">
                      <p className="text-sm text-slate-600">
                        Você informa os dados do cartão na próxima tela, em ambiente seguro. Eles não ficam salvos no nosso sistema.
                      </p>
                      {askDocument ? (
                        <Field label="CPF/CNPJ (obrigatório para pagar online)">
                          <input
                            className={inputClass}
                            value={cpf}
                            onChange={(e) => setCpf(formatDocument(e.target.value))}
                            inputMode="numeric"
                            autoComplete="off"
                            placeholder="CPF ou CNPJ"
                            maxLength={18}
                          />
                        </Field>
                      ) : null}
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
                  {payOption("ONSITE_CREDIT", <CreditCard className="h-5 w-5" strokeWidth={1.75} />)}
                  {payOption("ONSITE_DEBIT", <CreditCard className="h-5 w-5" strokeWidth={1.75} />)}
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
                        <input
                          className={inputClass}
                          value={changeFor}
                          onChange={(e) => setChangeFor(e.target.value)}
                          inputMode="decimal"
                          placeholder="Ex: 100,00"
                          aria-label="Troco para quanto?"
                        />
                      ) : null}
                      {askDocument ? (
                        <>
                          <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
                            <label htmlFor="quick-doc-switch" className="text-sm font-medium text-slate-700">
                              Incluir CPF/CNPJ na nota
                            </label>
                            <Switch
                              id="quick-doc-switch"
                              checked={includeDocument}
                              onCheckedChange={setIncludeDocument}
                              className="bg-slate-300 focus-visible:ring-[#F59E0B] data-[state=checked]:bg-[#F59E0B]"
                            />
                          </div>
                          {includeDocument ? (
                            <input
                              className={inputClass}
                              value={cpf}
                              onChange={(e) => setCpf(formatDocument(e.target.value))}
                              inputMode="numeric"
                              autoComplete="off"
                              placeholder="CPF ou CNPJ"
                              aria-label="CPF ou CNPJ"
                              maxLength={18}
                            />
                          ) : null}
                        </>
                      ) : null}
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
              {askName ? (
                <section className={cardClass}>
                  <h2 className="font-bold">Seus dados</h2>
                  <Field label="Nome completo">
                    <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
                  </Field>
                  <p className="text-xs text-slate-500">Só na primeira vez: da próxima, seu pedido já vai preenchido.</p>
                </section>
              ) : null}


              <section className={cardClass}>
                <h2 className="font-bold">Entrega & pagamento</h2>
                <div className="space-y-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recebimento</p>
                      <p className="font-medium">{receiveSummary}</p>
                    </div>
                    <button type="button" onClick={() => setStep(1)} className="shrink-0 text-xs font-semibold underline underline-offset-2">
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
                    <button type="button" onClick={() => setStep(2)} className="shrink-0 text-xs font-semibold underline underline-offset-2">
                      Alterar
                    </button>
                  </div>
                </div>
              </section>

              <section className={cardClass}>
                <h2 className="font-bold">Itens do pedido</h2>
                <ul className="space-y-2 text-sm">
                  {lines.map((l) => (
                    <li key={l.key} className="flex justify-between gap-3">
                      <span className="min-w-0">
                        {l.text}
                        {l.detail ? <span className="block text-xs text-slate-500">{l.detail}</span> : null}
                      </span>
                      {l.totalCents > 0 ? <span className="shrink-0 font-semibold">{formatCents(l.totalCents)}</span> : null}
                    </li>
                  ))}
                </ul>
              </section>

              <section className={cardClass}>
                <Field label="Observações (opcional)">
                  <textarea
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
                  <span>{formatCents(subtotalCents)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Taxa de entrega</span>
                  <span>{!delivery ? "Grátis" : knownFee !== null ? formatCents(knownFee) : "Calculada no pagamento"}</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-extrabold">
                  <span>Total</span>
                  <span>{delivery && knownFee === null ? `a partir de ${formatCents(total)}` : formatCents(total)}</span>
                </div>
              </section>
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
            <ol aria-label={`Etapa ${step} de 3`} className="mx-auto flex w-full max-w-[220px] items-center">
              {[1, 2, 3, 4].map((n) => (
                <li key={n} className="flex flex-1 items-center last:flex-none" aria-current={n === step ? "step" : undefined}>
                  <span
                    className={cn(
                      "h-3 w-3 shrink-0 rounded-full border-2 transition-colors",
                      n <= step ? "border-[#F59E0B] bg-[#F59E0B]" : "border-slate-300 bg-white",
                    )}
                  />
                  {n < 4 ? <span className={cn("h-0.5 flex-1 transition-colors", n < step ? "bg-[#F59E0B]" : "bg-slate-200")} /> : null}
                </li>
              ))}
            </ol>

            <button
              type="submit"
              disabled={phase === "sending"}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#F59E0B] text-base font-bold text-[#0A2540] transition hover:brightness-105 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            >
              {phase === "sending" ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
              {phase === "sending" ? "Enviando pedido..." : step === 3 ? (onlinePayment ? "Seguir para o pagamento" : "Confirmar pedido") : primaryLabel}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
