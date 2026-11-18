import type { Metadata } from "next";

import { OrderPaymentScreen } from "@/components/storefront/order-payment-screen";

// O link pode carregar um token na URL: nunca vaza por Referer e não é indexado.
export const metadata: Metadata = { title: "Pagamento", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function PaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ orderId }, { token }] = await Promise.all([params, searchParams]);
  return <OrderPaymentScreen orderId={orderId} token={token} />;
}
