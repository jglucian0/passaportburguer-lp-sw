"use client";

import { Check, Loader2 } from "lucide-react";
import { useState } from "react";

import { saveStoreSettings, type AdminStoreSettings } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { OpeningHours } from "@/core/store/opening-hours";
import { formatPhone } from "@/lib/utils";

import { ImageUpload } from "./image-upload";
import { centsToReais, reaisToCents } from "./money";
import { StoreToggle } from "./store-toggle";
import { useRunAction } from "./use-run-action";

const DAYS: { key: keyof OpeningHours; label: string }[] = [
  { key: "1", label: "Segunda-feira" },
  { key: "2", label: "Terça-feira" },
  { key: "3", label: "Quarta-feira" },
  { key: "4", label: "Quinta-feira" },
  { key: "5", label: "Sexta-feira" },
  { key: "6", label: "Sábado" },
  { key: "0", label: "Domingo" },
];

export function StoreSettingsForm({
  settings,
  role,
}: {
  settings: AdminStoreSettings;
  role: "OWNER" | "STAFF";
}) {
  const { run, isPending, error, setError } = useRunAction();
  const [saved, setSaved] = useState(false);

  const [name, setName] = useState(settings.name);
  const [phone, setPhone] = useState(
    formatPhone((settings.phoneWhatsapp ?? "").replace(/^55/, "")),
  );
  const [logoUrl, setLogoUrl] = useState<string | null>(settings.logoUrl);
  const [primaryColor, setPrimaryColor] = useState(settings.primaryColor);
  const [minOrder, setMinOrder] = useState(centsToReais(settings.minOrderCents));
  const [hours, setHours] = useState<OpeningHours>(settings.openingHours);

  const readOnly = role !== "OWNER";

  function updateDay(key: keyof OpeningHours, patch: Partial<OpeningHours[keyof OpeningHours]>) {
    setSaved(false);
    setHours((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);

    const minOrderCents = reaisToCents(minOrder);
    if (minOrderCents === null) {
      setError("Pedido mínimo inválido (ex: 25,00).");
      return;
    }

    run(
      () =>
        saveStoreSettings({
          name,
          phoneWhatsapp: phone.trim() ? phone : null,
          logoUrl,
          primaryColor,
          minOrderCents,
          openingHours: hours,
        }),
      () => setSaved(true),
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Configurações da loja</h1>
        <StoreToggle isManuallyClosed={settings.isManuallyClosed} />
      </div>

      {settings.isManuallyClosed ? (
        <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-400">
          A loja está fechada manualmente: nenhum pedido será aceito até você reabrir.
        </p>
      ) : null}

      {readOnly ? (
        <p className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-400">
          Apenas o proprietário pode alterar as configurações abaixo.
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-6">
        <fieldset disabled={readOnly || isPending} className="space-y-6 disabled:opacity-70">
          <section className="space-y-4 rounded-2xl border border-border bg-surface p-4">
            <h2 className="font-bold">Dados da loja</h2>
            <ImageUpload value={logoUrl} onChange={(url) => { setLogoUrl(url); setSaved(false); }} folder="logo" />
            <Field label="Nome">
              <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="WhatsApp da loja">
                <Input
                  value={phone}
                  onChange={(e) => setPhone(formatPhone(e.target.value))}
                  inputMode="tel"
                  placeholder="(11) 99999-8888"
                />
              </Field>
              <Field label="Pedido mínimo (R$)">
                <Input value={minOrder} onChange={(e) => setMinOrder(e.target.value)} inputMode="decimal" required />
              </Field>
              <Field label="Cor da marca">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-11 w-14 cursor-pointer rounded-xl border border-border bg-surface p-1"
                    aria-label="Cor da marca"
                  />
                  <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} maxLength={7} />
                </div>
              </Field>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
            <div>
              <h2 className="font-bold">Horário de funcionamento</h2>
              <p className="text-xs text-muted">
                Para horários que passam da meia-noite, use fechamento menor que a abertura (ex: 18:00 às 00:30).
              </p>
            </div>
            <ul className="divide-y divide-border">
              {DAYS.map(({ key, label }) => (
                <li key={key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3">
                    <Switch
                      aria-label={`Aberto ${label}`}
                      checked={hours[key].enabled}
                      onCheckedChange={(enabled) => updateDay(key, { enabled })}
                    />
                    <span className="w-32 text-sm font-medium">{label}</span>
                  </div>
                  {hours[key].enabled ? (
                    <div className="flex items-center gap-2 text-sm">
                      <Input
                        type="time"
                        value={hours[key].open}
                        onChange={(e) => updateDay(key, { open: e.target.value })}
                        className="w-28"
                        aria-label={`Abertura ${label}`}
                        required
                      />
                      <span className="text-muted">às</span>
                      <Input
                        type="time"
                        value={hours[key].close}
                        onChange={(e) => updateDay(key, { close: e.target.value })}
                        className="w-28"
                        aria-label={`Fechamento ${label}`}
                        required
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-muted">Fechado</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </fieldset>

        {error ? <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-400">{error}</p> : null}
        {saved ? (
          <p className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-400">
            <Check className="h-4 w-4" /> Configurações salvas.
          </p>
        ) : null}

        <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={readOnly || isPending}>
          {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          Salvar configurações
        </Button>
      </form>
    </div>
  );
}
