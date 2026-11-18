import { eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { headers } from "next/headers";

import { db } from "@/infra/db";
import { tenants } from "@/infra/db/schema";

export type TenantRef = {
  id: string;
  slug: string;
  name: string;
};

/**
 * Resolve o tenant da requisição: domínio customizado (header x-tenant-host)
 * e, como fallback, o slug padrão definido pelo middleware. Resultado em cache.
 */
export async function getTenantRef(): Promise<TenantRef | null> {
  const h = await headers();
  const host = (h.get("x-tenant-host") ?? "").replace(/^www\./, "");
  const slug = h.get("x-tenant-slug") ?? process.env.DEFAULT_TENANT_SLUG ?? "passaporteburguer";

  const load = unstable_cache(
    async (): Promise<TenantRef | null> => {
      const columns = { id: tenants.id, slug: tenants.slug, name: tenants.name };

      if (host) {
        const [byDomain] = await db
          .select(columns)
          .from(tenants)
          .where(eq(tenants.customDomain, host))
          .limit(1);
        if (byDomain) return byDomain;
      }

      const [bySlug] = await db.select(columns).from(tenants).where(eq(tenants.slug, slug)).limit(1);
      return bySlug ?? null;
    },
    ["tenant-ref", host, slug],
    { tags: ["tenant"], revalidate: 3600 },
  );

  return load();
}
