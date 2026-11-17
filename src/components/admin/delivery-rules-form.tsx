"use client";

import { Loader2, MapPin, Plus, Route, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";

import { saveDeliveryRules } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { DeliveryRules } from "@/core/store/delivery-rules";

import { centsToReais, reaisToCents } from "./money";
import { Toast, type ToastState } from "./toast";
import { useRunAction } from "./use-run-action";

const inputCls = "border-slate-300 bg-white text-slate-900";

type BandDraft = { maxKm: string; fee: string };

function parseKm(value: string): number | null {
  const n = Number(value.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fmtKm(km: number): string {
  return String(km).replace(".", ",");
}

export function DeliveryRulesForm({ rules }: { rules: DeliveryRules }) {
  const { run, isPending, error, setError } = useRunAction();
  const [toast, setToast] = useState<ToastState>(null);
  const dismiss = useCallback(() => setToast(null), []);

  const [restrictToCity, setRestrictToCity] = useState(rules.restrictToCity);
  const [city, setCity] = useState(rules.city);
  const [radius, setRadius] = useState(fmtKm(rules.maxRadiusKm));
  const [baseAddress, setBaseAddress] = useState(rules.baseAddress);
  const [bands, setBands] = useState<BandDraft[]>(
    rules.bands.map((b) => ({ maxKm: fmtKm(b.maxKm), fee: centsToReais(b.feeCents) })),
  );

  function updateBand(i: number, patch: Partial<BandDraft>) {
    setBands((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }

  /** "0 a 6.0 km" / "6.01 a 8.5 km": o início é o fim da faixa anterior (+0,01). */
  function rangeLabel(i: number): string {
    const to = parseKm(bands[i].maxKm);
    const prev = i === 0 ? null : parseKm(bands[i - 1].maxKm);
    const from = i === 0 ? "0" : prev === null ? "?" : (prev + 0.01).toFixed(2);
    return `${from} a ${to === null ? "?" : Number.isInteger(to) ? to.toFixed(1) : String(to)} km`;
  }

  function handleSave() {
    const maxRadiusKm = parseKm(radius);
    if (maxRadiusKm === null) {
      setError("Raio máximo inválido (ex: 11,0).");
      return;
    }
    const parsedBands: { maxKm: number; feeCents: number }[] = [];
    for (const [i, b] of bands.entries()) {
      const maxKm = parseKm(b.maxKm);
      const feeCents = reaisToCents(b.fee);
      if (maxKm === null || feeCents === null) {
        setError(`Faixa ${i + 1}: informe distância e valor válidos.`);
        return;
      }
      parsedBands.push({ maxKm, feeCents });
    }

    run(
      () => saveDeliveryRules({ restrictToCity, city, maxRadiusKm, baseAddress, bands: parsedBands }),
      () => setToast({ kind: "success", message: "Regras de entrega salvas." }),
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Toast toast={toast} onDismiss={dismiss} />
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Regras de entrega</h1>
        <p className="mt-1 text-sm text-slate-500">
          Cobertura e frete calculados pela distância a partir do endereço base da loja.
        </p>
      </div>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-bold text-slate-900">
          <MapPin className="h-5 w-5 text-slate-400" /> Área de cobertura
        </h2>

        <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Somente {city || "o município"}</p>
            <p className="text-xs text-slate-500">Recusa endereços fora do município, mesmo dentro do raio.</p>
          </div>
          <Switch aria-label="Restringir ao município" checked={restrictToCity} onCheckedChange={setRestrictToCity} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Município">
            <Input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Raio máximo de entrega (km)">
            <Input
              className={inputCls}
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              inputMode="decimal"
              placeholder="11,0"
            />
          </Field>
        </div>
        <Field label="Endereço base da loja (origem do raio)">
          <Input className={inputCls} value={baseAddress} onChange={(e) => setBaseAddress(e.target.value)} maxLength={200} />
        </Field>
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="flex items-center gap-2 font-bold text-slate-900">
            <Route className="h-5 w-5 text-slate-400" /> Faixas de frete
          </h2>
          <p className="text-xs text-slate-500">Cada faixa começa onde a anterior termina. Defina o limite (km) e o valor.</p>
        </div>

        <ul className="divide-y divide-slate-100">
          {bands.map((band, i) => (
            <li key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-3 py-3 md:grid-cols-[1.2fr_1fr_1fr_auto]">
              <span className="col-span-3 text-sm font-semibold text-slate-700 md:col-span-1">{rangeLabel(i)}</span>
              <Input
                className={inputCls}
                value={band.maxKm}
                onChange={(e) => updateBand(i, { maxKm: e.target.value })}
                inputMode="decimal"
                aria-label={`Até quantos km (faixa ${i + 1})`}
                placeholder="Até (km)"
              />
              <Input
                className={inputCls}
                value={band.fee}
                onChange={(e) => updateBand(i, { fee: e.target.value })}
                inputMode="decimal"
                aria-label={`Valor do frete (faixa ${i + 1})`}
                placeholder="Frete (R$)"
              />
              <Button
                variant="ghost"
                size="icon"
                className="text-red-600"
                aria-label={`Remover faixa ${i + 1}`}
                disabled={bands.length <= 1}
                onClick={() => setBands((prev) => prev.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>

        <Button
          variant="outline"
          size="sm"
          className="border-slate-300 text-slate-700"
          disabled={bands.length >= 10}
          onClick={() => setBands((prev) => [...prev, { maxKm: "", fee: "" }])}
        >
          <Plus className="h-4 w-4" /> Adicionar faixa
        </Button>

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
