"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { deleteDeliveryZone, saveDeliveryZone } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { CatalogDeliveryZone } from "@/core/schemas/product";

import { centsToReais, reaisToCents } from "./money";
import { useRunAction } from "./use-run-action";

function ZoneRow({ zone, onCreated }: { zone: CatalogDeliveryZone | null; onCreated?: () => void }) {
  const { run, isPending, error, setError } = useRunAction();
  const [neighborhood, setNeighborhood] = useState(zone?.neighborhood ?? "");
  const [fee, setFee] = useState(zone ? centsToReais(zone.feeCents) : "");
  const [minutes, setMinutes] = useState(String(zone?.estimatedMinutes ?? 40));
  const [isActive, setIsActive] = useState(zone?.isActive ?? true);

  function handleSave() {
    const feeCents = reaisToCents(fee);
    if (feeCents === null) {
      setError("Taxa inválida (ex: 7,00).");
      return;
    }
    run(
      () =>
        saveDeliveryZone({
          id: zone?.id,
          neighborhood,
          feeCents,
          estimatedMinutes: Number(minutes) || 40,
          isActive,
        }),
      () => {
        if (!zone) {
          setNeighborhood("");
          setFee("");
          setMinutes("40");
          setIsActive(true);
          onCreated?.();
        }
      },
    );
  }

  return (
    <li className="space-y-2 py-3">
      <div className="grid grid-cols-[1fr_auto] items-center gap-3 md:grid-cols-[2fr_1fr_1fr_auto_auto]">
        <Input
          value={neighborhood}
          onChange={(e) => setNeighborhood(e.target.value)}
          placeholder="Bairro"
          aria-label="Bairro"
          className="col-span-2 md:col-span-1"
        />
        <Input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" placeholder="Taxa (R$)" aria-label="Taxa de entrega" />
        <Input type="number" min={5} max={240} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Tempo estimado (min)" />
        <div className="flex items-center gap-2">
          <Switch aria-label="Bairro ativo" checked={isActive} onCheckedChange={setIsActive} />
          <span className="text-xs text-muted md:hidden">{isActive ? "Ativo" : "Inativo"}</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={isPending || !neighborhood.trim()} onClick={handleSave}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : zone ? null : <Plus className="h-4 w-4" />}
            {zone ? "Salvar" : "Adicionar"}
          </Button>
          {zone ? (
            <Button
              variant="ghost"
              size="icon"
              className="text-red-400"
              aria-label={`Excluir ${zone.neighborhood}`}
              disabled={isPending}
              onClick={() => {
                if (window.confirm(`Excluir o bairro "${zone.neighborhood}"?`)) run(() => deleteDeliveryZone({ id: zone.id }));
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </li>
  );
}

export function ZonesManager({ zones }: { zones: CatalogDeliveryZone[] }) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">Bairros e taxas de entrega</h1>
        <p className="mt-1 text-sm text-muted">
          Colunas: bairro, taxa (R$), tempo estimado (min) e status. Bairros inativos não aparecem no checkout.
        </p>
      </div>

      <section className="rounded-2xl border border-border bg-surface px-4">
        <ul className="divide-y divide-border">
          {zones.map((zone) => (
            <ZoneRow key={`${zone.id}-${zone.neighborhood}-${zone.feeCents}-${zone.estimatedMinutes}-${zone.isActive}`} zone={zone} />
          ))}
        </ul>
        {zones.length === 0 ? <p className="py-6 text-center text-sm text-muted">Nenhum bairro cadastrado.</p> : null}
      </section>

      <section className="rounded-2xl border border-dashed border-border bg-surface px-4">
        <h2 className="pt-4 text-sm font-bold">Novo bairro</h2>
        <ul>
          <ZoneRow zone={null} />
        </ul>
      </section>
    </div>
  );
}
