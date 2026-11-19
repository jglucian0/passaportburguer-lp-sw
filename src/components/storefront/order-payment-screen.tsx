import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";

import { getStorefrontData } from "@/actions/storefront";
import { PaymentView } from "@/components/storefront/payment-view";
import { StorefrontShell } from "@/components/storefront/storefront-shell";
import { formatDocument } from "@/core/validation/document";
import { getAuthSession } from "@/infra/auth/customer-session";
import { db } from "@/infra/db";
import { customers, orders, payments } from "@/infra/db/schema";
import { resolveTokenAccess, type OrderAccess } from "@/infra/payments/order-access";
import { loadMaskedOrderSummary, type MaskedOrderSummary } from "@/infra/payments/order-privacy";
import { formatCents } from "@/lib/utils";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center text-muted">{children}</main>
  );
}

/** Resumo mascarado (LGPD) para quem entrou só com o link assinado: primeiro nome, itens, total e endereço resumido. */
function MaskedSummary({ summary }: { summary: MaskedOrderSummary }) {
  return (
    <section className="mb-4 space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <p className="font-semibold">Olá, {summary.firstName}!</p>
      <ul className="space-y-0.5 text-slate-700">
        {summary.items.map((i, idx) => (
          <li key={`${i.name}-${idx}`}>
            {i.quantity}x {i.name}
          </li>
        ))}
      </ul>
      <p className="text-slate-600">{summary.addressSummary ? `Entrega: ${summary.addressSummary}` : "Retirada na loja"}</p>
      <p className="font-semibold">Total: {formatCents(summary.totalCents)}</p>
    </section>
  );
}

/**
 * Tela de pagamento do pedido. Funciona logada (dona do pedido) ou SÓ com o link assinado do WhatsApp
 * (aba anônima / WebView). Via token, os dados pessoais ficam mascarados e nada é pré-preenchido.
 */
export async function OrderPaymentScreen({ orderId, token }: { orderId: string; token?: string | null }) {
  const [storefront, session, viaToken] = await Promise.all([
    getStorefrontData(),
    getAuthSession(),
    resolveTokenAccess(token ?? null, orderId),
  ]);

  if (!storefront) return <Notice>Loja não encontrada.</Notice>;

  let access: OrderAccess | null = null;
  if (viaToken.ok) access = viaToken.access;
  else if (session) access = { via: "session", customerId: session.customerId, tenantId: session.tenantId };

  if (!access) {
    if (!token) redirect("/meus-pedidos");
    return (
      <Notice>
        <p className="font-semibold text-slate-900">Link de pagamento inválido ou expirado.</p>
        <p>Peça um novo link pelo nosso WhatsApp para pagar o pedido.</p>
      </Notice>
    );
  }
  const anonymous = access.via === "token";
  if (!UUID.test(orderId)) redirect("/meus-pedidos");

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.customerId, access.customerId), eq(orders.tenantId, access.tenantId)))
    .limit(1);

  const payable =
    !!order && order.status === "AWAITING_PAYMENT" && (order.paymentMethod === "PIX" || order.paymentMethod === "CREDIT_CARD");
  if (!order || !payable) {
    // Sem login não há "Meus pedidos" para onde mandar: explica aqui mesmo.
    if (anonymous) {
      return (
        <Notice>
          <p className="font-semibold text-slate-900">
            {order?.status === "CANCELED" ? "Este pedido foi cancelado." : "Este pedido não aguarda pagamento."}
          </p>
        </Notice>
      );
    }
    redirect("/meus-pedidos");
  }

  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.method, "PIX"), eq(payments.status, "PENDING")))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  const [customer] = await db
    .select({ email: customers.email, name: customers.name, documentNumber: customers.documentNumber })
    .from(customers)
    .where(eq(customers.id, access.customerId))
    .limit(1);

  const summary = anonymous ? await loadMaskedOrderSummary(order.id) : null;

  const pixValid =
    payment?.pixPayload &&
    payment.pixQrCodeBase64 &&
    (!payment.pixExpirationDate || payment.pixExpirationDate.getTime() > Date.now());

  // CPF já salvo (pedido ou cadastro): o checkout não pede de novo. Via link anônimo ele nunca vai ao HTML.
  const knownDocument = order.documentNumber ?? customer?.documentNumber ?? null;

  const { tenant, categories, store } = storefront;
  const delivery = order.deliveryType === "DELIVERY";

  return (
    <StorefrontShell tenant={tenant} store={store} categories={categories}>
      <div className="bg-[#071329] px-4 pb-10 pt-8 text-center">
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
          Pagamento do <span className="text-[#F59E0B]">pedido #{order.orderNumber}</span>
        </h1>
      </div>

      <div className="min-h-[calc(100dvh-64px)] bg-[#F4F6F9] px-4 pb-24 pt-6 text-[#0A2540]">
        <div className="mx-auto max-w-md">
          {summary ? <MaskedSummary summary={summary} /> : null}
          <PaymentView
            orderId={order.id}
            token={anonymous ? (token ?? null) : null}
            method={order.paymentMethod as "PIX" | "CREDIT_CARD"}
            // Link do WhatsApp: escolhe Pix/cartão na própria página (sem cobrança até escolher).
            askMethod={anonymous && !pixValid}
            totalCents={order.totalCents}
            documentKnown={!!knownDocument}
            // Anônimo: nada de dados pessoais no HTML (o titular digita os dados do cartão).
            customerEmail={anonymous ? "" : (customer?.email ?? "")}
            defaults={{
              holderName: anonymous ? "" : (customer?.name ?? ""),
              holderCpf: anonymous ? "" : knownDocument ? formatDocument(knownDocument) : "",
              // Só entrega tem endereço; retirada deixa os campos de cobrança visíveis.
              postalCode: !anonymous && delivery ? (order.addressSnapshot?.postalCode ?? "") : "",
              addressNumber: !anonymous && delivery ? (order.addressSnapshot?.number ?? "") : "",
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
          {anonymous ? (
            <p className="mt-4 text-center text-xs text-slate-500">
              Link seguro e temporário.{" "}
              <Link href="/" className="underline">
                Voltar ao cardápio
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </StorefrontShell>
  );
}
