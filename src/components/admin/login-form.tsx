"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";

import { loginAdmin } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAdmin, null);

  return (
    <form action={formAction} className="w-full max-w-sm space-y-5 rounded-2xl border border-border bg-surface p-6">
      <div className="text-center">
        <h1 className="text-xl font-extrabold">
          Passaport<span className="text-brand">Admin</span>
        </h1>
        <p className="mt-1 text-sm text-muted">Acesse o painel da hamburgueria</p>
      </div>

      <Field label="E-mail" error={state?.fieldErrors?.email?.[0]}>
        <Input name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Senha" error={state?.fieldErrors?.password?.[0]}>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>

      {state && !state.fieldErrors ? (
        <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-400">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        Entrar
      </Button>
    </form>
  );
}
