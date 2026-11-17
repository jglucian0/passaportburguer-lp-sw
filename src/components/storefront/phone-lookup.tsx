"use client";

import { Loader2, MessageCircle, Stamp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { formatPhone } from "@/lib/utils";

import { saveCustomer } from "./use-customer";

type Step = "phone" | "password" | "send" | "register" | "forgot" | "reset";

const POLL_MS = 3000;
const digitsOf = (value: string) => value.replace(/\D/g, "");

const inputClass =
  "h-12 rounded-xl border-slate-300 bg-white text-base text-slate-900 placeholder:text-slate-400 focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/30";

type CheckResponse = {
  status?: "pending" | "verified";
  error?: string;
  phone?: string;
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
 * Entrada no Meu Passaporte: conta verificada entra só com senha; número novo valida o WhatsApp
 * uma única vez (código wa.me) e conclui o cadastro. Esqueci a senha: código de 6 dígitos por e-mail.
 * `startAtRegister`: cliente já validado (cookie) que ainda não concluiu o cadastro.
 */
export function PhoneLookup({
  startAtRegister = false,
  initialPhone = "",
}: {
  startAtRegister?: boolean;
  initialPhone?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(startAtRegister ? "register" : "phone");
  const [phone, setPhone] = useState(initialPhone ? formatPhone(initialPhone) : "");
  const [code, setCode] = useState("");
  const [waUrl, setWaUrl] = useState("");
  const [sandbox, setSandbox] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const checking = useRef(false);

  const goTo = (next: Step) => {
    setStep(next);
    setError(null);
    setNotice(null);
  };

  const enter = useCallback(
    (data: Identity) => {
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
        const { ok, status, data } = await postJson<CheckResponse>("/api/auth/whatsapp/check", {
          phone,
          code,
          confirm,
        });
        if (!ok) {
          setError(data.error ?? "Não foi possível verificar agora.");
          if (status === 410) setStep("phone"); // expirado: recomeça
          if (status === 409) setStep("password"); // conta já verificada: só senha
          return;
        }
        if (data.status === "verified") {
          saveCustomer({ phone: data.phone });
          setError(null);
          setStep("register");
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
    [phone, code],
  );

  /* Polling leve enquanto o cliente está no WhatsApp. */
  useEffect(() => {
    if (step !== "send") return;
    const id = setInterval(() => void check(false), POLL_MS);
    return () => clearInterval(id);
  }, [step, check]);

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

  const handlePhoneSubmit = (event: React.FormEvent) =>
    run(event, async () => {
      if (digitsOf(phone).length < 10) {
        setError("Informe o WhatsApp com DDD.");
        return;
      }
      const account = await postJson<{ flow?: string; error?: string }>("/api/auth/check-account", { phone });
      if (!account.ok) {
        setError(account.data.error ?? "Não foi possível continuar.");
        return;
      }
      if (account.data.flow === "password") {
        setPassword("");
        setStep("password");
        return;
      }

      const init = await postJson<{ error?: string; code?: string; waUrl?: string; mode?: string }>(
        "/api/auth/whatsapp/init",
        { phone },
      );
      if (init.status === 409) {
        setStep("password");
        return;
      }
      if (!init.ok || !init.data.code || !init.data.waUrl) {
        setError(init.data.error ?? "Não foi possível gerar o código.");
        return;
      }
      setCode(init.data.code);
      setWaUrl(init.data.waUrl);
      setSandbox(init.data.mode === "sandbox");
      setStep("send");
    });

  const handleLogin = (event: React.FormEvent) =>
    run(event, async () => {
      const res = await postJson<Identity>("/api/auth/login", { phone, password });
      if (!res.ok) {
        setError(res.data.error ?? "Não foi possível entrar.");
        return;
      }
      enter(res.data);
    });

  const handleRegister = (event: React.FormEvent) =>
    run(event, async () => {
      if (name.trim().length < 2) return setError("Informe como podemos te chamar.");
      if (password.length < 6) return setError("A senha deve ter no mínimo 6 caracteres.");
      const res = await postJson<Identity>("/api/auth/register", { name, email, password });
      if (!res.ok) {
        setError(res.data.error ?? "Não foi possível concluir o cadastro.");
        return;
      }
      enter(res.data);
    });

  const handleForgot = (event: React.FormEvent) =>
    run(event, async () => {
      const res = await postJson<{ error?: string }>("/api/auth/recover/request", { phone });
      if (!res.ok) {
        setError(res.data.error ?? "Não foi possível enviar o código.");
        return;
      }
      setResetCode("");
      setPassword("");
      setStep("reset");
      setNotice("Se houver uma conta com e-mail cadastrado, enviamos um código de 6 dígitos.");
    });

  const handleReset = (event: React.FormEvent) =>
    run(event, async () => {
      if (password.length < 6) return setError("A senha deve ter no mínimo 6 caracteres.");
      const res = await postJson<Identity>("/api/auth/recover/reset", { phone, code: resetCode, password });
      if (!res.ok) {
        setError(res.data.error ?? "Não foi possível redefinir a senha.");
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
    phone: "Meu Passaporte",
    password: "Bem-vindo de volta!",
    send: "Meu Passaporte",
    register: "Quase lá!",
    forgot: "Recuperar senha",
    reset: "Nova senha",
  };
  const subtitles: Record<Step, string> = {
    phone: "Informe seu WhatsApp para abrir seu passaporte.",
    password: `Digite sua senha para entrar (${phone}).`,
    send: `Envie o código abaixo para a gente pelo WhatsApp (${phone}). Você só faz isso uma vez.`,
    register: "WhatsApp validado! Complete seu cadastro para abrir o passaporte.",
    forgot: "Enviaremos um código de 6 dígitos para o e-mail cadastrado.",
    reset: "Digite o código recebido por e-mail e escolha uma nova senha.",
  };

  return (
    <div className="relative space-y-4 overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <Stamp
        aria-hidden="true"
        className="pointer-events-none absolute -right-2 -top-2 h-20 w-20 rotate-12 text-slate-200"
        strokeWidth={1.25}
      />

      <div className="relative">
        <h2 className="text-lg font-extrabold text-[#0A2540]">{titles[step]}</h2>
        <p className="mt-1 text-sm text-slate-500">{subtitles[step]}</p>
      </div>

      <div key={step} className="animate-in fade-in slide-in-from-right-2 duration-300">
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
            <button type="submit" disabled={busy} className={submitClass}>
              {submitLabel("Continuar")}
            </button>
          </form>
        ) : null}

        {step === "password" ? (
          <form onSubmit={handleLogin} className="relative space-y-4">
            {field(
              "Senha",
              <Input
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className={inputClass}
              />,
            )}
            <button type="submit" disabled={busy} className={submitClass}>
              {submitLabel("Entrar")}
            </button>
            <button type="button" onClick={() => goTo("forgot")} className={linkClass}>
              Esqueci minha senha
            </button>
            <button type="button" onClick={() => goTo("phone")} className={linkClass}>
              Alterar número
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
              "E-mail (para recuperação de senha)",
              <Input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@email.com"
                maxLength={160}
                required
                className={inputClass}
              />,
            )}
            {field(
              "Criar senha",
              <Input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo de 6 caracteres"
                minLength={6}
                maxLength={72}
                required
                className={inputClass}
              />,
            )}
            <button type="submit" disabled={busy} className={submitClass}>
              {submitLabel("Abrir meu passaporte")}
            </button>
          </form>
        ) : null}

        {step === "forgot" ? (
          <form onSubmit={handleForgot} className="relative space-y-4">
            <button type="submit" disabled={busy} className={submitClass}>
              {submitLabel("Enviar código por e-mail")}
            </button>
            <button type="button" onClick={() => goTo("password")} className={linkClass}>
              Voltar
            </button>
          </form>
        ) : null}

        {step === "reset" ? (
          <form onSubmit={handleReset} className="relative space-y-4">
            {field(
              "Código de 6 dígitos",
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={resetCode}
                onChange={(e) => setResetCode(digitsOf(e.target.value).slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                required
                className={inputClass}
              />,
            )}
            {field(
              "Nova senha",
              <Input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo de 6 caracteres"
                minLength={6}
                maxLength={72}
                required
                className={inputClass}
              />,
            )}
            <button type="submit" disabled={busy} className={submitClass}>
              {submitLabel("Redefinir e entrar")}
            </button>
            <button type="button" onClick={() => goTo("password")} className={linkClass}>
              Voltar
            </button>
          </form>
        ) : null}
      </div>

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
