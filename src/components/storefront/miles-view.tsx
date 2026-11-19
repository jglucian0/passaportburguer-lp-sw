"use client";

import { Check, Gift, Loader2, Plane, Target, Ticket } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { redeemMilesReward } from "@/actions/miles";
import { cn, formatCents } from "@/lib/utils";

export type MilesViewData = {
  enabled: boolean;
  firstName: string;
  available: number;
  expiringSoon: number;
  nextExpiry: string | null;
  milesPerReal: number;
  rewards: { id: string; name: string; milesCost: number; discountCents: number; minOrderCents: number }[];
  history: { id: string; type: string; miles: number; description: string; createdAt: string }[];
  coupons: { code: string; discountCents: number; validUntil: string | null; minOrderCents: number }[];
  missions: {
    id: string;
    name: string;
    period: "WEEK" | "MONTH";
    bonusMiles: number;
    minOrderCents: number;
    done: number;
    target: number;
    awarded: boolean;
  }[];
};

const card = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm";
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });
const fmtMiles = (n: number) => n.toLocaleString("pt-BR");

export function MilesView({ data }: { data: MilesViewData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  if (!data.enabled) {
    return (
      <div className={cn(card, "text-center")}>
        <Plane className="mx-auto mb-2 h-8 w-8 text-slate-400" />
        <p className="font-semibold">O programa de milhas está chegando!</p>
        <p className="mt-1 text-sm text-slate-600">Em breve você vai ganhar milhas a cada pedido e trocar por descontos.</p>
      </div>
    );
  }

  const nextReward = data.rewards.find((r) => r.milesCost > data.available);

  function redeem(rewardId: string) {
    setMessage(null);
    setBusyId(rewardId);
    startTransition(async () => {
      try {
        const result = await redeemMilesReward(rewardId);
        if (result.ok) {
          setMessage({
            kind: "ok",
            text: `Resgatado! Seu cupom ${result.data.couponCode} (${formatCents(result.data.discountCents)} de desconto) já está na sua conta e entra sozinho no próximo pedido.`,
          });
          router.refresh();
        } else {
          setMessage({ kind: "error", text: result.error });
        }
      } catch {
        setMessage({ kind: "error", text: "Não foi possível resgatar agora. Tente novamente." });
      } finally {
        setBusyId(null);
      }
    });
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-[#071329] p-5 text-white shadow-sm">
        <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#CBD5E1]">
          <Plane className="h-4 w-4 text-[#F59E0B]" /> Milhas Passaporte · {data.firstName}
        </p>
        <p className="mt-2 text-4xl font-extrabold text-[#F59E0B]">{fmtMiles(data.available)}</p>
        <p className="text-sm text-[#CBD5E1]">milhas disponíveis</p>
        {data.expiringSoon > 0 && data.nextExpiry ? (
          <p className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-xs">
            {fmtMiles(data.expiringSoon)} milhas vencem em {fmtDate(data.nextExpiry)}. Use antes!
          </p>
        ) : null}
        {nextReward ? (
          <div className="mt-4">
            <div className="h-2 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-[#F59E0B]"
                style={{ width: `${Math.min(100, Math.round((data.available / nextReward.milesCost) * 100))}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-[#CBD5E1]">
              Faltam {fmtMiles(nextReward.milesCost - data.available)} milhas para “{nextReward.name}”.
            </p>
          </div>
        ) : null}
        <p className="mt-3 text-xs text-[#CBD5E1]">
          Você ganha {data.milesPerReal} milhas a cada R$ 1,00 em lanches e bebidas (sem a taxa de entrega).
        </p>
      </section>

      {message ? (
        <p
          role="status"
          className={cn(
            "rounded-xl border p-3 text-sm",
            message.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700",
          )}
        >
          {message.text}
        </p>
      ) : null}

      {data.coupons.length > 0 ? (
        <section className={cn(card, "space-y-2")}>
          <h2 className="flex items-center gap-2 font-bold">
            <Ticket className="h-4 w-4" /> Seus cupons
          </h2>
          {data.coupons.map((c) => (
            <div key={c.code} className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm">
              <div>
                <p className="font-mono font-bold text-emerald-900">{c.code}</p>
                <p className="text-xs text-emerald-800">
                  {formatCents(c.discountCents)} de desconto nos itens
                  {c.minOrderCents > 0 ? ` (pedido a partir de ${formatCents(c.minOrderCents)})` : ""}
                  {c.validUntil ? ` · até ${fmtDate(c.validUntil)}` : ""}
                </p>
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-500">No WhatsApp o desconto entra sozinho. No site, digite o código no checkout.</p>
        </section>
      ) : null}

      {data.missions.length > 0 ? (
        <section className={cn(card, "space-y-3")}>
          <h2 className="flex items-center gap-2 font-bold">
            <Target className="h-4 w-4" /> Missões
          </h2>
          {data.missions.map((m) => {
            const complete = m.done >= m.target;
            return (
              <div key={m.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{m.name}</p>
                    <p className="text-xs text-slate-500">
                      {m.period === "WEEK" ? "Nesta semana" : "Neste mês"}
                      {m.minOrderCents > 0 ? ` · pedidos a partir de ${formatCents(m.minOrderCents)} em itens` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#F59E0B]/15 px-2.5 py-1 text-xs font-bold text-[#B45309]">
                    +{fmtMiles(m.bonusMiles)} milhas
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn("h-full rounded-full", complete ? "bg-emerald-500" : "bg-[#F59E0B]")}
                      style={{ width: `${Math.min(100, Math.round((m.done / m.target) * 100))}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-600">
                    {m.done}/{m.target}
                  </span>
                </div>
                {complete ? (
                  <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-emerald-700">
                    <Check className="h-3.5 w-3.5" /> {m.awarded ? "Missão cumprida, bônus já creditado!" : "Missão cumprida!"}
                  </p>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      <section className={cn(card, "space-y-3")}>
        <h2 className="flex items-center gap-2 font-bold">
          <Gift className="h-4 w-4" /> Trocar milhas
        </h2>
        {data.rewards.length === 0 ? (
          <p className="text-sm text-slate-600">As recompensas estão sendo preparadas. Continue acumulando!</p>
        ) : (
          data.rewards.map((r) => {
            const can = data.available >= r.milesCost;
            return (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                <div className="min-w-0">
                  <p className="font-semibold">{r.name}</p>
                  <p className="text-xs text-slate-500">
                    {formatCents(r.discountCents)} de desconto
                    {r.minOrderCents > 0 ? ` · pedido a partir de ${formatCents(r.minOrderCents)}` : ""}
                  </p>
                  <p className="text-sm font-bold text-[#B45309]">{fmtMiles(r.milesCost)} milhas</p>
                </div>
                <button
                  type="button"
                  disabled={!can || pending}
                  onClick={() => redeem(r.id)}
                  className="flex h-10 shrink-0 items-center justify-center rounded-lg bg-[#F59E0B] px-4 text-sm font-semibold text-[#071329] disabled:opacity-40"
                >
                  {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Resgatar"}
                </button>
              </div>
            );
          })
        )}
      </section>

      <section className={cn(card, "space-y-2")}>
        <h2 className="font-bold">Extrato</h2>
        {data.history.length === 0 ? (
          <p className="text-sm text-slate-600">Faça seu primeiro pedido e comece a acumular milhas.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {data.history.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2">
                <div>
                  <p>{h.description}</p>
                  <p className="text-xs text-slate-500">{fmtDate(h.createdAt)}</p>
                </div>
                <span className={cn("font-bold", h.miles >= 0 ? "text-emerald-700" : "text-red-700")}>
                  {h.miles >= 0 ? "+" : ""}
                  {fmtMiles(h.miles)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
