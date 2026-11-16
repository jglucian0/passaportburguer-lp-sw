/*
 * Adiciona ao banco (sem recriar nada) um produto que já está em seed-menu.ts.
 * O seed normal é ignorado quando o tenant já existe; use este script para itens novos.
 *
 *   npm run db:add-item -- "Gwangju"
 *
 * Idempotente: se o produto já existir na categoria, não faz nada.
 */
import { and, eq } from "drizzle-orm";

import { db } from "./index";
import { MENU } from "./seed-menu";
import { addonGroups, addons, categories, products, tenants } from "./schema";

const TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG ?? "passaportburguer";

async function main() {
  const name = process.argv[2];
  if (!name) throw new Error('Informe o nome do produto: npm run db:add-item -- "Gwangju"');

  const category = MENU.find((c) => c.products.some((p) => p.name === name));
  const product = category?.products.find((p) => p.name === name);
  if (!category || !product) throw new Error(`"${name}" não existe em seed-menu.ts.`);

  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, TENANT_SLUG)).limit(1);
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" não encontrado.`);

  const [cat] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.tenantId, tenant.id), eq(categories.name, category.name)))
    .limit(1);
  if (!cat) throw new Error(`Categoria "${category.name}" não encontrada no banco.`);

  const [exists] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.tenantId, tenant.id), eq(products.categoryId, cat.id), eq(products.name, name)))
    .limit(1);
  if (exists) {
    console.log(`"${name}" já existe. Nada a fazer.`);
    return;
  }

  const sortOrder = category.products.indexOf(product) + 1;
  const [row] = await db
    .insert(products)
    .values({
      tenantId: tenant.id,
      categoryId: cat.id,
      name,
      description: product.description ?? null,
      priceCents: product.priceCents,
      isFeatured: product.featured ?? false,
      sortOrder,
    })
    .returning({ id: products.id });

  for (const [gi, group] of (product.groups ?? []).entries()) {
    const [g] = await db
      .insert(addonGroups)
      .values({
        tenantId: tenant.id,
        productId: row.id,
        name: group.name,
        minSelections: group.min,
        maxSelections: group.max,
        sortOrder: gi + 1,
      })
      .returning({ id: addonGroups.id });

    if (group.addons.length > 0) {
      await db.insert(addons).values(
        group.addons.map((a) => ({
          tenantId: tenant.id,
          addonGroupId: g.id,
          name: a.name,
          priceCents: a.priceCents,
          maxQuantity: Math.min(a.max ?? 1, group.max),
        })),
      );
    }
  }

  console.log(`"${name}" adicionado em "${category.name}" (R$ ${(product.priceCents / 100).toFixed(2)}).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
