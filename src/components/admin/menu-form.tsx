"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

import { deleteCategory, deleteProduct, saveCategory, saveProduct } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { CatalogProduct } from "@/core/schemas/product";

import { ImageUpload } from "./image-upload";
import { centsToReais, reaisToCents } from "./money";
import { useRunAction } from "./use-run-action";

type CategoryOption = { id: string; name: string };

/* ------------------------------------------------------------------ */
/* Categoria                                                           */
/* ------------------------------------------------------------------ */

export function CategoryForm({
  category,
  onDone,
}: {
  category: { id: string; name: string; sortOrder: number; isActive: boolean } | null;
  onDone: () => void;
}) {
  const { run, isPending, error } = useRunAction();
  const [name, setName] = useState(category?.name ?? "");
  const [sortOrder, setSortOrder] = useState(String(category?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(category?.isActive ?? true);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    run(
      () => saveCategory({ id: category?.id, name, sortOrder: Number(sortOrder) || 0, isActive }),
      onDone,
    );
  }

  function handleDelete() {
    if (!category) return;
    if (!window.confirm("Excluir a categoria e TODOS os produtos dela? Esta ação não pode ser desfeita.")) return;
    run(() => deleteCategory({ id: category.id }), onDone);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 pt-14">
      <h2 className="text-lg font-extrabold">{category ? "Editar categoria" : "Nova categoria"}</h2>
      <Field label="Nome">
        <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
      </Field>
      <Field label="Ordem de exibição">
        <Input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
      </Field>
      <label className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2.5 text-sm font-medium">
        Categoria ativa (visível no cardápio)
        <Switch checked={isActive} onCheckedChange={setIsActive} />
      </label>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Salvar
        </Button>
        {category ? (
          <Button type="button" variant="danger" size="icon" aria-label="Excluir categoria" disabled={isPending} onClick={handleDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Produto                                                             */
/* ------------------------------------------------------------------ */

export function ProductForm({
  product,
  defaultCategoryId,
  categories,
  onSaved,
  onDeleted,
}: {
  product: CatalogProduct | null;
  defaultCategoryId: string;
  categories: CategoryOption[];
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const { run, isPending, error, setError } = useRunAction();
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [price, setPrice] = useState(product ? centsToReais(product.priceCents) : "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? defaultCategoryId);
  const [imageUrl, setImageUrl] = useState<string | null>(product?.imageUrl ?? null);
  const [isAvailable, setIsAvailable] = useState(product?.isAvailable ?? true);
  const [isFeatured, setIsFeatured] = useState(product?.isFeatured ?? false);
  const [sortOrder, setSortOrder] = useState(String(product?.sortOrder ?? 0));

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const priceCents = reaisToCents(price);
    if (priceCents === null) {
      setError("Informe um preço válido (ex: 35,90).");
      return;
    }
    run(
      () =>
        saveProduct({
          id: product?.id,
          categoryId,
          name,
          description: description || null,
          priceCents,
          imageUrl,
          isAvailable,
          isFeatured,
          sortOrder: Number(sortOrder) || 0,
        }),
      (data) => onSaved(data.id),
    );
  }

  function handleDelete() {
    if (!product) return;
    if (!window.confirm(`Excluir "${product.name}"? Esta ação não pode ser desfeita.`)) return;
    run(() => deleteProduct({ id: product.id }), onDeleted);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 pt-14">
      <h2 className="text-lg font-extrabold">{product ? "Editar produto" : "Novo produto"}</h2>

      <ImageUpload value={imageUrl} onChange={setImageUrl} />

      <Field label="Nome">
        <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
      </Field>
      <Field label="Descrição">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Preço (R$)">
          <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="35,90" required />
        </Field>
        <Field label="Ordem">
          <Input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
      </div>
      <Field label="Categoria">
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <label className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2.5 text-sm font-medium">
        Disponível para venda
        <Switch checked={isAvailable} onCheckedChange={setIsAvailable} />
      </label>
      <label className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2.5 text-sm font-medium">
        Destaque na landing page
        <Switch checked={isFeatured} onCheckedChange={setIsFeatured} />
      </label>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {product ? "Salvar alterações" : "Criar produto"}
        </Button>
        {product ? (
          <Button type="button" variant="danger" size="icon" aria-label="Excluir produto" disabled={isPending} onClick={handleDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </form>
  );
}
