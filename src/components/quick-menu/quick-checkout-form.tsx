"use client";

import { ArrowLeft, Check, Loader2, Lock } from "lucide-react";
import { useState, type FormEvent } from "react";

import { cn, formatCents } from "@/lib/utils";

export type CheckoutPrefill = {
  needsCredentials: boolean;
  name: string;
  email: string;
  addresses: { id: string; street: string; number: string; complement: string; reference: string }[];
  primaryFeeCents?: number | null;
};

export type SummaryLine = { key: string; text: string; detail?: string; totalCents: number };

const inputClass =
  "h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-[#0A2540] outline-none focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-semibold text-white/90">{label}</span>
      {children}
    </label>
  );
}

const NEW_ADDRESS = "new";

/**
 * 2ª etapa do Cardápio Rápido: entrega/retirada, endereço (com sugestão dos salvos) e, só para quem ainda não
 * tem conta, nome + e-mail + senha. Ao enviar, o servidor cria o pedido e devolve o link do pagamento.
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
  const [deliveryType, setDeliveryType] = useState<"DELIVERY" | "PICKUP">("DELIVERY");
  const [name, setName] = useState(prefill.name);
  const [email, setEmail] = useState(prefill.email);
  const [password, setPassword] = useState("");
  const [addressId, setAddressId] = useState<string>(prefill.addresses[0]?.id ?? NEW_ADDRESS);
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "sending" | "done">("idle");

  const [pickingAddress, setPickingAddress] = useState(false);
  const usingSaved = addressId !== NEW_ADDRESS;
  const selectedSaved = prefill.addresses.find((a) => a.id === addressId) ?? null;
  /* A taxa só é conhecida para o endereço pré-selecionado (o 1º salvo). */
  const knownFee =
    selectedSaved && selectedSaved.id === prefill.addresses[0]?.id ? (prefill.primaryFeeCents ?? null) : null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (phase !== "idle") return;
    if (prefill.needsCredentials) {
      if (name.trim().length < 2) return setError("Informe seu nome.");
      if (password.length < 8) return setError("A senha deve ter no mínimo 8 caracteres.");
    }
    if (deliveryType === "DELIVERY" && !usingSaved && (street.trim().length < 2 || !number.trim())) {
      return setError("Informe rua e número para a entrega.");
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
            deliveryType,
            ...(prefill.needsCredentials ? { name, email, password } : {}),
            ...(deliveryType === "DELIVERY"
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

  if (phase === "done") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#071329] p-8 text-center text-white">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
          <Check className="h-8 w-8" />
        </span>
        <p className="text-lg font-bold">Pedido anotado!</p>
        <p className="flex items-center gap-2 text-sm text-white/70">
          <Loader2 className="h-4 w-4 animate-spin" />
          Abrindo o pagamento...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#071329] pb-10">
      <header className="flex h-16 items-center justify-center border-b border-white/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo_passaporteburguer_nav.min.webp" alt="Passaporte Burguer" className="h-10 w-auto object-contain" />
      </header>

      <form onSubmit={onSubmit} className="mx-auto max-w-md space-y-4 px-4 pt-5">
        {onBack ? (
          <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm font-semibold text-white/70">
            <ArrowLeft className="h-4 w-4" /> Voltar ao cardápio
          </button>
        ) : null}

        <section className="space-y-2 rounded-xl bg-white p-4 text-[#0A2540]">
          <p className="text-sm font-bold">Seu pedido</p>
          <ul className="space-y-1 text-sm">
            {lines.map((l) => (
              <li key={l.key} className="flex justify-between gap-3">
                <span className="min-w-0">
                  {l.text}
                  {l.detail ? <span className="block truncate text-xs text-slate-500">{l.detail}</span> : null}
                </span>
                {l.totalCents > 0 ? <span className="shrink-0 font-semibold">{formatCents(l.totalCents)}</span> : null}
              </li>
            ))}
          </ul>
          {subtotalCents > 0 ? (
            <p className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold">
              <span>Subtotal</span>
              <span>{formatCents(subtotalCents)}</span>
            </p>
          ) : null}
        </section>

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Entrega ou retirada">
          {(
            [
              ["DELIVERY", "Entrega"],
              ["PICKUP", "Retirada"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={deliveryType === value}
              onClick={() => setDeliveryType(value)}
              className={cn(
                "h-12 rounded-xl border font-bold transition",
                deliveryType === value ? "border-[#F59E0B] bg-[#F59E0B] text-[#0A2540]" : "border-white/20 text-white",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {prefill.needsCredentials ? (
          <>
            <p className="pt-1 text-sm font-bold text-[#F59E0B]">Seu cadastro</p>
            <Field label="Nome completo">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} />
            </Field>
            <Field label="E-mail">
              <input
                className={inputClass}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                maxLength={160}
              />
            </Field>
            <Field label="Crie uma senha (mín. 8 caracteres)">
              <input
                className={inputClass}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={72}
              />
            </Field>
            <p className="-mt-2 text-xs text-white/60">Com e-mail e senha você também entra no site depois.</p>
          </>
        ) : null}

        {deliveryType === "DELIVERY" ? (
          <>
            <p className="pt-1 text-sm font-bold text-[#F59E0B]">Endereço de entrega</p>
            {selectedSaved && !pickingAddress ? (
              <div className="flex items-start gap-3 rounded-xl border border-[#F59E0B] bg-[#F59E0B]/10 px-3 py-3 text-white">
                <div className="min-w-0 flex-1 text-sm">
                  <span className="font-semibold">
                    {selectedSaved.street}, {selectedSaved.number}
                  </span>
                  {selectedSaved.complement ? (
                    <span className="block text-xs text-white/60">{selectedSaved.complement}</span>
                  ) : null}
                  {knownFee !== null ? (
                    <span className="mt-1 block text-xs text-white/80">Taxa de entrega: {formatCents(knownFee)}</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setPickingAddress(true)}
                  className="shrink-0 text-xs font-semibold text-[#F59E0B] underline underline-offset-2"
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
                    className={cn(
                      "w-full rounded-xl border px-3 py-3 text-left text-sm transition",
                      addressId === a.id ? "border-[#F59E0B] bg-[#F59E0B]/10 text-white" : "border-white/20 text-white/80",
                    )}
                  >
                    <span className="font-semibold">
                      {a.street}, {a.number}
                    </span>
                    {a.complement ? <span className="block text-xs text-white/60">{a.complement}</span> : null}
                  </button>
                ))}
                <button
                  type="button"
                  role="radio"
                  aria-checked={addressId === NEW_ADDRESS}
                  onClick={() => setAddressId(NEW_ADDRESS)}
                  className={cn(
                    "w-full rounded-xl border px-3 py-3 text-left text-sm font-semibold transition",
                    addressId === NEW_ADDRESS ? "border-[#F59E0B] bg-[#F59E0B]/10 text-white" : "border-white/20 text-white/80",
                  )}
                >
                  Entregar em outro endereço
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
            <p className="text-xs text-white/60">
              Entregamos só em Maringá-PR.{knownFee === null ? " A taxa aparece no pagamento." : ""}
            </p>
          </>
        ) : (
          <p className="rounded-xl bg-white/5 px-3 py-3 text-sm text-white/80">Você retira o pedido aqui na loja. Sem taxa de entrega.</p>
        )}

        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={phase === "sending"}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#F59E0B] font-bold text-[#0A2540] shadow-lg transition hover:brightness-105 disabled:opacity-60"
        >
          {phase === "sending" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Lock className="h-4 w-4" />}
          Seguir para o pagamento
        </button>
      </form>
    </div>
  );
}
