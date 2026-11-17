import type { Metadata } from "next";

import { getCustomerOrders, getStorefrontData } from "@/actions/storefront";
import { OrdersView } from "@/components/storefront/orders-view";
import { PhoneLookup } from "@/components/storefront/phone-lookup";
import { StorefrontShell } from "@/components/storefront/storefront-shell";

export const metadata: Metadata = { title: "Meu Passaporte", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MyOrdersPage() {
  const [storefront, customerData] = await Promise.all([getStorefrontData(), getCustomerOrders()]);

  if (!storefront) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6 text-center text-muted">
        Loja não encontrada.
      </main>
    );
  }

  const { tenant, categories, store, zones } = storefront;

  return (
    <StorefrontShell tenant={tenant} store={store} categories={categories}>
      {/* Faixa escura integrada à navbar */}
      <div className="bg-[#071329] px-4 pb-10 pt-8 text-center">
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
          Meu <span className="text-[#F59E0B]">Passaporte</span>
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[#CBD5E1]">
          Acompanhe seu voo, colecione carimbos e acesse seus pedidos.
        </p>
      </div>

      <div className="min-h-[calc(100dvh-64px)] bg-[#F4F6F9] px-4 pb-24 pt-6 text-[#0A2540]">
        <div className="mx-auto max-w-4xl">
          {customerData && customerData.needsRegistration ? (
            <PhoneLookup startAtRegister initialPhone={customerData.customerPhone} />
          ) : customerData ? (
            <OrdersView
              tenantId={tenant.id}
              customerName={customerData.customerName}
              customerPhone={customerData.customerPhone}
              orders={customerData.orders}
              categories={categories}
              zones={zones}
              whatsapp={tenant.phoneWhatsapp}
            />
          ) : (
            <PhoneLookup />
          )}
        </div>
      </div>
    </StorefrontShell>
  );
}
