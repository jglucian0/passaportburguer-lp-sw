/*
 * Sincroniza as descrições dos produtos do banco com as de seed-menu.ts (casando por
 * categoria + nome). Só altera `description`; preços, adicionais e o resto ficam intactos.
 *
 *   npm run db:sync-descriptions            # aplica
 *   npm run db:sync-descriptions -- --dry   # só mostra o que mudaria
 *   npm run db:sync-descriptions -- Sobremesas   # limita a uma categoria
 */
import { and, eq } from "drizzle-orm";

import { db } from "./index";
import { MENU } from "./seed-menu";
import { categories, products, tenants } from "./schema";

const TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG ?? "passaporteburguer";

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const onlyCategory = args.find((a) => !a.startsWith("--"));

  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, TENANT_SLUG)).limit(1);
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" não encontrado.`);

  let changed = 0;
  for (const category of MENU) {
    if (onlyCategory && category.name !== onlyCategory) continue;

    const [cat] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.tenantId, tenant.id), eq(categories.name, category.name)))
      .limit(1);
    if (!cat) {
      console.log(`! Categoria "${category.name}" não está no banco, ignorada.`);
      continue;
    }

    for (const product of category.products) {
      const description = product.description ?? null;
      const [row] = await db
        .select({ id: products.id, description: products.description })
        .from(products)
        .where(and(eq(products.tenantId, tenant.id), eq(products.categoryId, cat.id), eq(products.name, product.name)))
        .limit(1);
      if (!row) {
        console.log(`! "${product.name}" não está no banco (use db:add-item).`);
        continue;
      }
      if (row.description === description) continue;

      changed++;
      console.log(`${dry ? "[dry] " : ""}~ ${category.name} / ${product.name}`);
      if (!dry) await db.update(products).set({ description }).where(eq(products.id, row.id));
    }
  }

  console.log(changed === 0 ? "Nada a atualizar." : `${changed} descrição(ões) ${dry ? "seriam atualizadas" : "atualizadas"}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
