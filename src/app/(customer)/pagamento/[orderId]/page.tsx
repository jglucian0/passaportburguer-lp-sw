import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";

import { getStorefrontData } from "@/actions/storefront";
import { formatDocument } from "@/core/validation/document";
import { PaymentView } from "@/components/storefront/payment-view";
import { StorefrontShell } from "@/components/storefront/storefront-shell";
import { getAuthSession } from "@/infra/auth/customer-session";
import { db } from "@/infra/db";
import { customers, orders, payments } from "@/infra/db/schema";

export const metadata: Metadata = { title: "Pagamento", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function PaymentPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const [storefront, session] = await Promise.all([getStorefrontData(), getAuthSession()]);

  if (!storefront) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6 text-center text-muted">
        Loja não encontrada.
      </main>
    );
  }
  if (!session || !UUID.test(orderId)) redirect("/meus-pedidos");

  const [order] = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.customerId, session.customerId),
        eq(orders.tenantId, session.tenantId),
      ),
    )
    .limit(1);

  // Pedido de outra pessoa/inexistente, ou que já não aguarda pagamento: volta ao Meu Passaporte.
  if (!order || order.status !== "AWAITING_PAYMENT") redirect("/meus-pedidos");
  if (order.paymentMethod !== "PIX" && order.paymentMethod !== "CREDIT_CARD") redirect("/meus-pedidos");

  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.method, "PIX"), eq(payments.status, "PENDING")))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  const [customer] = await db
    .select({ email: customers.email, name: customers.name })
    .from(customers)
    .where(eq(customers.id, session.customerId))
    .limit(1);

  const pixValid =
    payment?.pixPayload &&
    payment.pixQrCodeBase64 &&
    (!payment.pixExpirationDate || payment.pixExpirationDate.getTime() > Date.now());

  const { tenant, categories, store } = storefront;

  return (
    <StorefrontShell tenant={tenant} store={store} categories={categories}>
      <div className="bg-[#071329] px-4 pb-10 pt-8 text-center">
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
          Pagamento do <span className="text-[#F59E0B]">pedido #{order.orderNumber}</span>
        </h1>
      </div>

      <div className="min-h-[calc(100dvh-64px)] bg-[#F4F6F9] px-4 pb-24 pt-6 text-[#0A2540]">
        <div className="mx-auto max-w-md">
          <PaymentView
            orderId={order.id}
            method={order.paymentMethod}
            totalCents={order.totalCents}
            customerEmail={customer?.email ?? ""}
            defaults={{
              holderName: customer?.name ?? "",
              holderCpf: order.documentNumber ? formatDocument(order.documentNumber) : "",
              // Só entrega tem endereço; retirada deixa os campos de cobrança visíveis.
              postalCode: order.deliveryType === "DELIVERY" ? (order.addressSnapshot?.postalCode ?? "") : "",
              addressNumber: order.deliveryType === "DELIVERY" ? (order.addressSnapshot?.number ?? "") : "",
            }}
            initialPix={
              pixValid
                ? {
                    payload: payment.pixPayload!,
                    qrCodeBase64: payment.pixQrCodeBase64!,
                    expiresAt: payment.pixExpirationDate?.toISOString() ?? null,
                  }
                : null
            }
          />
        </div>
      </div>
    </StorefrontShell>
  );
}
