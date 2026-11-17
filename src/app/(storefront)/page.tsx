import type { Metadata } from "next";
import { preload } from "react-dom";

import { getStorefrontData } from "@/actions/storefront";
import { Hero } from "@/components/storefront/hero";
import { Menu } from "@/components/storefront/menu";
import { RestaurantJsonLd } from "@/components/storefront/restaurant-json-ld";
import { StorefrontShell } from "@/components/storefront/storefront-shell";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

export default async function StorefrontPage() {
  // O fundo do hero é CSS background (invisível ao preload scanner): antecipa o LCP.
  preload("/backgorund-hero.min.webp", { as: "image", fetchPriority: "high" });

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
      <RestaurantJsonLd tenant={data.tenant} categories={data.categories} />
      <Menu categories={data.categories} storeOpen={data.store.isOpen} />
    </StorefrontShell>
  );
}
