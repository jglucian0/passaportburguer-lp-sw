import type { Metadata } from "next";

import { getStorefrontData } from "@/actions/storefront";
import { Menu } from "@/components/storefront/menu";
import { StorefrontShell } from "@/components/storefront/storefront-shell";

/* Atalho para quem já vem decidido (ex.: link do Instagram): só o cardápio, sem o hero.
   A página inicial continua sendo a canônica para buscadores. */
export const metadata: Metadata = {
  title: "Cardápio",
  alternates: { canonical: "/" },
  robots: { index: false, follow: true },
};

export default async function MenuOnlyPage() {
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
      <Menu categories={data.categories} storeOpen={data.store.isOpen} />
    </StorefrontShell>
  );
}
