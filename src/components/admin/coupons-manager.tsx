"use client";

import { Pause, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { deleteCoupon, saveCoupon, setCouponActive, type AdminCoupon } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { cn, formatCents } from "@/lib/utils";

import { reaisToCents } from "./money";
import { useRunAction } from "./use-run-action";

function discountLabel(c: AdminCoupon) {
  return c.type === "PERCENT" ? `${c.value}% off` : `${formatCents(c.value)} off`;
}

function CouponRow({ coupon }: { coupon: AdminCoupon }) {
  const { run, isPending, error } = useRunAction();
  const exhausted = coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses;

  return (
    <li className="space-y-1 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-2 py-0.5 font-mono text-sm font-bold">
              {coupon.code}
            </span>
            <span className="font-semibold text-emerald-700">{discountLabel(coupon)}</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            {coupon.minOrderCents > 0 ? `Pedido mín. ${formatCents(coupon.minOrderCents)}` : "Sem pedido mínimo"} •{" "}
            {coupon.usedCount}
            {coupon.maxUses !== null ? `/${coupon.maxUses}` : ""} uso(s)
            {exhausted ? " • esgotado" : ""}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-semibold",
            coupon.isActive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
          )}
        >
          {coupon.isActive ? "Ativo" : "Pausado"}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => run(() => setCouponActive({ id: coupon.id, isActive: !coupon.isActive }))}
        >
          {coupon.isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {coupon.isActive ? "Pausar" : "Ativar"}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-rose-600"
          aria-label={`Excluir cupom ${coupon.code}`}
          disabled={isPending}
          onClick={() => {
            if (confirm(`Excluir o cupom ${coupon.code}?`)) run(() => deleteCoupon({ id: coupon.id }));
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </li>
  );
}

function NewCouponForm({ onDone }: { onDone: () => void }) {
  const { run, isPending, error, setError } = useRunAction();
  const [code, setCode] = useState("");
  const [type, setType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [value, setValue] = useState("");
  const [minOrder, setMinOrder] = useState("");
  const [maxUses, setMaxUses] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const numeric = type === "PERCENT" ? Number(value.replace(",", ".")) : reaisToCents(value);
    if (numeric === null || !Number.isFinite(numeric) || numeric <= 0) {
      setError("Informe um desconto válido.");
      return;
    }
    const minOrderCents = minOrder.trim() ? reaisToCents(minOrder) : 0;
    if (minOrderCents === null) {
      setError("Pedido mínimo inválido (ex: 40,00).");
      return;
    }
    const uses = maxUses.trim() ? Number(maxUses) : null;
    if (uses !== null && (!Number.isInteger(uses) || uses < 1)) {
      setError("Limite de usos inválido.");
      return;
    }
    run(
      () =>
        saveCoupon({
          code,
          type,
          value: type === "PERCENT" ? Math.round(numeric) : numeric,
          minOrderCents,
          maxUses: uses,
          isActive: true,
        }),
      onDone,
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Código">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="BEMVINDO10"
            maxLength={20}
            required
          />
        </Field>
        <Field label="Tipo de desconto">
          <div className="flex rounded-xl border border-slate-200 bg-white p-1">
            {(["PERCENT", "FIXED"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                aria-pressed={type === t}
                className={cn(
                  "flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition",
                  type === t ? "bg-brand text-black" : "text-muted",
                )}
              >
                {t === "PERCENT" ? "Percentual (%)" : "Valor fixo (R$)"}
              </button>
            ))}
          </div>
        </Field>
        <Field label={type === "PERCENT" ? "Desconto (%)" : "Desconto (R$)"}>
          <Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" required />
        </Field>
        <Field label="Pedido mínimo (R$)">
          <Input value={minOrder} onChange={(e) => setMinOrder(e.target.value)} inputMode="decimal" placeholder="0,00" />
        </Field>
        <Field label="Limite de usos (vazio = ilimitado)">
          <Input value={maxUses} onChange={(e) => setMaxUses(e.target.value)} inputMode="numeric" placeholder="Ilimitado" />
        </Field>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          Criar cupom
        </Button>
      </div>
    </form>
  );
}

export function CouponsManager({ coupons }: { coupons: AdminCoupon[] }) {
  const [creating, setCreating] = useState(false);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-extrabold">Cupons promocionais</h2>
        {!creating ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Novo cupom
          </Button>
        ) : null}
      </div>
      {creating ? <NewCouponForm onDone={() => setCreating(false)} /> : null}
      {coupons.length === 0 && !creating ? (
        <p className="py-8 text-center text-sm text-muted">Nenhum cupom criado ainda.</p>
      ) : (
        <ul className="divide-y divide-slate-200">
          {coupons.map((coupon) => (
            <CouponRow key={coupon.id} coupon={coupon} />
          ))}
        </ul>
      )}
    </section>
  );
}
