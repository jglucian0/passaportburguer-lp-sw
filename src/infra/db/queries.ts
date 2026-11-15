import { and, asc, eq } from "drizzle-orm";

import type {
  CatalogAddonGroup,
  CatalogCategory,
  CatalogDeliveryZone,
} from "@/core/schemas/product";

import { db } from "./index";
import { addonGroups, addons, categories, deliveryZones, products } from "./schema";

export type CatalogCategoryWithStatus = CatalogCategory & { isActive: boolean };

/** Carrega categorias > produtos > grupos de adicionais > adicionais de um tenant. */
export async function loadCatalog(
  tenantId: string,
  options: { includeInactiveCategories?: boolean } = {},
): Promise<CatalogCategoryWithStatus[]> {
  const categoryFilter = options.includeInactiveCategories
    ? eq(categories.tenantId, tenantId)
    : and(eq(categories.tenantId, tenantId), eq(categories.isActive, true));

  const [cats, prods, groups, adds] = await Promise.all([
    db.select().from(categories).where(categoryFilter).orderBy(asc(categories.sortOrder), asc(categories.name)),
    db.select().from(products).where(eq(products.tenantId, tenantId)).orderBy(asc(products.sortOrder), asc(products.name)),
    db.select().from(addonGroups).where(eq(addonGroups.tenantId, tenantId)).orderBy(asc(addonGroups.sortOrder)),
    db.select().from(addons).where(eq(addons.tenantId, tenantId)).orderBy(asc(addons.name)),
  ]);

  const groupsByProduct = new Map<string, CatalogAddonGroup[]>();
  const groupById = new Map<string, CatalogAddonGroup>();

  for (const g of groups) {
    const group: CatalogAddonGroup = {
      id: g.id,
      name: g.name,
      minSelections: g.minSelections,
      maxSelections: g.maxSelections,
      sortOrder: g.sortOrder,
      addons: [],
    };
    groupById.set(g.id, group);
    const list = groupsByProduct.get(g.productId) ?? [];
    list.push(group);
    groupsByProduct.set(g.productId, list);
  }

  for (const a of adds) {
    groupById.get(a.addonGroupId)?.addons.push({
      id: a.id,
      name: a.name,
      priceCents: a.priceCents,
      maxQuantity: a.maxQuantity,
      isAvailable: a.isAvailable,
    });
  }

  const result = new Map<string, CatalogCategoryWithStatus>(
    cats.map((c) => [
      c.id,
      { id: c.id, name: c.name, sortOrder: c.sortOrder, isActive: c.isActive, products: [] },
    ]),
  );

  for (const p of prods) {
    result.get(p.categoryId)?.products.push({
      id: p.id,
      categoryId: p.categoryId,
      name: p.name,
      description: p.description,
      priceCents: p.priceCents,
      imageUrl: p.imageUrl,
      isAvailable: p.isAvailable,
      isFeatured: p.isFeatured,
      sortOrder: p.sortOrder,
      addonGroups: groupsByProduct.get(p.id) ?? [],
    });
  }

  return [...result.values()];
}

export async function loadDeliveryZones(
  tenantId: string,
  options: { includeInactive?: boolean } = {},
): Promise<CatalogDeliveryZone[]> {
  const filter = options.includeInactive
    ? eq(deliveryZones.tenantId, tenantId)
    : and(eq(deliveryZones.tenantId, tenantId), eq(deliveryZones.isActive, true));

  const rows = await db.select().from(deliveryZones).where(filter).orderBy(asc(deliveryZones.neighborhood));

  return rows.map((z) => ({
    id: z.id,
    neighborhood: z.neighborhood,
    feeCents: z.feeCents,
    estimatedMinutes: z.estimatedMinutes,
    isActive: z.isActive,
  }));
}
