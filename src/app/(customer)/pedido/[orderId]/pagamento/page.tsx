import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Link público de pagamento enviado pelo WhatsApp (/pedido/{id}/pagamento).
 * A tela de pagamento (que exige o login do dono do pedido) vive em /pagamento/{id}.
 */
export default async function OrderPaymentLink({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  redirect(`/pagamento/${encodeURIComponent(orderId)}`);
}
