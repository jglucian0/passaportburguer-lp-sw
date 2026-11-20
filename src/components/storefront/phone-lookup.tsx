"use client";

import { Loader2, MessageCircle, Stamp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { documentError, formatDocument, onlyDigits } from "@/core/validation/document";
import { formatPhone } from "@/lib/utils";

import { TURNSTILE_ENABLED, TurnstileWidget } from "./turnstile-widget";
import { saveCustomer } from "./use-customer";

type Step = "starting" | "phone" | "profile" | "send" | "register";

const POLL_MS = 3000;
const PENDING_OTP_KEY = "pb_pending_otp";

type Delivery = "inbound" | "window" | "template";

/** "inbound": o código aparece aqui e o cliente o envia. "window"/"template": o código chega no WhatsApp e o cliente o digita (code fica vazio). */
type PendingOtp = {
  phone: string;
  code: string;
  expiresAt: number;
  returnTo: string;
  waUrl: string;
  sandbox: boolean;
  delivery: Delivery;
  /** Quando o botão "Reenviar" libera (epoch ms). */
  resendAt?: number;
};

/** Código digitado: 6 dígitos (aceita espaço/traço, ex.: "123 456"). Devolve "" se incompleto. */
function toFullCode(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 6 ? digits : "";
}

function readPendingOtp(): PendingOtp | null {
  try {
    const raw = window.localStorage.getItem(PENDING_OTP_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PendingOtp>;
    if (
      typeof p.phone === "string" &&
      typeof p.code === "string" &&
      typeof p.waUrl === "string" &&
      typeof p.expiresAt === "number" &&
      Date.now() < p.expiresAt
    ) {
      return { returnTo: "", sandbox: false, delivery: "inbound", ...p } as PendingOtp;
    }
    window.localStorage.removeItem(PENDING_OTP_KEY);
  } catch {
    /* armazenamento indisponível */
  }
  return null;
}

function writePendingOtp(value: PendingOtp): void {
  try {
    window.localStorage.setItem(PENDING_OTP_KEY, JSON.stringify(value));
  } catch {
    /* ignorar */
  }
}

function clearPendingOtp(): void {
  try {
    window.localStorage.removeItem(PENDING_OTP_KEY);
  } catch {
    /* ignorar */
  }
}

const digitsOf = (value: string) => value.replace(/\D/g, "");

const inputClass =
  "h-12 rounded-xl border-slate-300 bg-white text-base text-slate-900 placeholder:text-slate-400 focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/30";

type CheckResponse = {
  status?: "pending" | "verified";
  error?: string;
  phone?: string;
  name?: string;
  /** Nome ou CPF ainda não cadastrados. */
  needsRegistration?: boolean;
};

type Identity = { error?: string; name?: string; phone?: string };

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

/**
 * Entrada no Meu Passaporte, sem senha: número novo informa nome + CPF e valida o WhatsApp por código;
 * cliente conhecido só valida o número a cada acesso. `startAtRegister`: cliente já validado (cookie)
 * que ainda não tem nome/CPF cadastrados.
 */
export function PhoneLookup({
  startAtRegister = false,
  initialPhone = "",
  autoStart,
  onAuthenticated,
  embedded = false,
}: {
  startAtRegister?: boolean;
  initialPhone?: string;
  /** Checkout: nome, WhatsApp e CPF já digitados; vai direto ao código (sem repetir perguntas). */
  autoStart?: { phone: string; name: string; cpf: string };
  /** Chamado quando o número foi validado e a sessão existe (no lugar de recarregar a página). */
  onAuthenticated?: () => void;
  /** Sem o cartão/borda próprios (já está dentro de um modal). */
  embedded?: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(autoStart ? "starting" : startAtRegister ? "register" : "phone");
  const [phone, setPhone] = useState(autoStart ? formatPhone(autoStart.phone) : initialPhone ? formatPhone(initialPhone) : "");
  const [code, setCode] = useState("");
  const [waUrl, setWaUrl] = useState("");
  const [delivery, setDelivery] = useState<Delivery>("inbound");
  const [typedCode, setTypedCode] = useState("");
  const [sandbox, setSandbox] = useState(false);
  const [name, setName] = useState(autoStart?.name ?? "");
  const [cpf, setCpf] = useState(autoStart?.cpf ?? "");
  const autoStarted = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const checking = useRef(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [tick, setTick] = useState(() => Date.now());

  /* Contagem regressiva do cooldown de reenvio (só enquanto há algo a contar). */
  useEffect(() => {
    if (step !== "send" || Date.now() >= resendAt) return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [step, resendAt]);
  const resendSeconds = Math.max(0, Math.ceil((resendAt - tick) / 1000));

  /* Restaura o fluxo OTP se o navegador descartou/recarregou a aba ao ir para o WhatsApp. */
  useEffect(() => {
    if (startAtRegister || autoStart) return;
    const pending = readPendingOtp();
    if (!pending) return;
    setPhone(formatPhone(pending.phone));
    setCode(pending.code);
    setWaUrl(pending.waUrl);
    setDelivery(pending.delivery);
    setResendAt(pending.resendAt ?? 0);
    setSandbox(pending.sandbox);
    setStep("send");
  }, [startAtRegister, autoStart]);

  const goTo = (next: Step) => {
    if (next === "phone") clearPendingOtp();
    setStep(next);
    setError(null);
    setNotice(null);
  };

  const enter = useCallback(
    (data: Identity) => {
      clearPendingOtp();
      saveCustomer({ phone: data.phone, name: data.name });
      if (onAuthenticated) onAuthenticated();
      else router.refresh();
    },
    [router, onAuthenticated],
  );

  /** Consulta o servidor; `confirm` só é aceito em modo sandbox. */
  const check = useCallback(
    async (confirm = false): Promise<void> => {
      if (checking.current) return;
      checking.current = true;
      try {
        const { ok, status, data } = await postJson<CheckResponse>("/api/auth/whatsapp/check", {
          phone,
          code: delivery === "inbound" ? code : toFullCode(typedCode),
          confirm,
        });
        if (!ok) {
          setError(data.error ?? "Não foi possível verificar agora.");
          if (status === 410 || status === 429) {
            clearPendingOtp();
            setStep("phone"); // expirado ou tentativas esgotadas: recomeça
          }
          return;
        }
        if (data.status === "verified") {
          clearPendingOtp(); // código consumido no servidor
          saveCustomer({ phone: data.phone });
          setError(null);
          /* Número validado: grava nome + CPF já digitados (se o navegador perdeu os dados, pede de novo). */
          if (data.needsRegistration) {
            if (name.trim().length >= 2 && !documentError(cpf) && onlyDigits(cpf).length === 11) {
              const res = await postJson<Identity>("/api/auth/register", { name, document: cpf });
              if (res.ok) return enter(res.data);
            }
            if (data.name) setName(data.name);
            setStep("register");
          } else {
            enter({ name: data.name, phone: data.phone });
          }
        } else if (confirm) {
          setError("Ainda não recebemos sua mensagem. Envie o código no WhatsApp e tente de novo.");
        }
      } catch {
        /* Falha de rede no polling: tenta de novo no próximo ciclo. */
        if (confirm) setError("Sem conexão. Tente novamente.");
      } finally {
        checking.current = false;
      }
    },
    [phone, code, delivery, typedCode, name, cpf, enter],
  );

  /* Polling leve enquanto o cliente está no WhatsApp. */
  useEffect(() => {
    if (step !== "send" || delivery !== "inbound") return;
    void check(false); // checagem imediata (ex.: aba restaurada após o WhatsApp)
    const id = setInterval(() => void check(false), POLL_MS);
    const onReturn = () => {
      if (document.visibilityState === "visible") void check(false);
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [step, delivery, check]);

  /** Envolve um envio de formulário: bloqueia duplo clique e trata falha de rede. */
  async function run(event: React.FormEvent, task: () => Promise<void>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch {
      setError("Sem conexão. Verifique sua internet e tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  /** Pede o código de validação do número (WhatsApp). */
  async function startOtp(resend = false): Promise<void> {
    if (TURNSTILE_ENABLED && !turnstileToken) {
      setError("Aguarde a verificação de segurança e tente de novo.");
      return;
    }
    const init = await postJson<{
      error?: string;
      retryAfterSeconds?: number;
      code?: string;
      waUrl?: string;
      delivery?: Delivery;
      mode?: string;
      expiresAt?: number;
      expiresIn?: number;
      resendAt?: number;
    }>("/api/auth/whatsapp/init", { phone, ...(turnstileToken ? { turnstileToken } : {}), ...(resend ? { resend: true } : {}) });
    /* O token do Turnstile vale uma verificação só: gera outro para a próxima chamada. */
    setTurnstileKey((k) => k + 1);
    if (init.data.retryAfterSeconds) setResendAt(Date.now() + init.data.retryAfterSeconds * 1000);
    const mode: Delivery = init.data.delivery ?? "inbound";
    const missing = mode === "inbound" ? !init.data.code || !init.data.waUrl : mode === "window" && !init.data.waUrl;
    if (!init.ok || missing) {
      setError(init.data.error ?? "Não foi possível gerar o código.");
      return;
    }
    setCode(init.data.code ?? "");
    setWaUrl(init.data.waUrl ?? "");
    setDelivery(mode);
    setTypedCode("");
    setError(null);
    const nextResendAt = init.data.resendAt ?? 0;
    setResendAt(nextResendAt);
    setTick(Date.now());
    const isSandbox = init.data.mode === "sandbox";
    setSandbox(isSandbox);
    writePendingOtp({
      phone: digitsOf(phone),
      code: init.data.code ?? "",
      waUrl: init.data.waUrl ?? "",
      delivery: mode,
      sandbox: isSandbox,
      resendAt: nextResendAt,
      expiresAt: init.data.expiresAt ?? Date.now() + (init.data.expiresIn ?? 300) * 1000,
      returnTo: window.location.pathname,
    });
    setStep("send");
  }

  /* Checkout: dados já digitados; assim que o desafio anti-bot (se houver) libera, pede o código sem perguntar nada de novo. */
  useEffect(() => {
    if (!autoStart || step !== "starting" || autoStarted.current) return;
    if (TURNSTILE_ENABLED && !turnstileToken) return;
    autoStarted.current = true;
    setBusy(true);
    void (async () => {
      try {
        const account = await postJson<{ error?: string }>("/api/auth/check-account", { phone });
        if (!account.ok) {
          setError(account.data.error ?? "Não foi possível continuar.");
          setStep("phone");
          return;
        }
        await startOtp();
        /* startOtp já foi para "send" em caso de sucesso; se falhou, deixa o cliente corrigir o número. */
        setStep((s) => (s === "starting" ? "phone" : s));
      } catch {
        setError("Sem conexão. Verifique sua internet e tente novamente.");
        setStep("phone");
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, step, turnstileToken]);

  /** Sem senha: número novo/cadastro incompleto informa nome + CPF antes do código; os demais vão direto ao código. */
  const handlePhoneSubmit = (event: React.FormEvent) =>
    run(event, async () => {
      if (digitsOf(phone).length < 10) {
        setError("Informe o WhatsApp com DDD.");
        return;
      }
      const account = await postJson<{ needsProfile?: boolean; error?: string }>("/api/auth/check-account", { phone });
      if (!account.ok) {
        setError(account.data.error ?? "Não foi possível continuar.");
        return;
      }
      if (account.data.needsProfile) {
        setStep("profile");
        return;
      }
      await startOtp();
    });

  /** Valida nome + CPF no aparelho e segue para o código (nada é salvo antes de o número ser validado). */
  const handleProfileSubmit = (event: React.FormEvent) =>
    run(event, async () => {
      const docErr = documentError(cpf);
      if (name.trim().length < 2) return setError("Informe seu nome.");
      if (docErr || onlyDigits(cpf).length !== 11) return setError(docErr ?? "Informe um CPF válido.");
      await startOtp();
    });

  /** Cadastro pós-validação (cliente já validado que ainda não tem nome/CPF). */
  const handleRegister = (event: React.FormEvent) =>
    run(event, async () => {
      const docErr = documentError(cpf);
      if (name.trim().length < 2) return setError("Informe seu nome.");
      if (docErr || onlyDigits(cpf).length !== 11) return setError(docErr ?? "Informe um CPF válido.");
      const res = await postJson<Identity>("/api/auth/register", { name, document: cpf });
      if (!res.ok) {
        setError(res.data.error ?? "Não foi possível concluir o cadastro.");
        return;
      }
      enter(res.data);
    });

  const submitClass =
    "relative flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#F59E0B] text-base font-bold text-[#0A2540] transition hover:brightness-105 disabled:opacity-60";
  const linkClass =
    "block w-full text-center text-sm font-medium text-slate-600 underline-offset-2 hover:underline";

  const submitLabel = (label: string) => (
    <>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {label}
    </>
  );

  const field = (label: string, input: React.ReactNode) => (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {input}
    </label>
  );

  const titles: Record<Step, string> = {
    starting: "Confirme seu WhatsApp",
    phone: "Meu Passaporte",
    profile: "Primeira vez por aqui?",
    send: "Confirme seu WhatsApp",
    register: "Quase lá!",
  };
  const subtitles: Record<Step, string> = {
    starting: `Vamos confirmar o número ${phone} para finalizar seu pedido.`,
    phone: "Informe seu WhatsApp para abrir seu passaporte. Sem senha: você só confirma o número.",
    profile: "Só nome e CPF. Depois confirmamos seu número por código no WhatsApp.",
    send: `Vamos confirmar o número ${phone}.`,
    register: "WhatsApp confirmado! Falta só seu nome e CPF para abrir o passaporte.",
  };

  return (
    <div
      className={
        embedded
          ? "relative space-y-4 p-6 pt-8"
          : "relative space-y-4 overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      }
    >
      {embedded ? null : (
        <Stamp
          aria-hidden="true"
          className="pointer-events-none absolute -right-2 -top-2 h-20 w-20 rotate-12 text-slate-200"
          strokeWidth={1.25}
        />
      )}

      <div className="relative">
        <h2 className="text-lg font-extrabold text-[#0A2540]">{titles[step]}</h2>
        <p className="mt-1 text-sm text-slate-500">{subtitles[step]}</p>
      </div>

      <div key={step} className="animate-in fade-in slide-in-from-right-2 duration-300">
        {step === "starting" ? (
          <p className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" /> Enviando o código…
          </p>
        ) : null}

        {step === "phone" ? (
          <form onSubmit={handlePhoneSubmit} className="relative space-y-4">
            {field(
              "WhatsApp",
              <Input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="(XX) XXXXX-XXXX"
                required
                className={inputClass}
              />,
            )}
            <p className="-mt-2 text-xs text-slate-500">
              Use o WhatsApp deste aparelho — você enviará um código por ele para confirmar.
            </p>
            <button type="submit" disabled={busy} className={submitClass}>
              {submitLabel("Continuar")}
            </button>
          </form>
        ) : null}

        {step === "profile" ? (
          <form onSubmit={handleProfileSubmit} className="relative space-y-4">
            {field(
              "Nome",
              <Input
                type="text"
                autoComplete="given-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome"
                maxLength={80}
                required
                className={inputClass}
              />,
            )}
            {field(
              "CPF",
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={cpf}
                onChange={(e) => setCpf(formatDocument(e.target.value).slice(0, 14))}
                placeholder="000.000.000-00"
                required
                className={inputClass}
              />,
            )}
            <button type="submit" disabled={busy} className={submitClass}>
              {submitLabel("Continuar")}
            </button>
            <button type="button" onClick={() => goTo("phone")} className={linkClass}>
              Alterar número
            </button>
          </form>
        ) : null}

        {step === "send" && delivery !== "inbound" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!toFullCode(typedCode)) return setError("Digite os 6 dígitos do código.");
              setError(null);
              void check(false);
            }}
            className="relative space-y-4"
          >
            {delivery === "window" ? (
              <>
                <p className="text-center text-sm text-slate-600">
                  1. Abra o WhatsApp e envie a mensagem que já vem pronta. Respondemos na hora com o seu código.
                </p>
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-12 w-full items-center justify-center gap-2 cursor-pointer rounded-xl bg-[#22bb5a] text-base font-bold text-white shadow-lg shadow-green-600/30 transition hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0 active:brightness-95"
                >
                  <MessageCircle className="h-5 w-5" />
                  Receber código no WhatsApp
                </a>
                <p className="text-center text-sm text-slate-600">2. Volte aqui e digite o código recebido.</p>
              </>
            ) : (
              <p className="text-center text-sm text-slate-600">
                Enviamos um código para o seu WhatsApp ({phone}). Digite-o abaixo.
              </p>
            )}
            {field(
              "Código de 6 dígitos",
              <Input
                value={typedCode}
                onChange={(e) => setTypedCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                autoComplete="one-time-code"
                placeholder="000000"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                className={`${inputClass} text-center text-xl font-bold tracking-widest`}
              />,
            )}
            <button type="submit" disabled={!toFullCode(typedCode)} className={submitClass}>
              {submitLabel("Confirmar código")}
            </button>
            <button
              type="button"
              disabled={busy || resendSeconds > 0 || (TURNSTILE_ENABLED && !turnstileToken)}
              onClick={() => {
                setBusy(true);
                setError(null);
                void startOtp(true)
                  .catch(() => setError("Sem conexão. Tente novamente."))
                  .finally(() => setBusy(false));
              }}
              className="h-11 w-full rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {resendSeconds > 0 ? `Reenviar código em ${resendSeconds}s` : "Reenviar código"}
            </button>
            <button type="button" onClick={() => goTo("phone")} className={linkClass}>
              Alterar número
            </button>
          </form>
        ) : null}

        {step === "send" && delivery === "inbound" ? (
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
              className="flex h-12 w-full items-center justify-center gap-2 cursor-pointer rounded-xl bg-[#22bb5a] text-base font-bold text-white shadow-lg shadow-green-600/30 transition hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0 active:brightness-95"
            >
              <MessageCircle className="h-5 w-5" />
              Clique aqui para abrir o WhatsApp
            </a>

            <p className="flex items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Aguardando sua mensagem…
            </p>
            <p className="-mt-2 text-center text-xs text-slate-500">
              Envie a mensagem usando o número {phone}.
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

            <button type="button" onClick={() => goTo("phone")} className={linkClass}>
              Alterar número
            </button>
          </div>
        ) : null}

        {step === "register" ? (
          <form onSubmit={handleRegister} className="relative space-y-4">
            {field(
              "Nome",
              <Input
                type="text"
                autoComplete="given-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome"
                maxLength={80}
                required
                className={inputClass}
              />,
            )}
            {field(
              "CPF",
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={cpf}
                onChange={(e) => setCpf(formatDocument(e.target.value).slice(0, 14))}
                placeholder="000.000.000-00"
                required
                className={inputClass}
              />,
            )}
            <button type="submit" disabled={busy} className={submitClass}>
              {submitLabel("Abrir meu passaporte")}
            </button>
          </form>
        ) : null}
      </div>

      {TURNSTILE_ENABLED && (step === "starting" || step === "phone" || step === "profile" || (step === "send" && delivery !== "inbound")) ? (
        <TurnstileWidget onToken={setTurnstileToken} resetKey={turnstileKey} />
      ) : null}

      {notice ? (
        <p className="relative rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}
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
