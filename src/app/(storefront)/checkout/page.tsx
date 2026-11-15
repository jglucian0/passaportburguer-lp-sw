import type { Metadata } from "next";

import { getStorefrontData } from "@/actions/storefront";
import { CheckoutForm } from "@/components/storefront/checkout-form";
import { StorefrontShell } from "@/components/storefront/storefront-shell";

export const metadata: Metadata = { title: "Finalizar pedido" };

export default async function CheckoutPage() {
  const data = await getStorefrontData();

  if (!data) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6 text-center text-muted">
        Loja não encontrada.
      </main>
    );
  }

  const catalog = data.categories.flatMap((c) => c.products);

  return (
    <StorefrontShell tenant={data.tenant} store={data.store} showCartBar={false} categories={data.categories}>
      <CheckoutForm
        catalog={catalog}
        zones={data.zones}
        minOrderCents={data.tenant.minOrderCents}
        storeOpen={data.store.isOpen}
      />
    </StorefrontShell>
  );
}
