"use client";

import { Loader2, MessageCircle, Stamp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { saveCustomerName } from "@/actions/storefront";
import { Input } from "@/components/ui/input";
import { formatPhone } from "@/lib/utils";

import { saveCustomer } from "./use-customer";

type Step = "phone" | "send" | "name";

const POLL_MS = 3000;
const digitsOf = (value: string) => value.replace(/\D/g, "");

const inputClass =
  "h-12 rounded-xl border-slate-300 bg-white text-base text-slate-900 placeholder:text-slate-400 focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/30";

type CheckResponse = {
  status?: "pending" | "verified";
  error?: string;
  needsName?: boolean;
  name?: string;
  phone?: string;
};

/**
 * Login sem senha pelo fluxo invertido: o cliente envia o código ao WhatsApp da loja (wa.me).
 * `initialPhone` + `startAtName`: cliente já autenticado (cookie) que ainda não informou o nome.
 */
export function PhoneLookup({
  startAtName = false,
  initialPhone = "",
}: {
  startAtName?: boolean;
  initialPhone?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(startAtName ? "name" : "phone");
  const [phone, setPhone] = useState(initialPhone ? formatPhone(initialPhone) : "");
  const [code, setCode] = useState("");
  const [waUrl, setWaUrl] = useState("");
  const [sandbox, setSandbox] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const checking = useRef(false);

  const finish = useCallback(
    (data: CheckResponse) => {
      if (data.needsName) {
        saveCustomer({ phone: data.phone });
        setStep("name");
        return;
      }
      saveCustomer({ phone: data.phone, name: data.name });
      router.refresh();
    },
    [router],
  );

  /** Consulta o servidor; `confirm` só é aceito em modo sandbox. */
  const check = useCallback(
    async (confirm = false): Promise<void> => {
      if (checking.current) return;
      checking.current = true;
      try {
        const res = await fetch("/api/auth/whatsapp/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, code, confirm }),
        });
        const data = (await res.json().catch(() => ({}))) as CheckResponse;
        if (!res.ok) {
          setError(data.error ?? "Não foi possível verificar agora.");
          if (res.status === 410) setStep("phone"); // expirado: recomeça
          return;
        }
        if (data.status === "verified") finish(data);
        else if (confirm) setError("Ainda não recebemos sua mensagem. Envie o código no WhatsApp e tente de novo.");
      } catch {
        /* Falha de rede no polling: tenta de novo no próximo ciclo. */
        if (confirm) setError("Sem conexão. Tente novamente.");
      } finally {
        checking.current = false;
      }
    },
    [phone, code, finish],
  );

  /* Polling leve enquanto o cliente está no WhatsApp. */
  useEffect(() => {
    if (step !== "send") return;
    const id = setInterval(() => void check(false), POLL_MS);
    return () => clearInterval(id);
  }, [step, check]);

  async function handlePhoneSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (digitsOf(phone).length < 10) {
      setError("Informe o WhatsApp com DDD.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/whatsapp/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        waUrl?: string;
        mode?: string;
      };
      if (!res.ok || !data.code || !data.waUrl) {
        setError(data.error ?? "Não foi possível gerar o código.");
        return;
      }
      setCode(data.code);
      setWaUrl(data.waUrl);
      setSandbox(data.mode === "sandbox");
      setStep("send");
    } catch {
      setError("Sem conexão. Verifique sua internet e tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function handleNameSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (name.trim().length < 2) {
      setError("Informe como podemos te chamar.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await saveCustomerName({ name });
      if (!result.ok) {
        const fieldMessage = Object.values(result.fieldErrors ?? {}).flat().filter(Boolean)[0];
        setError(fieldMessage ?? result.error);
        return;
      }
      saveCustomer({ name: result.data.name });
      router.refresh();
    } catch {
      setError("Não foi possível concluir agora. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  const submitClass =
    "relative flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#F59E0B] text-base font-bold text-[#0A2540] transition hover:brightness-105 disabled:opacity-60";

  return (
    <div className="relative space-y-4 overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <Stamp
        aria-hidden="true"
        className="pointer-events-none absolute -right-2 -top-2 h-20 w-20 rotate-12 text-slate-200"
        strokeWidth={1.25}
      />

      <div className="relative">
        <h2 className="text-lg font-extrabold text-[#0A2540]">
          {step === "name" ? "Quase lá!" : "Meu Passaporte"}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {step === "phone" && "Valide seu WhatsApp para abrir seu passaporte."}
          {step === "send" && `Envie o código abaixo para a gente pelo WhatsApp (${phone}).`}
          {step === "name" && "É seu primeiro acesso. Falta só o seu nome."}
        </p>
      </div>

      <div key={step} className="animate-in fade-in slide-in-from-right-2 duration-300">
        {step === "phone" ? (
          <form onSubmit={handlePhoneSubmit} className="relative space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">WhatsApp</span>
              <Input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="(99) 99999-9999"
                required
                className={inputClass}
              />
            </label>
            <button type="submit" disabled={busy} className={submitClass}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continuar com WhatsApp
            </button>
          </form>
        ) : null}

        {step === "send" ? (
          <div className="relative space-y-4">
            <div className="rounded-xl border-2 border-dashed border-[#F59E0B] bg-amber-50 py-4 text-center">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Seu código de embarque
              </p>
              <p className="mt-1 select-all text-3xl font-extrabold tracking-widest text-[#0A2540]">
                {code}
              </p>
            </div>

            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] text-base font-bold text-white transition hover:brightness-105"
            >
              <MessageCircle className="h-5 w-5" />
              Abrir WhatsApp e Enviar Código
            </a>

            <p className="flex items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Aguardando sua mensagem…
            </p>

            {sandbox ? (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  void check(true);
                }}
                className="h-11 w-full rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Já enviei a mensagem
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => {
                setStep("phone");
                setError(null);
              }}
              className="block w-full text-center text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
            >
              Alterar número
            </button>
          </div>
        ) : null}

        {step === "name" ? (
          <form onSubmit={handleNameSubmit} className="relative space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Como podemos te chamar?</span>
              <Input
                type="text"
                autoComplete="given-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome"
                maxLength={80}
                className={inputClass}
              />
            </label>
            <button type="submit" disabled={busy} className={submitClass}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Abrir meu passaporte
            </button>
          </form>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="relative rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
