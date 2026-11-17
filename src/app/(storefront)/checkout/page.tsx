import type { Metadata } from "next";

import { getCheckoutCustomer, getStorefrontData } from "@/actions/storefront";
import { CheckoutForm } from "@/components/storefront/checkout-form";
import { effectiveMinOrderCents } from "@/core/store/min-order";
import { PhoneLookup } from "@/components/storefront/phone-lookup";
import { StorefrontShell } from "@/components/storefront/storefront-shell";

export const metadata: Metadata = { title: "Finalizar pedido", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const [data, customer] = await Promise.all([getStorefrontData(), getCheckoutCustomer()]);

  if (!data) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6 text-center text-muted">
        Loja não encontrada.
      </main>
    );
  }

  /* Checkout autenticado: sem sessão (ou cadastro incompleto) entra pelo mesmo fluxo do Meu Passaporte. */
  if (!customer || customer.needsRegistration) {
    return (
      <StorefrontShell tenant={data.tenant} store={data.store} showCartBar={false} categories={data.categories}>
        <div className="min-h-[calc(100dvh-64px)] bg-[#F4F6F9] px-4 pb-24 pt-8 text-[#0A2540]">
          <div className="mx-auto max-w-md space-y-3">
            <p className="text-center text-sm text-slate-600">Entre no seu passaporte para finalizar o pedido.</p>
            <PhoneLookup startAtRegister={customer?.needsRegistration ?? false} initialPhone={customer?.phone ?? ""} />
          </div>
        </div>
      </StorefrontShell>
    );
  }

  const catalog = data.categories.flatMap((c) => c.products);

  return (
    <StorefrontShell tenant={data.tenant} store={data.store} showCartBar={false} categories={data.categories}>
      <CheckoutForm
        catalog={catalog}
        zones={data.zones}
        minOrderCents={effectiveMinOrderCents(data.tenant.minOrderCents)}
        storeOpen={data.store.isOpen}
        customer={{ name: customer.name, phone: customer.phone }}
      />
    </StorefrontShell>
  );
}
