"use client";

import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  deleteAddon,
  deleteAddonGroup,
  saveAddon,
  saveAddonGroup,
  toggleAddonAvailability,
} from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { CatalogAddon, CatalogAddonGroup, CatalogProduct } from "@/core/schemas/product";
import { formatCents } from "@/lib/utils";

import { centsToReais, reaisToCents } from "./money";
import { useRunAction } from "./use-run-action";

/* ------------------------------ Grupo ------------------------------ */

function GroupForm({
  productId,
  group,
  onDone,
}: {
  productId: string;
  group: CatalogAddonGroup | null;
  onDone: () => void;
}) {
  const { run, isPending, error } = useRunAction();
  const [name, setName] = useState(group?.name ?? "");
  const [min, setMin] = useState(String(group?.minSelections ?? 0));
  const [max, setMax] = useState(String(group?.maxSelections ?? 1));
  const [sortOrder, setSortOrder] = useState(String(group?.sortOrder ?? 0));

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    run(
      () =>
        saveAddonGroup({
          id: group?.id,
          productId,
          name,
          minSelections: Number(min) || 0,
          maxSelections: Number(max) || 1,
          sortOrder: Number(sortOrder) || 0,
        }),
      onDone,
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-brand/40 bg-surface-2 p-3">
      <Field label="Nome do grupo">
        <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ex: Ponto da carne" />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Mínimo">
          <Input type="number" min={0} max={20} value={min} onChange={(e) => setMin(e.target.value)} />
        </Field>
        <Field label="Máximo">
          <Input type="number" min={1} max={20} value={max} onChange={(e) => setMax(e.target.value)} />
        </Field>
        <Field label="Ordem">
          <Input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Salvar grupo
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/* ---------------------------- Adicional ---------------------------- */

function AddonForm({
  groupId,
  groupMax,
  addon,
  onDone,
}: {
  groupId: string;
  groupMax: number;
  addon: CatalogAddon | null;
  onDone: () => void;
}) {
  const { run, isPending, error, setError } = useRunAction();
  const [name, setName] = useState(addon?.name ?? "");
  const [price, setPrice] = useState(addon ? centsToReais(addon.priceCents) : "0,00");
  const [maxQuantity, setMaxQuantity] = useState(String(addon?.maxQuantity ?? 1));

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const priceCents = reaisToCents(price);
    if (priceCents === null) {
      setError("Preço inválido.");
      return;
    }
    run(
      () =>
        saveAddon({
          id: addon?.id,
          addonGroupId: groupId,
          name,
          priceCents,
          maxQuantity: Math.min(Math.max(Number(maxQuantity) || 1, 1), groupMax),
          isAvailable: addon?.isAvailable ?? true,
        }),
      onDone,
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-lg border border-brand/40 p-2.5">
      <div className="grid grid-cols-4 gap-2">
        <div className="col-span-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Nome" aria-label="Nome do adicional" />
        </div>
        <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0,00" aria-label="Preço" />
        <Input
          type="number"
          min={1}
          max={groupMax}
          value={maxQuantity}
          onChange={(e) => setMaxQuantity(e.target.value)}
          aria-label="Máximo por item"
          title="Máximo por item"
        />
      </div>
      <p className="text-[11px] text-muted">Nome • preço • máximo por item (o grupo limita o total).</p>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Salvar
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function AddonRow({ addon, onEdit }: { addon: CatalogAddon; onEdit: () => void }) {
  const { run, isPending, error } = useRunAction();

  return (
    <li className="space-y-1 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{addon.name}</p>
          <p className="text-xs text-muted">
            {addon.priceCents > 0 ? `+ ${formatCents(addon.priceCents)}` : "Grátis"}
            {addon.maxQuantity > 1 ? ` • até ${addon.maxQuantity}x` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Switch
            aria-label={`Disponibilidade de ${addon.name}`}
            checked={addon.isAvailable}
            disabled={isPending}
            onCheckedChange={(checked) => run(() => toggleAddonAvailability({ id: addon.id, isAvailable: checked }))}
          />
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Editar adicional" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-red-400"
            aria-label="Excluir adicional"
            disabled={isPending}
            onClick={() => {
              if (window.confirm(`Excluir o adicional "${addon.name}"?`)) run(() => deleteAddon({ id: addon.id }));
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </li>
  );
}

/* ----------------------------- Gerenciador ----------------------------- */

export function AddonManager({ product }: { product: CatalogProduct }) {
  const { run, isPending, error } = useRunAction();
  const [editingGroup, setEditingGroup] = useState<string | "new" | null>(null);
  const [editingAddon, setEditingAddon] = useState<{ groupId: string; addonId: string | "new" } | null>(null);

  const groups = [...product.addonGroups].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <section className="space-y-3 border-t border-border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">Grupos de adicionais</h3>
        <Button variant="outline" size="sm" onClick={() => setEditingGroup("new")}>
          <Plus className="h-4 w-4" /> Grupo
        </Button>
      </div>

      {error ? <p className="text-xs text-red-400">{error}</p> : null}

      {editingGroup === "new" ? (
        <GroupForm productId={product.id} group={null} onDone={() => setEditingGroup(null)} />
      ) : null}

      {groups.length === 0 && editingGroup !== "new" ? (
        <p className="text-xs text-muted">Nenhum grupo. Ex: &quot;Ponto da carne&quot; (1 a 1) ou &quot;Adicionais&quot; (0 a 3).</p>
      ) : null}

      {groups.map((group) => (
        <div key={group.id} className="space-y-2 rounded-xl border border-border p-3">
          {editingGroup === group.id ? (
            <GroupForm productId={product.id} group={group} onDone={() => setEditingGroup(null)} />
          ) : (
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{group.name}</p>
                <p className="text-xs text-muted">
                  Mínimo {group.minSelections} • Máximo {group.maxSelections}
                </p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Editar grupo" onClick={() => setEditingGroup(group.id)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-red-400"
                  aria-label="Excluir grupo"
                  disabled={isPending}
                  onClick={() => {
                    if (window.confirm(`Excluir o grupo "${group.name}" e seus adicionais?`)) {
                      run(() => deleteAddonGroup({ id: group.id }));
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          <ul className="divide-y divide-border">
            {group.addons.map((addon) =>
              editingAddon?.groupId === group.id && editingAddon.addonId === addon.id ? (
                <li key={addon.id} className="py-2">
                  <AddonForm
                    groupId={group.id}
                    groupMax={group.maxSelections}
                    addon={addon}
                    onDone={() => setEditingAddon(null)}
                  />
                </li>
              ) : (
                <AddonRow
                  key={addon.id}
                  addon={addon}
                  onEdit={() => setEditingAddon({ groupId: group.id, addonId: addon.id })}
                />
              ),
            )}
          </ul>

          {editingAddon?.groupId === group.id && editingAddon.addonId === "new" ? (
            <AddonForm
              groupId={group.id}
              groupMax={group.maxSelections}
              addon={null}
              onDone={() => setEditingAddon(null)}
            />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditingAddon({ groupId: group.id, addonId: "new" })}
            >
              <Plus className="h-4 w-4" /> Adicional
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
