"use client";

import { ChevronDown, ImageOff, Pencil, Search, Settings2, Ticket, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
  quickEditProduct,
  toggleAddonAvailability,
  toggleAddonGroupAvailability,
  toggleProductAvailability,
} from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { AdminCoupon } from "@/actions/admin";
import type { AdminRole } from "@/core/schemas/common";
import type { CatalogAddon, CatalogAddonGroup, CatalogProduct } from "@/core/schemas/product";
import type { CatalogCategoryWithStatus } from "@/infra/db/queries";
import { cn, formatCents } from "@/lib/utils";

import { CouponsManager } from "./coupons-manager";
import { centsToReais, reaisToCents } from "./money";
import { useRunAction } from "./use-run-action";

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function StockSwitch({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span
        className={cn(
          "rounded-full px-2.5 py-0.5 text-xs font-semibold",
          checked ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
        )}
      >
        {checked ? "Disponível" : "Esgotado"}
      </span>
      <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function AddonRow({ addon }: { addon: CatalogAddon }) {
  const { run, isPending, error } = useRunAction();
  return (
    <li className="py-1.5">
      <div className="flex items-center gap-2">
        <p className={cn("min-w-0 flex-1 truncate text-sm", !addon.isAvailable && "text-muted line-through")}>
          {addon.name}
          {addon.priceCents > 0 ? (
            <span className="text-xs text-muted"> • +{formatCents(addon.priceCents)}</span>
          ) : null}
        </p>
        <StockSwitch
          checked={addon.isAvailable}
          label={`Disponibilidade de ${addon.name}`}
          disabled={isPending}
          onChange={(value) => run(() => toggleAddonAvailability({ id: addon.id, isAvailable: value }))}
        />
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </li>
  );
}

function GroupRow({ group }: { group: CatalogAddonGroup }) {
  const { run, isPending, error } = useRunAction();
  const [open, setOpen] = useState(false);
  const available = group.addons.length > 0 && group.addons.every((a) => a.isAvailable);
  const partial = !available && group.addons.some((a) => a.isAvailable);

  return (
    <li className="space-y-1 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-semibold"
          aria-expanded={open}
        >
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition", open && "rotate-180")} />
          <span className="truncate">{group.name}</span>
          <span className="shrink-0 text-xs font-normal text-muted">
            {group.addons.length} item(ns){partial ? " • parcial" : ""}
          </span>
        </button>
        <StockSwitch
          checked={available}
          label={`Disponibilidade do grupo ${group.name}`}
          disabled={isPending || group.addons.length === 0}
          onChange={(value) => run(() => toggleAddonGroupAvailability({ id: group.id, isAvailable: value }))}
        />
      </div>
      {open ? (
        <ul className="ml-5 divide-y divide-border/60 border-l border-border pl-3">
          {group.addons.map((addon) => (
            <AddonRow key={addon.id} addon={addon} />
          ))}
        </ul>
      ) : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </li>
  );
}

function QuickEdit({ product, onClose }: { product: CatalogProduct; onClose: () => void }) {
  const { run, isPending, error, setError } = useRunAction();
  const [price, setPrice] = useState(centsToReais(product.priceCents));
  const [description, setDescription] = useState(product.description ?? "");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const priceCents = reaisToCents(price);
    if (priceCents === null) {
      setError("Preço inválido (ex: 35,90).");
      return;
    }
    run(() => quickEditProduct({ id: product.id, priceCents, description }), onClose);
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-surface-2 p-3">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label="Preço (R$)">
          <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" required />
        </Field>
        <Field label="Descrição">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} />
        </Field>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          Salvar
        </Button>
      </div>
    </form>
  );
}

function ProductRow({
  product,
  category,
  canEdit,
}: {
  product: CatalogProduct;
  category: string;
  canEdit: boolean;
}) {
  const { run, isPending, error } = useRunAction();
  const [editing, setEditing] = useState(false);
  const [showGroups, setShowGroups] = useState(false);

  return (
    <li className="space-y-2 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 text-slate-400">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt={product.name}
              width={48}
              height={48}
              loading="lazy"
              className={cn("h-full w-full object-cover", !product.isAvailable && "opacity-50 grayscale")}
            />
          ) : (
            <ImageOff className="h-5 w-5" aria-label="Sem foto" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn("truncate font-semibold", !product.isAvailable && "text-muted line-through")}>
            {product.name}
          </p>
          <p className="truncate text-xs text-muted">
            <span className="font-semibold text-slate-700">{formatCents(product.priceCents)}</span>
            {category ? ` • ${category}` : ""}
          </p>
          {product.description ? <p className="truncate text-xs text-muted">{product.description}</p> : null}
        </div>
        <StockSwitch
          checked={product.isAvailable}
          label={`Disponibilidade de ${product.name}`}
          disabled={isPending}
          onChange={(value) => run(() => toggleProductAvailability({ id: product.id, isAvailable: value }))}
        />
        {canEdit ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            aria-label={`Editar preço e descrição de ${product.name}`}
            onClick={() => setEditing((v) => !v)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      {product.addonGroups.length > 0 ? (
        <button type="button" onClick={() => setShowGroups((v) => !v)} className="text-xs font-semibold text-brand">
          {showGroups ? "Ocultar" : "Ver"} {product.addonGroups.length} grupo(s) de adicionais
        </button>
      ) : null}
      {showGroups ? (
        <ul className="divide-y divide-border/60 rounded-xl bg-surface-2/50 px-3">
          {product.addonGroups.map((group) => (
            <GroupRow key={group.id} group={group} />
          ))}
        </ul>
      ) : null}
      {editing ? <QuickEdit product={product} onClose={() => setEditing(false)} /> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </li>
  );
}

export function AvailabilityBoard({
  categories,
  role,
  coupons,
}: {
  categories: CatalogCategoryWithStatus[];
  role: AdminRole;
  coupons: AdminCoupon[];
}) {
  const [tab, setTab] = useState<"menu" | "coupons">("menu");
  const [query, setQuery] = useState("");
  const [onlyOut, setOnlyOut] = useState(false);

  const visible = useMemo(() => {
    const q = normalize(query.trim());
    return categories
      .map((category) => ({
        ...category,
        products: category.products.filter((p) => {
          const allAvailable = p.isAvailable && p.addonGroups.every((g) => g.addons.every((a) => a.isAvailable));
          if (onlyOut && allAvailable) return false;
          if (!q) return true;
          return (
            normalize(p.name).includes(q) ||
            p.addonGroups.some(
              (g) => normalize(g.name).includes(q) || g.addons.some((a) => normalize(a.name).includes(q)),
            )
          );
        }),
      }))
      .filter((c) => c.products.length > 0);
  }, [categories, query, onlyOut]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Cardápio</h1>
          <p className="text-xs text-muted">
            {tab === "menu"
              ? "Pause itens em falta com 1 clique — reflete na loja na hora."
              : "Crie e controle os cupons promocionais da loja."}
          </p>
        </div>
        {role === "OWNER" ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/cardapio/gerenciar">
              <Settings2 className="h-4 w-4" /> Gerenciar cardápio
            </Link>
          </Button>
        ) : null}
      </div>

      {role === "OWNER" ? (
        <div
          role="tablist"
          aria-label="Seções do cardápio"
          className="flex w-fit rounded-xl border border-slate-200 bg-white p-1"
        >
          {(
            [
              { id: "menu", label: "Produtos", icon: UtensilsCrossed },
              { id: "coupons", label: `Cupons (${coupons.length})`, icon: Ticket },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition",
                tab === id ? "bg-brand text-black" : "text-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      ) : null}

      {tab === "coupons" && role === "OWNER" ? <CouponsManager coupons={coupons} /> : null}

      {tab === "menu" ? (
        <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar produto, grupo ou adicional…"
            className="pl-9"
            aria-label="Buscar no cardápio"
          />
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch checked={onlyOut} onCheckedChange={setOnlyOut} aria-label="Mostrar só esgotados" />
          Só esgotados
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted">
          Nada encontrado.
        </p>
      ) : null}

      {visible.map((category) => (
        <section key={category.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b border-border px-4 py-3 font-extrabold">{category.name}</h2>
          <ul className="divide-y divide-border px-4">
            {category.products.map((product) => (
              <ProductRow key={product.id} product={product} category={category.name} canEdit={role === "OWNER"} />
            ))}
          </ul>
        </section>
      ))}
        </>
      ) : null}
    </div>
  );
}
