"use client";

import { Loader2, UserPlus, Users } from "lucide-react";
import { useCallback, useState } from "react";

import { createTeamMember, setTeamMemberActive, type AdminTeamMember } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { Toast, type ToastState } from "./toast";
import { useRunAction } from "./use-run-action";

const inputCls = "border-slate-300 bg-white text-slate-900";

const ROLE_LABELS = { OWNER: "Sócio / Proprietário", KITCHEN: "Cozinha" } as const;

function MemberRow({
  member,
  isSelf,
  onToast,
}: {
  member: AdminTeamMember;
  isSelf: boolean;
  onToast: (t: ToastState) => void;
}) {
  const { run, isPending } = useRunAction();

  function toggle(isActive: boolean) {
    // Erros (ex.: último proprietário) chegam como toast pelo resultado da ação.
    run(
      async () => {
        const result = await setTeamMemberActive({ id: member.id, isActive });
        if (!result.ok) onToast({ kind: "error", message: result.error });
        else onToast({ kind: "success", message: isActive ? "Acesso ativado." : "Acesso desativado." });
        return result;
      },
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900">
          {member.name} {isSelf ? <span className="text-xs font-normal text-slate-400">(você)</span> : null}
        </p>
        <p className="truncate text-xs text-slate-500">{member.email}</p>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            member.role === "OWNER" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"
          }`}
        >
          {ROLE_LABELS[member.role]}
        </span>
        <Switch
          aria-label={`Acesso de ${member.name}`}
          checked={member.isActive}
          disabled={isPending || isSelf}
          onCheckedChange={toggle}
        />
      </div>
    </li>
  );
}

export function TeamManager({ members, currentUserId }: { members: AdminTeamMember[]; currentUserId: string }) {
  const { run, isPending, error, setError } = useRunAction();
  const [toast, setToast] = useState<ToastState>(null);
  const dismiss = useCallback(() => setToast(null), []);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"KITCHEN" | "OWNER">("KITCHEN");

  function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    run(
      () => createTeamMember({ name, email, password, role }),
      () => {
        setName("");
        setEmail("");
        setPassword("");
        setRole("KITCHEN");
        setToast({ kind: "success", message: "Usuário cadastrado." });
      },
    );
  }

  return (
    <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <Toast toast={toast} onDismiss={dismiss} />
      <div>
        <h2 className="flex items-center gap-2 font-bold text-slate-900">
          <Users className="h-5 w-5 text-slate-400" /> Equipe &amp; Permissões
        </h2>
        <p className="text-xs text-slate-500">
          Cozinha opera apenas os pedidos. Sócios têm acesso total. Desativar bloqueia o login na hora.
        </p>
      </div>

      <ul className="divide-y divide-slate-100">
        {members.map((m) => (
          <MemberRow key={`${m.id}-${m.isActive}`} member={m} isSelf={m.id === currentUserId} onToast={setToast} />
        ))}
      </ul>

      <form onSubmit={handleCreate} className="space-y-4 rounded-xl bg-slate-50 p-4">
        <h3 className="text-sm font-bold text-slate-900">Novo usuário</h3>
        <fieldset disabled={isPending} className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome">
            <Input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </Field>
          <Field label="E-mail">
            <Input
              className={inputCls}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="off"
            />
          </Field>
          <Field label="Senha (mín. 8 caracteres)">
            <Input
              className={inputCls}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              maxLength={100}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Perfil">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "KITCHEN" | "OWNER")}
              className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            >
              <option value="KITCHEN">Cozinha (KITCHEN)</option>
              <option value="OWNER">Sócio (OWNER)</option>
            </select>
          </Field>
        </fieldset>
        {error ? (
          <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600" onClick={() => setError(null)}>
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          Cadastrar usuário
        </Button>
      </form>
    </section>
  );
}
