import type { Metadata } from "next";

import { getCheckoutCustomer, getStorefrontData } from "@/actions/storefront";
import { CheckoutForm } from "@/components/storefront/checkout-form";
import { effectiveMinOrderCents } from "@/core/store/min-order";
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

  const catalog = data.categories.flatMap((c) => c.products);

  return (
    <StorefrontShell tenant={data.tenant} store={data.store} showCartBar={false} categories={data.categories}>
      <CheckoutForm
        catalog={catalog}
        zones={data.zones}
        minOrderCents={effectiveMinOrderCents(data.tenant.minOrderCents)}
        storeOpen={data.store.isOpen}
        /* Sem sessão: visitante (confirma o WhatsApp por código no fim). Cadastro incompleto: pede só nome/CPF. */
        customer={customer ? { name: customer.name, phone: customer.phone, needsRegistration: customer.needsRegistration } : null}
        prefill={customer ? { documentNumber: customer.documentNumber, lastAddress: customer.lastAddress } : undefined}
      />
    </StorefrontShell>
  );
}
