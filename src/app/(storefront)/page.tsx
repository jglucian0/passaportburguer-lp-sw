import { getStorefrontData } from "@/actions/storefront";
import { Hero } from "@/components/storefront/hero";
import { Menu } from "@/components/storefront/menu";
import { StorefrontShell } from "@/components/storefront/storefront-shell";

export default async function StorefrontPage() {
  const data = await getStorefrontData();

  if (!data) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6 text-center text-muted">
        Loja não encontrada.
      </main>
    );
  }

  return (
    <StorefrontShell tenant={data.tenant} store={data.store} categories={data.categories}>
      <Hero
        tenant={data.tenant}
        store={data.store}
        zones={data.zones}
        categories={data.categories}
      />
      <Menu categories={data.categories} storeOpen={data.store.isOpen} />
    </StorefrontShell>
  );
}
