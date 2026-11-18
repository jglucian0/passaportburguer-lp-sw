import type { Metadata } from "next";

import { OrderPaymentScreen } from "@/components/storefront/order-payment-screen";

export const metadata: Metadata = { title: "Pagamento", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/**
 * Link público de pagamento enviado pelo WhatsApp: /pedido/{id}/pagamento?token=...
 * Abre em aba anônima/WebView sem login (token assinado ORDER_PAYMENT, 2 h, preso a este pedido).
 */
export default async function OrderPaymentLink({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ orderId }, { token }] = await Promise.all([params, searchParams]);
  return <OrderPaymentScreen orderId={orderId} token={token} />;
}
