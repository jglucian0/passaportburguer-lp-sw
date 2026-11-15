import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { DELIVERY_ZONES } from "@/core/store/maringa-zones";

import { db } from "./index";
import { MENU } from "./seed-menu";
import {
  addonGroups,
  addons,
  adminUsers,
  categories,
  deliveryZones,
  products,
  tenants,
  type NewAddon,
  type NewAddonGroup,
  type NewProduct,
  type OpeningHours,
} from "./schema";

const TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG ?? "passaportburguer";

/** Terça a Domingo, 18h às 23h (perfil público da loja). */
const openingHours: OpeningHours = {
  "0": { enabled: true, open: "18:00", close: "23:00" },
  "1": { enabled: false, open: "18:00", close: "23:00" },
  "2": { enabled: true, open: "18:00", close: "23:00" },
  "3": { enabled: true, open: "18:00", close: "23:00" },
  "4": { enabled: true, open: "18:00", close: "23:00" },
  "5": { enabled: true, open: "18:00", close: "23:00" },
  "6": { enabled: true, open: "18:00", close: "23:00" },
};

async function main() {
  const existing = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, TENANT_SLUG))
    .limit(1);

  if (existing.length > 0) {
    console.log(`Seed ignorado: tenant "${TENANT_SLUG}" já existe.`);
    return;
  }

  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@passaportburguer.com.br").toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length < 8) {
    throw new Error("Defina SEED_ADMIN_PASSWORD com no mínimo 8 caracteres.");
  }

  /* ----------------------------- Tenant ----------------------------- */

  const [tenant] = await db
    .insert(tenants)
    .values({
      name: "Passaporte Burguer",
      slug: TENANT_SLUG,
      customDomain: "passaportburguer.com.br",
      phoneWhatsapp: "5544999999999",
      primaryColor: "#f5a623",
      minOrderCents: 0,
      isManuallyClosed: false,
      openingHours,
    })
    .returning();

  await db.insert(adminUsers).values({
    tenantId: tenant.id,
    name: process.env.SEED_ADMIN_NAME ?? "Administrador",
    email: adminEmail,
    passwordHash: await bcrypt.hash(adminPassword, 10),
    role: "OWNER",
  });

  /* ---------------------------- Categorias --------------------------- */

  const categoryRows = await db
    .insert(categories)
    .values(
      MENU.map((category, index) => ({
        tenantId: tenant.id,
        name: category.name,
        sortOrder: index + 1,
      })),
    )
    .returning({ id: categories.id, name: categories.name });

  const categoryIdByName = new Map(categoryRows.map((row) => [row.name, row.id]));

  /* ----------------------------- Produtos ---------------------------- */

  const productValues: NewProduct[] = [];
  for (const category of MENU) {
    const categoryId = categoryIdByName.get(category.name);
    if (!categoryId) throw new Error(`Categoria não inserida: ${category.name}`);

    category.products.forEach((product, index) => {
      productValues.push({
        tenantId: tenant.id,
        categoryId,
        name: product.name,
        description: product.description ?? null,
        priceCents: product.priceCents,
        isFeatured: product.featured ?? false,
        sortOrder: index + 1,
      });
    });
  }

  const productRows = await db
    .insert(products)
    .values(productValues)
    .returning({ id: products.id, name: products.name });

  const productIdByName = new Map(productRows.map((row) => [row.name, row.id]));

  /* --------------------- Grupos de adicionais ------------------------ */

  const groupValues: NewAddonGroup[] = [];
  /** Chave composta: os nomes de grupo se repetem entre produtos. */
  const groupKeys: string[] = [];

  for (const category of MENU) {
    for (const product of category.products) {
      const productId = productIdByName.get(product.name);
      if (!productId) throw new Error(`Produto não inserido: ${product.name}`);

      (product.groups ?? []).forEach((group, index) => {
        groupValues.push({
          tenantId: tenant.id,
          productId,
          name: group.name,
          minSelections: group.min,
          maxSelections: group.max,
          sortOrder: index + 1,
        });
        groupKeys.push(`${product.name}|${group.name}`);
      });
    }
  }

  const groupRows = await db
    .insert(addonGroups)
    .values(groupValues)
    .returning({ id: addonGroups.id });

  // O Postgres devolve as linhas de um INSERT ... VALUES na ordem enviada.
  const groupIdByKey = new Map(groupKeys.map((key, index) => [key, groupRows[index].id]));

  /* -------------------------- Adicionais ----------------------------- */

  const addonValues: NewAddon[] = [];

  for (const category of MENU) {
    for (const product of category.products) {
      for (const group of product.groups ?? []) {
        const addonGroupId = groupIdByKey.get(`${product.name}|${group.name}`);
        if (!addonGroupId) throw new Error(`Grupo não inserido: ${product.name} / ${group.name}`);

        for (const addon of group.addons) {
          addonValues.push({
            tenantId: tenant.id,
            addonGroupId,
            name: addon.name,
            priceCents: addon.priceCents,
            // O total do grupo já limita; o máximo por item nunca pode superá-lo.
            maxQuantity: Math.min(addon.max ?? 1, group.max),
          });
        }
      }
    }
  }

  await db.insert(addons).values(addonValues);

  /* ---------------------------- Entregas ----------------------------- */

  await db.insert(deliveryZones).values(
    DELIVERY_ZONES.map((z) => ({
      tenantId: tenant.id,
      neighborhood: z.name,
      feeCents: z.feeCents,
      estimatedMinutes: z.estimatedMinutes,
    })),
  );
  console.log(
    [
      `Seed concluído. Tenant: ${tenant.slug} | Admin: ${adminEmail}`,
      `Categorias: ${categoryRows.length} | Produtos: ${productRows.length}`,
      `Grupos: ${groupRows.length} | Adicionais: ${addonValues.length}`,
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
