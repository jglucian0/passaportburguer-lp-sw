"use client";

import { BadgeCheck, Check, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { documentError, formatDocument, onlyDigits } from "@/core/validation/document";

type Prefill = {
  name: string;
  email: string;
  needsPassword: boolean;
  address: { street: string; number: string; complement: string; reference: string };
};

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

export function CompleteRegistrationForm({
  token,
  phoneLabel,
  prefill,
}: {
  token: string;
  phoneLabel: string;
  prefill: Prefill;
}) {
  const [name, setName] = useState(prefill.name);
  const [document, setDocument] = useState("");
  const [email, setEmail] = useState(prefill.email);
  const [password, setPassword] = useState("");
  const [street, setStreet] = useState(prefill.address.street);
  const [number, setNumber] = useState(prefill.address.number);
  const [complement, setComplement] = useState(prefill.address.complement);
  const [reference, setReference] = useState(prefill.address.reference);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "sending" | "done">("idle");
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (phase !== "idle") return;
    const docErr = documentError(document);
    if (docErr || onlyDigits(document).length !== 11) {
      setError(docErr ?? "Informe um CPF válido.");
      return;
    }
    if (prefill.needsPassword && password.length < 8) {
      setError("A senha deve ter no mínimo 8 caracteres.");
      return;
    }
    setError(null);
    setPhase("sending");
    try {
      const res = await fetch("/api/whatsapp/complete-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Sem telefone no corpo: a identidade é só o token.
        body: JSON.stringify({
          token,
          name,
          document,
          ...(prefill.needsPassword ? { email, password } : {}),
          street,
          number,
          complement: complement || undefined,
          reference: reference || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; redirectUrl: string }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !data || !data.ok) {
        setError((data && !data.ok && data.error) || "Não foi possível salvar. Tente novamente.");
        setPhase("idle");
        return;
      }
      setPhase("done");
      const url = data.redirectUrl;
      timer.current = window.setTimeout(() => {
        window.location.href = url;
      }, 1200);
    } catch {
      setError("Sem conexão. Tente novamente.");
      setPhase("idle");
    }
  }

  if (phase === "done") {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center text-white">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
          <Check className="h-8 w-8" />
        </span>
        <p className="text-lg font-bold">Cadastro salvo!</p>
        <p className="flex items-center gap-2 text-sm text-white/70">
          <Loader2 className="h-4 w-4 animate-spin" />
          Voltando para o WhatsApp...
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex items-center justify-between rounded-xl bg-emerald-500/10 px-4 py-3 text-sm">
        <span className="text-white/80">{phoneLabel}</span>
        <span className="flex items-center gap-1 font-semibold text-emerald-400">
          <BadgeCheck className="h-4 w-4" /> WhatsApp verificado
        </span>
      </div>

      <Field label="Nome completo">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} />
      </Field>
      <Field label="CPF">
        <input
          className={inputClass}
          value={document}
          onChange={(e) => setDocument(formatDocument(e.target.value).slice(0, 14))}
          inputMode="numeric"
          autoComplete="off"
          placeholder="000.000.000-00"
          required
        />
      </Field>

      {prefill.needsPassword ? (
        <>
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
        </>
      ) : null}

      <p className="pt-2 text-sm font-bold text-[#F59E0B]">Endereço padrão</p>
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <Field label="Rua">
          <input className={inputClass} value={street} onChange={(e) => setStreet(e.target.value)} autoComplete="street-address" required maxLength={120} />
        </Field>
        <Field label="Número">
          <input className={inputClass} value={number} onChange={(e) => setNumber(e.target.value)} required maxLength={20} />
        </Field>
      </div>
      <Field label="Complemento (opcional)">
        <input className={inputClass} value={complement} onChange={(e) => setComplement(e.target.value)} maxLength={80} />
      </Field>
      <Field label="Ponto de referência (opcional)">
        <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
      </Field>

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
        {phase === "sending" ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        Salvar e voltar ao WhatsApp
      </button>
    </form>
  );
}
