"use client";

import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import Image from "next/image";
import { useActionState, useState } from "react";

import { loginAdmin } from "@/actions/auth";

const inputClass =
  "h-12 w-full rounded-xl border border-slate-300 bg-white pl-11 text-base text-slate-900 placeholder:text-slate-400 focus:border-[#071329] focus:outline-none focus:ring-2 focus:ring-brand/60 disabled:opacity-60";

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAdmin, null);
  const [showPassword, setShowPassword] = useState(false);

  const emailError = state?.fieldErrors?.email?.[0];
  const passwordError = state?.fieldErrors?.password?.[0];
  const generalError = state && !state.fieldErrors ? state.error : null;
  const blocked = generalError ? /bloquead|muitas|tentativas/i.test(generalError) : false;

  return (
    <form action={formAction} className="w-full max-w-md space-y-6 rounded-2xl bg-white p-8 text-slate-900 shadow-2xl">
      <div className="flex flex-col items-center gap-3 text-center">
        {/* O logo é branco: assenta sobre uma placa navy dentro do card branco. */}
        <div className="rounded-xl bg-[#071329] px-5 py-3">
          <Image
            src="/logo_passaporteburguer_nav.webp"
            alt="Passaporte Burguer"
            width={168}
            height={45}
            priority
            className="h-10 w-auto"
          />
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-extrabold uppercase tracking-widest text-amber-800">
          Painel Operacional
        </span>
        <p className="text-sm text-slate-500">Acesse com seu usuário da loja.</p>
      </div>

      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-slate-700">E-mail</span>
          <span className="relative block">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus
              placeholder="voce@passaporteburguer.com.br"
              className={inputClass + " pr-3"}
              aria-invalid={emailError ? true : undefined}
            />
          </span>
          {emailError ? <span className="block text-xs font-medium text-red-600">{emailError}</span> : null}
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-slate-700">Senha</span>
          <span className="relative block">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              className={inputClass + " pr-28"}
              aria-invalid={passwordError ? true : undefined}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              className="absolute right-2 top-1/2 inline-flex h-8 -translate-y-1/2 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {showPassword ? "Ocultar senha" : "Mostrar senha"}
            </button>
          </span>
          {passwordError ? <span className="block text-xs font-medium text-red-600">{passwordError}</span> : null}
        </label>
      </div>

      {generalError ? (
        <div
          role="alert"
          className={
            "flex items-start gap-2 rounded-xl border p-3 text-sm font-medium " +
            (blocked ? "border-amber-300 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-700")
          }
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{generalError}</span>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand text-base font-extrabold text-[#071329] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#071329] disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        {isPending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
