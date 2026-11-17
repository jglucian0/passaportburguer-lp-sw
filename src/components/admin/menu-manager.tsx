"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { toggleProductAvailability } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import type { CatalogProduct } from "@/core/schemas/product";
import type { CatalogCategoryWithStatus } from "@/infra/db/queries";
import { cn, formatCents } from "@/lib/utils";

import { AddonManager } from "./addon-manager";
import { CategoryForm, ProductForm } from "./menu-form";
import { useRunAction } from "./use-run-action";

type Editing =
  | { kind: "category"; categoryId: string | null }
  | { kind: "product"; productId: string | null; categoryId: string }
  | null;

function ProductRow({ product, onEdit }: { product: CatalogProduct; onEdit: () => void }) {
  const { run, isPending, error } = useRunAction();

  return (
    <li className="space-y-1 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className={cn("truncate font-semibold", !product.isAvailable && "text-muted line-through")}>
            {product.name}
          </p>
          <p className="text-xs text-muted">
            {formatCents(product.priceCents)}
            {product.isFeatured ? " • Destaque" : ""}
            {product.addonGroups.length > 0 ? ` • ${product.addonGroups.length} grupo(s)` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-xs text-muted sm:block">{product.isAvailable ? "Ativo" : "Pausado"}</span>
          <Switch
            aria-label={`Pausa rápida de ${product.name}`}
            checked={product.isAvailable}
            disabled={isPending}
            onCheckedChange={(checked) => run(() => toggleProductAvailability({ id: product.id, isAvailable: checked }))}
          />
          <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`Editar ${product.name}`} onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </li>
  );
}

export function MenuManager({ categories }: { categories: CatalogCategoryWithStatus[] }) {
  const [editing, setEditing] = useState<Editing>(null);
  const close = () => setEditing(null);

  const allProducts = categories.flatMap((c) => c.products);
  const editingProduct =
    editing?.kind === "product" && editing.productId
      ? (allProducts.find((p) => p.id === editing.productId) ?? null)
      : null;
  const editingCategory =
    editing?.kind === "category" && editing.categoryId
      ? (categories.find((c) => c.id === editing.categoryId) ?? null)
      : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Cardápio</h1>
        <Button size="sm" onClick={() => setEditing({ kind: "category", categoryId: null })}>
          <Plus className="h-4 w-4" /> Nova categoria
        </Button>
      </div>

      {categories.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted">
          Nenhuma categoria cadastrada. Crie a primeira para começar.
        </p>
      ) : null}

      {categories.map((category) => (
        <section key={category.id} className="rounded-2xl border border-border bg-surface">
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate font-extrabold">{category.name}</h2>
              {!category.isActive ? (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">Oculta</span>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing({ kind: "category", categoryId: category.id })}
              >
                <Pencil className="h-4 w-4" /> Editar
              </Button>
              <Button
                size="sm"
                onClick={() => setEditing({ kind: "product", productId: null, categoryId: category.id })}
              >
                <Plus className="h-4 w-4" /> Produto
              </Button>
            </div>
          </header>

          {category.products.length === 0 ? (
            <p className="p-4 text-xs text-muted">Sem produtos nesta categoria.</p>
          ) : (
            <ul className="divide-y divide-border px-4">
              {category.products.map((product) => (
                <ProductRow
                  key={product.id}
                  product={product}
                  onEdit={() =>
                    setEditing({ kind: "product", productId: product.id, categoryId: category.id })
                  }
                />
              ))}
            </ul>
          )}
        </section>
      ))}

      <Sheet
        open={editing?.kind === "category"}
        onOpenChange={(open) => !open && close()}
        title="Categoria"
        side="right"
      >
        {editing?.kind === "category" ? (
          <div className="flex-1 overflow-y-auto">
            <CategoryForm
              key={editing.categoryId ?? "new"}
              category={editingCategory}
              onDone={close}
            />
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={editing?.kind === "product"}
        onOpenChange={(open) => !open && close()}
        title="Produto"
        side="right"
      >
        {editing?.kind === "product" ? (
          <div className="flex-1 overflow-y-auto">
            <ProductForm
              key={`product-${editing.productId ?? "new"}`}
              product={editingProduct}
              defaultCategoryId={editing.categoryId}
              categories={categories.map((c) => ({ id: c.id, name: c.name }))}
              // Após criar, mantém o painel aberto no produto novo para cadastrar adicionais.
              onSaved={(id) =>
                setEditing((prev) =>
                  prev?.kind === "product" && !prev.productId
                    ? { kind: "product", productId: id, categoryId: prev.categoryId }
                    : prev,
                )
              }
              onDeleted={close}
            />
            {editingProduct ? (
              <AddonManager key={`addons-${editingProduct.id}`} product={editingProduct} />
            ) : (
              <p className="border-t border-border p-4 text-xs text-muted">
                Salve o produto para cadastrar grupos de adicionais.
              </p>
            )}
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
