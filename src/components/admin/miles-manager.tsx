"use client";

import { Gift, Loader2, Plane, Plus, Target, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";

import {
  deleteMilesMission,
  deleteMilesReward,
  saveMilesMission,
  saveMilesReward,
  saveMilesSettings,
  type AdminMiles,
} from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatCents } from "@/lib/utils";

import { centsToReais, reaisToCents } from "./money";
import { Toast, type ToastState } from "./toast";
import { useRunAction } from "./use-run-action";

const inputCls = "border-slate-300 bg-white text-slate-900";
const toInt = (value: string): number | null => {
  const n = Number(value.trim());
  return Number.isInteger(n) ? n : null;
};

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-2xl font-extrabold text-slate-900">{value.toLocaleString("pt-BR")}</p>
      <p className="text-sm font-semibold text-slate-700">{label}</p>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

type RewardDraft = { id: string | null; name: string; milesCost: string; discount: string; minOrder: string; isActive: boolean };

const emptyDraft = (): RewardDraft => ({ id: null, name: "", milesCost: "", discount: "", minOrder: "0,00", isActive: true });

type MissionDraft = {
  id: string | null;
  name: string;
  period: "WEEK" | "MONTH";
  target: string;
  minOrder: string;
  bonus: string;
  isActive: boolean;
};

const emptyMission = (): MissionDraft => ({ id: null, name: "", period: "MONTH", target: "3", minOrder: "0,00", bonus: "", isActive: true });

export function MilesManager({ data }: { data: AdminMiles }) {
  const { config, stats, dashboard } = data;
  const settingsAction = useRunAction();
  const rewardAction = useRunAction();
  const missionAction = useRunAction();
  const [mission, setMission] = useState<MissionDraft | null>(null);
  const maxDay = Math.max(1, ...dashboard.spendByDay.map((d) => d.cents));

  function saveMission() {
    if (!mission) return;
    const targetOrders = toInt(mission.target);
    const bonusMiles = toInt(mission.bonus);
    const minOrderCents = reaisToCents(mission.minOrder);
    if (targetOrders === null || bonusMiles === null || minOrderCents === null) {
      missionAction.setError("Confira a meta, o bônus e o valor mínimo.");
      return;
    }
    missionAction.run(
      () =>
        saveMilesMission({
          id: mission.id,
          name: mission.name,
          period: mission.period,
          targetOrders,
          minOrderCents,
          bonusMiles,
          isActive: mission.isActive,
        }),
      () => {
        setMission(null);
        setToast({ kind: "success", message: "Missão salva." });
      },
    );
  }
  const [toast, setToast] = useState<ToastState>(null);
  const dismiss = useCallback(() => setToast(null), []);

  const [enabled, setEnabled] = useState(config.enabled);
  const [perReal, setPerReal] = useState(String(config.milesPerReal));
  const [validity, setValidity] = useState(String(config.validityMonths));
  const [couponDays, setCouponDays] = useState(String(config.rewardCouponValidDays));
  const [draft, setDraft] = useState<RewardDraft | null>(null);

  function saveSettings() {
    const milesPerReal = toInt(perReal);
    const validityMonths = toInt(validity);
    const rewardCouponValidDays = toInt(couponDays);
    if (milesPerReal === null || validityMonths === null || rewardCouponValidDays === null) {
      settingsAction.setError("Confira os campos: use apenas números inteiros.");
      return;
    }
    settingsAction.run(
      () => saveMilesSettings({ enabled, milesPerReal, validityMonths, rewardCouponValidDays }),
      () => setToast({ kind: "success", message: "Programa de milhas salvo." }),
    );
  }

  function saveReward() {
    if (!draft) return;
    const milesCost = toInt(draft.milesCost);
    const discountCents = reaisToCents(draft.discount);
    const minOrderCents = reaisToCents(draft.minOrder);
    if (milesCost === null || discountCents === null || minOrderCents === null) {
      rewardAction.setError("Confira o custo em milhas e os valores em R$.");
      return;
    }
    rewardAction.run(
      () =>
        saveMilesReward({
          id: draft.id,
          name: draft.name,
          milesCost,
          discountCents,
          minOrderCents,
          isActive: draft.isActive,
        }),
      () => {
        setDraft(null);
        setToast({ kind: "success", message: "Recompensa salva." });
      },
    );
  }

  const previewReal = toInt(perReal);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Toast toast={toast} onDismiss={dismiss} />
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Programa de milhas</h1>
        <p className="mt-1 text-sm text-slate-500">
          O cliente ganha milhas a cada pedido pago e troca por cupons de desconto. Ele fica desligado até você ativar.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Milhas emitidas" value={stats.issued30d} hint="últimos 30 dias" />
        <Stat label="Milhas resgatadas" value={stats.redeemed30d} hint="últimos 30 dias" />
        <Stat label="Resgates" value={stats.couponsRedeemed30d} hint="cupons gerados em 30 dias" />
        <Stat label="Clientes com milhas" value={stats.customersWithMiles} />
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">Resultados (30 dias)</h2>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xl font-extrabold text-slate-900">{dashboard.activeCustomers30d}</p>
            <p className="text-xs text-slate-500">clientes ativos</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xl font-extrabold text-slate-900">{dashboard.recurringCustomers30d}</p>
            <p className="text-xs text-slate-500">pediram 2+ vezes</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xl font-extrabold text-slate-900">{formatCents(dashboard.recurringRevenueCents30d)}</p>
            <p className="text-xs text-slate-500">gasto dos recorrentes</p>
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Valor vendido nos últimos 7 dias</p>
          <div className="flex h-28 items-end gap-2">
            {dashboard.spendByDay.map((d) => (
              <div key={d.label} className="flex flex-1 flex-col items-center justify-end gap-1">
                <div className="w-full rounded-t bg-[#F59E0B]" style={{ height: `${Math.round((d.cents / maxDay) * 100)}%`, minHeight: d.cents > 0 ? 4 : 0 }} title={formatCents(d.cents)} />
                <span className="text-[10px] text-slate-500">{d.label}</span>
              </div>
            ))}
          </div>
        </div>
        {dashboard.top.length > 0 ? (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Quem mais compra</p>
            <ul className="divide-y divide-slate-100 text-sm">
              {dashboard.top.map((c, i) => (
                <li key={`${c.name}-${i}`} className="flex items-center justify-between py-2">
                  <span className="font-semibold text-slate-900">{c.name}</span>
                  <span className="text-slate-600">
                    {c.orders} pedido(s) · {formatCents(c.spendCents)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Plane className="h-4 w-4 text-slate-400" /> Programa ativo
            </p>
            <p className="text-xs text-slate-500">
              Desligado = ninguém ganha milhas. Os pedidos feitos enquanto estava desligado não rendem milhas depois.
            </p>
          </div>
          <Switch aria-label="Ligar programa de milhas" checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Milhas por R$ 1,00 em itens">
            <Input className={inputCls} value={perReal} onChange={(e) => setPerReal(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Validade das milhas (meses, 0 = sem validade)">
            <Input className={inputCls} value={validity} onChange={(e) => setValidity(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Validade do cupom resgatado (dias)">
            <Input className={inputCls} value={couponDays} onChange={(e) => setCouponDays(e.target.value)} inputMode="numeric" />
          </Field>
        </div>
        {previewReal && previewReal > 0 ? (
          <p className="text-xs text-slate-500">
            Exemplo: um pedido de R$ 50,00 em itens rende {(50 * previewReal).toLocaleString("pt-BR")} milhas. O custo para a loja é
            definido pelo valor de desconto de cada recompensa abaixo.
          </p>
        ) : null}
        {settingsAction.error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{settingsAction.error}</p> : null}
        <div className="flex justify-end border-t border-slate-100 pt-4">
          <Button size="lg" onClick={saveSettings} disabled={settingsAction.isPending}>
            {settingsAction.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
            Salvar regras
          </Button>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="flex items-center gap-2 font-bold text-slate-900">
            <Gift className="h-5 w-5 text-slate-400" /> Recompensas
          </h2>
          <p className="text-xs text-slate-500">
            Cada recompensa troca X milhas por um cupom de desconto pessoal, de uso único, só sobre os itens.
          </p>
        </div>

        {data.rewards.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma recompensa cadastrada. Sem elas o cliente acumula, mas não consegue trocar.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.rewards.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">
                    {r.name} {r.isActive ? null : <span className="text-xs font-normal text-slate-400">(inativa)</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {r.milesCost.toLocaleString("pt-BR")} milhas → {formatCents(r.discountCents)} de desconto
                    {r.minOrderCents > 0 ? ` · pedido a partir de ${formatCents(r.minOrderCents)}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-slate-300 text-slate-700"
                    onClick={() =>
                      setDraft({
                        id: r.id,
                        name: r.name,
                        milesCost: String(r.milesCost),
                        discount: centsToReais(r.discountCents),
                        minOrder: centsToReais(r.minOrderCents),
                        isActive: r.isActive,
                      })
                    }
                  >
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-red-600"
                    aria-label={`Excluir ${r.name}`}
                    onClick={() => {
                      if (window.confirm(`Excluir a recompensa "${r.name}"? Cupons já resgatados continuam valendo.`)) {
                        rewardAction.run(() => deleteMilesReward({ id: r.id }));
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {draft ? (
          <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome (ex.: R$ 10 de desconto)">
                <Input className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} />
              </Field>
              <Field label="Custo em milhas">
                <Input
                  className={inputCls}
                  value={draft.milesCost}
                  onChange={(e) => setDraft({ ...draft, milesCost: e.target.value })}
                  inputMode="numeric"
                />
              </Field>
              <Field label="Desconto (R$)">
                <Input
                  className={inputCls}
                  value={draft.discount}
                  onChange={(e) => setDraft({ ...draft, discount: e.target.value })}
                  inputMode="decimal"
                />
              </Field>
              <Field label="Pedido mínimo em itens (R$)">
                <Input
                  className={inputCls}
                  value={draft.minOrder}
                  onChange={(e) => setDraft({ ...draft, minOrder: e.target.value })}
                  inputMode="decimal"
                />
              </Field>
            </div>
            <div className="flex items-center justify-between gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <Switch aria-label="Recompensa ativa" checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} />
                Ativa (aparece para o cliente)
              </label>
              <div className="flex gap-2">
                <Button variant="outline" className="border-slate-300 text-slate-700" onClick={() => setDraft(null)}>
                  Cancelar
                </Button>
                <Button onClick={saveReward} disabled={rewardAction.isPending}>
                  {rewardAction.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Salvar recompensa
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="border-slate-300 text-slate-700"
            onClick={() => {
              rewardAction.setError(null);
              setDraft(emptyDraft());
            }}
          >
            <Plus className="h-4 w-4" /> Nova recompensa
          </Button>
        )}
        {rewardAction.error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{rewardAction.error}</p> : null}
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="flex items-center gap-2 font-bold text-slate-900">
            <Target className="h-5 w-5 text-slate-400" /> Missões
          </h2>
          <p className="text-xs text-slate-500">
            Ex.: “Peça 3x no mês”. O progresso conta os pedidos pagos do período (semana de segunda a domingo ou mês civil) e o bônus
            em milhas é pago uma vez por período.
          </p>
        </div>

        {data.missions.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma missão cadastrada.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.missions.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">
                    {m.name} {m.isActive ? null : <span className="text-xs font-normal text-slate-400">(inativa)</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {m.targetOrders} pedido(s) {m.period === "WEEK" ? "na semana" : "no mês"}
                    {m.minOrderCents > 0 ? ` (a partir de ${formatCents(m.minOrderCents)} em itens)` : ""} → +
                    {m.bonusMiles.toLocaleString("pt-BR")} milhas
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-slate-300 text-slate-700"
                    onClick={() =>
                      setMission({
                        id: m.id,
                        name: m.name,
                        period: m.period,
                        target: String(m.targetOrders),
                        minOrder: centsToReais(m.minOrderCents),
                        bonus: String(m.bonusMiles),
                        isActive: m.isActive,
                      })
                    }
                  >
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-red-600"
                    aria-label={`Excluir ${m.name}`}
                    onClick={() => {
                      if (window.confirm(`Excluir a missão "${m.name}"?`)) {
                        missionAction.run(() => deleteMilesMission({ id: m.id }));
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {mission ? (
          <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome (ex.: Peça 3x no mês)">
                <Input className={inputCls} value={mission.name} onChange={(e) => setMission({ ...mission, name: e.target.value })} maxLength={80} />
              </Field>
              <Field label="Período">
                <select
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900"
                  value={mission.period}
                  onChange={(e) => setMission({ ...mission, period: e.target.value as "WEEK" | "MONTH" })}
                >
                  <option value="WEEK">Semana (segunda a domingo)</option>
                  <option value="MONTH">Mês</option>
                </select>
              </Field>
              <Field label="Meta (pedidos no período)">
                <Input className={inputCls} value={mission.target} onChange={(e) => setMission({ ...mission, target: e.target.value })} inputMode="numeric" />
              </Field>
              <Field label="Bônus (milhas)">
                <Input className={inputCls} value={mission.bonus} onChange={(e) => setMission({ ...mission, bonus: e.target.value })} inputMode="numeric" />
              </Field>
              <Field label="Pedido mínimo em itens (R$)">
                <Input className={inputCls} value={mission.minOrder} onChange={(e) => setMission({ ...mission, minOrder: e.target.value })} inputMode="decimal" />
              </Field>
            </div>
            <div className="flex items-center justify-between gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <Switch aria-label="Missão ativa" checked={mission.isActive} onCheckedChange={(v) => setMission({ ...mission, isActive: v })} />
                Ativa (aparece para o cliente)
              </label>
              <div className="flex gap-2">
                <Button variant="outline" className="border-slate-300 text-slate-700" onClick={() => setMission(null)}>
                  Cancelar
                </Button>
                <Button onClick={saveMission} disabled={missionAction.isPending}>
                  {missionAction.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Salvar missão
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="border-slate-300 text-slate-700"
            onClick={() => {
              missionAction.setError(null);
              setMission(emptyMission());
            }}
          >
            <Plus className="h-4 w-4" /> Nova missão
          </Button>
        )}
        {missionAction.error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{missionAction.error}</p> : null}
      </section>
    </div>
  );
}
