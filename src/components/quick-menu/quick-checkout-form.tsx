"use client";

import { ArrowLeft, Bike, Check, CreditCard, Loader2, QrCode, Store, UtensilsCrossed } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

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
};

export type SummaryLine = { key: string; text: string; detail?: string; totalCents: number };

type Receive = "DELIVERY" | "DINE_IN" | "PICKUP";
type Pay = "PIX" | "CREDIT_CARD";
type Step = 1 | 2 | 3;

const inputClass =
  "h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/30";
const cardClass = "space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm";
const NEW_ADDRESS = "new";

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
  const [pay, setPay] = useState<Pay>("PIX");
  const [name, setName] = useState(prefill.name);
  const [cpf, setCpf] = useState("");
  const [addressId, setAddressId] = useState<string>(prefill.addresses[0]?.id ?? NEW_ADDRESS);
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [pickingAddress, setPickingAddress] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "sending" | "done">("idle");

  const delivery = receive === "DELIVERY";
  const usingSaved = addressId !== NEW_ADDRESS;
  const selectedSaved = prefill.addresses.find((a) => a.id === addressId) ?? null;
  /* A taxa só é conhecida para o endereço pré-selecionado (o 1º salvo). */
  const knownFee =
    delivery && selectedSaved && selectedSaved.id === prefill.addresses[0]?.id ? (prefill.primaryFeeCents ?? null) : null;
  const askName = prefill.needsProfile && !prefill.name;
  const askDocument = prefill.needsProfile && !prefill.hasDocument;
  const firstName = prefill.name.trim().split(/\s+/)[0];

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  /** Valida a etapa 1 (recebimento + cadastro); devolve a mensagem de erro ou null. */
  function step1Error(): string | null {
    if (askName && name.trim().length < 2) return "Informe seu nome.";
    if (askDocument) {
      const docErr = documentError(cpf);
      if (docErr || onlyDigits(cpf).length !== 11) return docErr ?? "Informe um CPF válido.";
    }
    if (delivery && !usingSaved && (street.trim().length < 2 || !number.trim())) {
      return "Informe rua e número para a entrega.";
    }
    return null;
  }

  function next() {
    if (step === 1) {
      const err = step1Error();
      if (err) return setError(err);
    }
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
    const err = step1Error();
    if (err) {
      setStep(1);
      return setError(err);
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
            paymentMethod: pay,
            ...(notes.trim() ? { notes: notes.trim() } : {}),
            ...(prefill.needsProfile
              ? {
                  ...(prefill.name ? {} : { name }),
                  ...(prefill.hasDocument ? {} : { document: cpf }),
                }
              : {}),
            ...(delivery
              ? usingSaved
                ? { savedAddressId: addressId }
                : {
                    address: {
                      street,
                      number,
                      complement: complement || undefined,
                      reference: reference || undefined,
                    },
                  }
              : {}),
          },
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok: true; redirectUrl: string } | { ok: false; error?: string } | null;
      if (!res.ok || !data || !data.ok) {
        setError((data && !data.ok && data.error) || "Não foi possível continuar. Tente novamente.");
        setPhase("idle");
        return;
      }
      setPhase("done");
      onSubmitted?.();
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

  const payOption = (choice: Pay, icon: React.ReactNode, label: string, hint: string) => (
    <button
      key={choice}
      type="button"
      aria-pressed={pay === choice}
      onClick={() => setPay(choice)}
      className={cn(selectable(pay === choice), "flex w-full items-center gap-3 px-4 py-3.5")}
    >
      <span className="shrink-0 text-[#0A2540]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
          pay === choice ? "border-[#F59E0B] bg-[#F59E0B] text-[#0A2540]" : "border-slate-300",
        )}
      >
        {pay === choice ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
      </span>
    </button>
  );

  const addressLine = selectedSaved && usingSaved ? `${selectedSaved.street}, ${selectedSaved.number}` : `${street}, ${number}`;
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
                  {selectedSaved && !pickingAddress ? (
                    <div className="flex items-start gap-3 rounded-xl border-2 border-[#F59E0B] bg-amber-50 px-3 py-3">
                      <div className="min-w-0 flex-1 text-sm">
                        <span className="font-semibold">
                          {selectedSaved.street}, {selectedSaved.number}
                        </span>
                        {selectedSaved.complement ? (
                          <span className="block text-xs text-slate-500">{selectedSaved.complement}</span>
                        ) : null}
                        {knownFee !== null ? (
                          <span className="mt-1 block text-xs text-slate-600">Taxa de entrega: {formatCents(knownFee)}</span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => setPickingAddress(true)}
                        className="shrink-0 text-xs font-semibold underline underline-offset-2"
                      >
                        Alterar
                      </button>
                    </div>
                  ) : prefill.addresses.length > 0 ? (
                    <div className="space-y-2" role="radiogroup" aria-label="Endereço">
                      {prefill.addresses.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          role="radio"
                          aria-checked={addressId === a.id}
                          onClick={() => setAddressId(a.id)}
                          className={cn(selectable(addressId === a.id), "w-full px-3 py-3 text-sm")}
                        >
                          <span className="font-semibold">
                            {a.street}, {a.number}
                          </span>
                          {a.complement ? <span className="block text-xs text-slate-500">{a.complement}</span> : null}
                        </button>
                      ))}
                      <button
                        type="button"
                        role="radio"
                        aria-checked={addressId === NEW_ADDRESS}
                        onClick={() => setAddressId(NEW_ADDRESS)}
                        className={cn(selectable(addressId === NEW_ADDRESS), "w-full px-3 py-3 text-sm font-semibold")}
                      >
                        + Entregar em outro endereço
                      </button>
                    </div>
                  ) : null}
                  {!usingSaved ? (
                    <>
                      <div className="grid grid-cols-[1fr_6rem] gap-3">
                        <Field label="Rua">
                          <input className={inputClass} value={street} onChange={(e) => setStreet(e.target.value)} autoComplete="street-address" maxLength={120} />
                        </Field>
                        <Field label="Número">
                          <input className={inputClass} value={number} onChange={(e) => setNumber(e.target.value)} maxLength={20} />
                        </Field>
                      </div>
                      <Field label="Complemento (opcional)">
                        <input className={inputClass} value={complement} onChange={(e) => setComplement(e.target.value)} maxLength={80} />
                      </Field>
                      <Field label="Ponto de referência (opcional)">
                        <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
                      </Field>
                    </>
                  ) : null}
                  <p className="text-xs text-slate-500">
                    Entregamos só em Maringá-PR.{knownFee === null ? " A taxa aparece no pagamento." : ""}
                  </p>
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

              {prefill.needsProfile ? (
                <section className={cardClass}>
                  <h2 className="font-bold">Seu cadastro</h2>
                  {askName ? (
                    <Field label="Nome completo">
                      <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
                    </Field>
                  ) : null}
                  {askDocument ? (
                    <Field label="CPF">
                      <input
                        className={inputClass}
                        value={cpf}
                        onChange={(e) => setCpf(formatDocument(e.target.value).slice(0, 14))}
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="000.000.000-00"
                      />
                    </Field>
                  ) : null}
                  <p className="text-xs text-slate-500">Só na primeira vez: da próxima, seu pedido já vai preenchido.</p>
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
                  <QrCode className="h-4 w-4" strokeWidth={1.75} />
                  <h2 className="font-bold">Pagar online</h2>
                </div>
                <div className="space-y-2.5">
                  {payOption("PIX", <QrCode className="h-5 w-5" strokeWidth={1.75} />, "PIX", "Aprovação na hora")}
                  {payOption(
                    "CREDIT_CARD",
                    <CreditCard className="h-5 w-5" strokeWidth={1.75} />,
                    "Cartão de crédito",
                    "Você informa os dados na próxima tela",
                  )}
                </div>
                <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                  Seu pedido vai para a cozinha assim que o pagamento for confirmado. Você ainda pode trocar a forma na tela de pagamento.
                </p>
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
                    </div>
                    <button type="button" onClick={() => setStep(1)} className="shrink-0 text-xs font-semibold underline underline-offset-2">
                      Alterar
                    </button>
                  </div>
                  <div className="flex items-start justify-between gap-3 border-t border-slate-100 pt-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pagamento</p>
                      <p className="font-medium">{pay === "PIX" ? "PIX" : "Cartão de crédito (online)"}</p>
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
              {phase === "sending" ? "Enviando pedido..." : step === 3 ? "Seguir para o pagamento" : primaryLabel}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
