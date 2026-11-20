"use client";

import { Loader2, Megaphone, Percent, Send } from "lucide-react";
import { useCallback, useState } from "react";

import { saveMarketingSettings, type AdminMarketing } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

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
      <p className="text-2xl font-extrabold text-slate-900">{value}</p>
      <p className="text-sm font-semibold text-slate-700">{label}</p>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function MarketingForm({ data }: { data: AdminMarketing }) {
  const { config, stats } = data;
  const { run, isPending, error, setError } = useRunAction();
  const [toast, setToast] = useState<ToastState>(null);
  const dismiss = useCallback(() => setToast(null), []);

  const [enabled, setEnabled] = useState(config.enabled);
  const [minPercent, setMinPercent] = useState(String(config.discountMinPercent));
  const [maxPercent, setMaxPercent] = useState(String(config.discountMaxPercent));
  const [fanBonus, setFanBonus] = useState(String(config.fanBonusPercent));
  const [validHours, setValidHours] = useState(String(config.couponValidHours));
  const [minOrder, setMinOrder] = useState(centsToReais(config.couponMinOrderCents));
  const [minDays, setMinDays] = useState(String(config.minDaysBetween));
  const [fromHour, setFromHour] = useState(String(config.sendFromHour));
  const [untilHour, setUntilHour] = useState(String(config.sendUntilHour));
  const [targetAtRisk, setTargetAtRisk] = useState(config.targetAtRisk);
  const [targetLost, setTargetLost] = useState(config.targetLost);
  const [targetNew, setTargetNew] = useState(config.targetNew);

  function handleSave() {
    const values = {
      discountMinPercent: toInt(minPercent),
      discountMaxPercent: toInt(maxPercent),
      fanBonusPercent: toInt(fanBonus),
      couponValidHours: toInt(validHours),
      couponMinOrderCents: reaisToCents(minOrder),
      minDaysBetween: toInt(minDays),
      sendFromHour: toInt(fromHour),
      sendUntilHour: toInt(untilHour),
    };
    if (Object.values(values).some((v) => v === null)) {
      setError("Confira os campos: use apenas números válidos.");
      return;
    }
    run(
      () =>
        saveMarketingSettings({
          enabled,
          targetAtRisk,
          targetLost,
          targetNew,
          ...(values as { [K in keyof typeof values]: number }),
        }),
      () => setToast({ kind: "success", message: "Configurações de marketing salvas." }),
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Toast toast={toast} onDismiss={dismiss} />
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Marketing</h1>
        <p className="mt-1 text-sm text-slate-500">
          Resgate automático de clientes que pediram e sumiram, com um cupom pessoal sorteado dentro da faixa abaixo.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Mensagens enviadas" value={stats.sent30d} hint="últimos 30 dias" />
        <Stat label="Viraram pedido" value={stats.converted30d} hint="cupom usado e pago" />
        <Stat label="Clientes em risco" value={stats.atRisk} hint="pararam de pedir" />
        <Stat label="Clientes fãs" value={stats.fans} hint="4+ pedidos em 60 dias" />
      </section>

      {stats.waitingTemplate30d > 0 && !data.whatsappTemplateConfigured ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {stats.waitingTemplate30d} cliente(s) ficaram de fora por terem falado com a loja há mais de 24 h. Fora desse prazo o
          WhatsApp só permite mensagem com template aprovado (variável <b>WHATSAPP_TEMPLATE_WINBACK</b>).
        </p>
      ) : null}

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Megaphone className="h-4 w-4 text-slate-400" /> Campanha de resgate
            </p>
            <p className="text-xs text-slate-500">Desligada = nenhuma mensagem de marketing é enviada.</p>
          </div>
          <Switch aria-label="Ligar campanha de resgate" checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <h2 className="flex items-center gap-2 font-bold text-slate-900">
          <Percent className="h-5 w-5 text-slate-400" /> Desconto sorteado
        </h2>
        <p className="-mt-2 text-xs text-slate-500">
          Cada cliente recebe um valor aleatório entre o mínimo e o máximo, só sobre os itens (não vale na taxa de entrega).
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Mínimo (%)">
            <Input className={inputCls} value={minPercent} onChange={(e) => setMinPercent(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Máximo (%)">
            <Input className={inputCls} value={maxPercent} onChange={(e) => setMaxPercent(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Bônus para fãs (+%)">
            <Input className={inputCls} value={fanBonus} onChange={(e) => setFanBonus(e.target.value)} inputMode="numeric" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Validade do cupom (horas)">
            <Input className={inputCls} value={validHours} onChange={(e) => setValidHours(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Pedido mínimo em itens (R$)">
            <Input className={inputCls} value={minOrder} onChange={(e) => setMinOrder(e.target.value)} inputMode="decimal" />
          </Field>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-bold text-slate-900">
          <Send className="h-5 w-5 text-slate-400" /> Quem recebe e quando
        </h2>
        <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-900">Clientes em risco (estão atrasados para pedir de novo)</p>
          <Switch aria-label="Incluir clientes em risco" checked={targetAtRisk} onCheckedChange={setTargetAtRisk} />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-900">Clientes perdidos (60+ dias sem pedir)</p>
          <Switch aria-label="Incluir clientes perdidos" checked={targetLost} onCheckedChange={setTargetLost} />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-900">Clientes novos (um pedido só: convite ao segundo pedido, uma vez)</p>
          <Switch aria-label="Incluir clientes novos" checked={targetNew} onCheckedChange={setTargetNew} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Intervalo entre mensagens (dias)">
            <Input className={inputCls} value={minDays} onChange={(e) => setMinDays(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Enviar a partir das (hora)">
            <Input className={inputCls} value={fromHour} onChange={(e) => setFromHour(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Enviar até as (hora)">
            <Input className={inputCls} value={untilHour} onChange={(e) => setUntilHour(e.target.value)} inputMode="numeric" />
          </Field>
        </div>
        <p className="text-xs text-slate-500">
          Só envia com a loja aberta e para quem já conversou com vocês no WhatsApp. Quem responde PARAR nunca mais recebe.
        </p>

        {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p> : null}

        <div className="flex justify-end border-t border-slate-100 pt-4">
          <Button size="lg" onClick={handleSave} disabled={isPending}>
            {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
            Salvar alterações
          </Button>
        </div>
      </section>
    </div>
  );
}
