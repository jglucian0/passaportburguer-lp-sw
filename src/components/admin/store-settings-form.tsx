"use client";

import { Clock, Loader2, Store } from "lucide-react";
import { useCallback, useState } from "react";

import { saveStoreSettings, type AdminStoreSettings } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { AdminRole } from "@/core/schemas/common";
import type { OpeningHours } from "@/core/store/opening-hours";
import { formatPhone } from "@/lib/utils";

import { ImageUpload } from "./image-upload";
import { centsToReais, reaisToCents } from "./money";
import { Toast, type ToastState } from "./toast";
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

const inputCls = "border-slate-300 bg-white text-slate-900";
const cardCls = "space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

/**
 * White-label (versão SaaS): nome, logo e cor da marca por loja.
 * DESLIGADO neste projeto (hamburgueria única: nome, logo e cores são fixos).
 * Para habilitar no SaaS, troque para `true`. Os dados continuam sendo carregados e salvos normalmente.
 */
const ENABLE_WHITE_LABEL = false;

export function StoreSettingsForm({
  settings,
  role,
  children,
}: {
  settings: AdminStoreSettings;
  role: AdminRole;
  /** Cards adicionais (ex.: equipe) renderizados abaixo, fora do formulário. */
  children?: React.ReactNode;
}) {
  const { run, isPending, error, setError } = useRunAction();
  const [toast, setToast] = useState<ToastState>(null);
  const dismiss = useCallback(() => setToast(null), []);

  const [name, setName] = useState(settings.name);
  const [phone, setPhone] = useState(formatPhone((settings.phoneWhatsapp ?? "").replace(/^55/, "")));
  const [address, setAddress] = useState(settings.address ?? "");
  const [logoUrl, setLogoUrl] = useState<string | null>(settings.logoUrl);
  const [primaryColor, setPrimaryColor] = useState(settings.primaryColor);
  const [minOrder, setMinOrder] = useState(centsToReais(settings.minOrderCents));
  const [autoAccept, setAutoAccept] = useState(settings.autoAcceptOrders);
  const [etaMinutes, setEtaMinutes] = useState(String(settings.estimatedDeliveryMinutes));
  const [hours, setHours] = useState<OpeningHours>(settings.openingHours);

  const readOnly = role !== "OWNER";

  function updateDay(key: keyof OpeningHours, patch: Partial<OpeningHours[keyof OpeningHours]>) {
    setHours((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function fail(message: string) {
    setError(message);
    setToast({ kind: "error", message });
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const minOrderCents = reaisToCents(minOrder);
    if (minOrderCents === null) return fail("Pedido mínimo inválido (ex: 33,00).");

    const estimatedDeliveryMinutes = Number(etaMinutes);
    if (!Number.isInteger(estimatedDeliveryMinutes) || estimatedDeliveryMinutes < 5 || estimatedDeliveryMinutes > 240) {
      return fail("Tempo estimado deve ficar entre 5 e 240 minutos.");
    }

    run(
      () =>
        saveStoreSettings({
          name,
          phoneWhatsapp: phone.trim() ? phone : null,
          address: address.trim() || null,
          logoUrl,
          primaryColor,
          minOrderCents,
          autoAcceptOrders: autoAccept,
          estimatedDeliveryMinutes,
          openingHours: hours,
        }),
      () => setToast({ kind: "success", message: "Configurações salvas com sucesso." }),
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-24">
      <Toast toast={toast} onDismiss={dismiss} />
      <h1 className="text-2xl font-extrabold text-slate-900">Configurações da loja</h1>

      {readOnly ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-700">
          Apenas o proprietário pode alterar as configurações abaixo.
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-6">
        <fieldset disabled={readOnly || isPending} className="space-y-6 disabled:opacity-70">
          <section className={cardCls}>
            <h2 className="flex items-center gap-2 font-bold text-slate-900">
              <Store className="h-5 w-5 text-slate-400" /> Dados da loja
            </h2>
            {ENABLE_WHITE_LABEL ? <ImageUpload value={logoUrl} onChange={setLogoUrl} folder="logo" /> : null}
            {ENABLE_WHITE_LABEL ? (
              <Field label="Nome da loja">
                <Input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
              </Field>
            ) : null}
            <div className={ENABLE_WHITE_LABEL ? "grid gap-4 sm:grid-cols-3" : "grid gap-4 sm:grid-cols-2"}>
              <Field label="WhatsApp oficial">
                <Input
                  className={inputCls}
                  value={phone}
                  onChange={(e) => setPhone(formatPhone(e.target.value))}
                  inputMode="tel"
                  placeholder="(44) 99833-3450"
                />
              </Field>
              <Field label="Pedido mínimo (R$)">
                <Input
                  className={inputCls}
                  value={minOrder}
                  onChange={(e) => setMinOrder(e.target.value)}
                  inputMode="decimal"
                  placeholder="33,00"
                  required
                />
              </Field>
              {ENABLE_WHITE_LABEL ? (
              <Field label="Cor da marca">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-11 w-14 cursor-pointer rounded-xl border border-slate-300 bg-white p-1"
                    aria-label="Cor da marca"
                  />
                  <Input className={inputCls} value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} maxLength={7} />
                </div>
              </Field>
              ) : null}
            </div>
            <Field label="Endereço físico">
              <Input
                className={inputCls}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                maxLength={200}
                placeholder="Av. São Paulo, 123 - Zona 07, Maringá - PR"
              />
            </Field>

            <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Aceitar pedidos automaticamente</p>
                  <p className="text-xs text-slate-500">Pedidos pagos entram direto em preparo.</p>
                </div>
                <Switch aria-label="Aceitar pedidos automaticamente" checked={autoAccept} onCheckedChange={setAutoAccept} />
              </div>
              <Field label="Tempo estimado padrão (min)">
                <Input
                  className={`${inputCls} sm:w-40`}
                  value={etaMinutes}
                  onChange={(e) => setEtaMinutes(e.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                />
              </Field>
            </div>
          </section>

          <section className={cardCls}>
            <div>
              <h2 className="flex items-center gap-2 font-bold text-slate-900">
                <Clock className="h-5 w-5 text-slate-400" /> Horários de funcionamento
              </h2>
              <p className="text-xs text-slate-500">
                Para horários que passam da meia-noite, use fechamento menor que a abertura (ex: 18:00 às 00:30).
              </p>
            </div>
            <ul className="divide-y divide-slate-100">
              {DAYS.map(({ key, label }) => (
                <li key={key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3">
                    <Switch
                      aria-label={`Aberto ${label}`}
                      checked={hours[key].enabled}
                      onCheckedChange={(enabled) => updateDay(key, { enabled })}
                    />
                    <span className="w-32 text-sm font-medium text-slate-800">{label}</span>
                  </div>
                  {hours[key].enabled ? (
                    <div className="flex items-center gap-2 text-sm">
                      <Input
                        type="time"
                        value={hours[key].open}
                        onChange={(e) => updateDay(key, { open: e.target.value })}
                        className={`${inputCls} w-28`}
                        aria-label={`Abertura ${label}`}
                        required
                      />
                      <span className="text-slate-500">às</span>
                      <Input
                        type="time"
                        value={hours[key].close}
                        onChange={(e) => updateDay(key, { close: e.target.value })}
                        className={`${inputCls} w-28`}
                        aria-label={`Fechamento ${label}`}
                        required
                      />
                    </div>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">Fechado</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </fieldset>

        {/* Barra fixa: acompanha a rolagem em todas as larguras (acima da navegação inferior no mobile). */}
        <div className="fixed inset-x-0 bottom-14 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:bottom-0">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm text-red-600">{error}</p>
            <Button type="submit" size="lg" disabled={readOnly || isPending}>
              {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
              Salvar Configurações
            </Button>
          </div>
        </div>
      </form>

      {children}
    </div>
  );
}
