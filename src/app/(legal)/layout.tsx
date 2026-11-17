import type { ReactNode } from "react";

import { getStorefrontData } from "@/actions/storefront";
import { StorefrontShell } from "@/components/storefront/storefront-shell";

/** Páginas legais reaproveitam o Header/Footer da loja. */
export default async function LegalLayout({ children }: { children: ReactNode }) {
  const data = await getStorefrontData();

  if (!data) {
    return <main className="flex min-h-dvh items-center justify-center p-6 text-center">Loja não encontrada.</main>;
  }

  return (
    <StorefrontShell tenant={data.tenant} store={data.store} categories={data.categories} showCartBar={false}>
      {children}
    </StorefrontShell>
  );
}
