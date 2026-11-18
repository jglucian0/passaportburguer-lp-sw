/**
 * Cadastra no banco os bairros de `src/core/store/maringa-zones.ts` que ainda não
 * existem para o tenant. Nunca altera taxa/tempo de bairros já cadastrados
 * (ajustes feitos no painel admin são preservados).
 *
 * Uso: npm run db:seed-zones
 */
import { eq } from "drizzle-orm";

import { DELIVERY_ZONES } from "@/core/store/maringa-zones";

import { db } from "./index";
import { deliveryZones, tenants } from "./schema";

const TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG ?? "passaporteburguer";

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

async function main() {
  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, TENANT_SLUG))
    .limit(1);
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" não encontrado. Rode db:seed primeiro.`);

  const current = await db
    .select({ neighborhood: deliveryZones.neighborhood })
    .from(deliveryZones)
    .where(eq(deliveryZones.tenantId, tenant.id));
  const known = new Set(current.map((z) => normalize(z.neighborhood)));

  const missing = DELIVERY_ZONES.filter((z) => !known.has(normalize(z.name)));
  if (missing.length === 0) {
    console.log("Nenhum bairro novo: o banco já contém todos.");
    return;
  }

  await db.insert(deliveryZones).values(
    missing.map((z) => ({
      tenantId: tenant.id,
      neighborhood: z.name,
      feeCents: z.feeCents,
      estimatedMinutes: z.estimatedMinutes,
    })),
  );
  console.log(`${missing.length} bairro(s) adicionado(s): ${missing.map((z) => z.name).join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
