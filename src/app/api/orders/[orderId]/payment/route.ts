import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { payOrderSchema } from "@/core/schemas/payment";
import { unauthorizedResponse } from "@/infra/auth/customer-session";
import { db } from "@/infra/db";
import { customers, orders, payments } from "@/infra/db/schema";
import {
  AsaasError,
  PaymentConflictError,
  cancelPendingCharges,
  createCreditCardCharge,
  createPixCharge,
  type AsaasCustomerInput,
} from "@/infra/payments/asaas";
import { expireAbandonedOrders } from "@/infra/payments/expire-orders";
import { accessDeniedResponse, resolveOrderAccess } from "@/infra/payments/order-access";
import { loadMaskedOrderSummary } from "@/infra/payments/order-privacy";
import { checkRateLimit, getClientIp, tooManyRequests } from "@/infra/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Tentativas de cartão recusadas (FAILED) por pedido antes de bloquear novas. */
const MAX_CARD_FAILURES = 5;
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ orderId: string }> };

async function loadOwnedOrder(orderId: string, customerId: string, tenantId: string) {
  if (!UUID.test(orderId)) return null;
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.customerId, customerId), eq(orders.tenantId, tenantId)))
    .limit(1);
  return order ?? null;
}

/** Status para o polling da tela de pagamento (a confirmação real vem do webhook). */
export async function GET(request: NextRequest, { params }: Ctx) {
  const { orderId } = await params;
  const resolved = await resolveOrderAccess(request, orderId);
  if (!resolved.ok) return accessDeniedResponse(resolved.status);
  const session = resolved.access;

  let order = await loadOwnedOrder(orderId, session.customerId, session.tenantId);
  if (!order) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });

  if (order.status === "AWAITING_PAYMENT") {
    await expireAbandonedOrders({ orderId: order.id });
    order = (await loadOwnedOrder(orderId, session.customerId, session.tenantId)) ?? order;
  }

  const [payment] = await db
    .select({ status: payments.status })
    .from(payments)
    .where(eq(payments.orderId, order.id))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  // Via token (sem login) o cliente só vê um resumo mascarado (LGPD): nunca CPF, e-mail ou telefone.
  const summary = session.via === "token" ? await loadMaskedOrderSummary(order.id) : undefined;

  return NextResponse.json(
    { orderStatus: order.status, paymentStatus: payment?.status ?? null, ...(summary ? { summary } : {}) },
    { headers: NO_STORE },
  );
}

/** Gera o Pix, paga com cartão (checkout transparente) ou devolve a fatura hospedada. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { orderId } = await params;
  const resolved = await resolveOrderAccess(request, orderId);
  if (!resolved.ok) return accessDeniedResponse(resolved.status);
  const session = resolved.access;

  const ip = getClientIp(request.headers);
  const general = await checkRateLimit({ identifier: ip, route: "pay", limit: 30, windowSeconds: 600 });
  if (!general.allowed) return tooManyRequests(general.retryAfterSeconds);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const parsed = payOrderSchema.safeParse(body);
  if (!parsed.success) {
    // Só mensagens de validação (nunca o valor enviado).
    const message = parsed.error.issues[0]?.message ?? "Dados inválidos.";
    return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE });
  }
  const input = parsed.data;

  const order = await loadOwnedOrder(orderId, session.customerId, session.tenantId);
  if (!order) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });

  /* Histórico de cobranças do pedido: base das proteções contra cobrança duplicada e card testing. */
  const history = await db
    .select({ status: payments.status, method: payments.method })
    .from(payments)
    .where(eq(payments.orderId, order.id));

  if (history.some((h) => h.status === "CONFIRMED" || h.status === "RECEIVED")) {
    return NextResponse.json({ error: "Este pedido já foi pago." }, { status: 409, headers: NO_STORE });
  }
  if (order.status !== "AWAITING_PAYMENT") {
    return NextResponse.json({ error: "Este pedido não aguarda pagamento." }, { status: 409 });
  }

  /* Pagamento já em análise de risco: nova cobrança poderia gerar cobrança em duplicidade. */
  if (history.some((h) => h.status === "RISK_ANALYSIS")) {
    return NextResponse.json(
      { error: "Pagamento em análise de segurança. Assim que aprovado, seu pedido será enviado para a cozinha." },
      { status: 409, headers: NO_STORE },
    );
  }

  /* Desistiu do Pix: o QR Code pendente deixa de valer (não dá para pagar um Pix "esquecido"). */
  if (input.mode === "cancel-pix") {
    try {
      const { blocked } = await cancelPendingCharges(order.id);
      if (blocked) {
        return NextResponse.json(
          { error: blocked === "PAID" ? "Pagamento anterior já foi confirmado." : "Não foi possível cancelar o Pix agora." },
          { status: 409, headers: NO_STORE },
        );
      }
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    } catch {
      return NextResponse.json({ error: "Não foi possível cancelar o Pix agora." }, { status: 502, headers: NO_STORE });
    }
  }

  /* Recuperação: cartão recusado -> outro cartão ou Pix no MESMO pedido (troca o método, mantém o carrinho). */
  const expectedMethod = input.mode === "pix" ? "PIX" : "CREDIT_CARD";
  if (order.paymentMethod !== expectedMethod) {
    const [switched] = await db
      .update(orders)
      .set({ paymentMethod: expectedMethod, updatedAt: new Date() })
      .where(
        and(
          eq(orders.id, order.id),
          eq(orders.status, "AWAITING_PAYMENT"),
          inArray(orders.paymentMethod, ["PIX", "CREDIT_CARD"]),
        ),
      )
      .returning({ id: orders.id });
    if (!switched) {
      return NextResponse.json({ error: "Não foi possível alterar a forma de pagamento." }, { status: 409 });
    }
    order.paymentMethod = expectedMethod;
  }

  if (input.mode === "card") {
    // Anti card-testing por pedido: bloqueia após 5 tentativas de cartão recusadas (FAILED).
    const failedCards = history.filter((h) => h.method === "CREDIT_CARD" && h.status === "FAILED").length;
    if (failedCards >= MAX_CARD_FAILURES) {
      return NextResponse.json(
        {
          error:
            "Muitas tentativas com cartão neste pedido. Pague via Pix ou fale conosco pelo WhatsApp.",
        },
        { status: 429, headers: NO_STORE },
      );
    }

    // Anti card-testing: poucas tentativas por cliente.
    const cardLimit = await checkRateLimit({
      identifier: session.customerId,
      route: "pay-card",
      limit: 5,
      windowSeconds: 600,
      failClosed: true,
    });
    if (!cardLimit.allowed) return tooManyRequests(cardLimit.retryAfterSeconds);
  }

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, session.customerId), eq(customers.tenantId, session.tenantId)))
    .limit(1);
  if (!customer) return unauthorizedResponse();

  const asaasCustomer: AsaasCustomerInput = {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    asaasCustomerId: customer.asaasCustomerId,
    cpfCnpj: order.documentNumber,
  };

  try {
    if (input.mode === "pix") {
      const pix = await createPixCharge({ order, customer: asaasCustomer });
      return NextResponse.json(
        {
          pix: {
            payload: pix.pixPayload,
            qrCodeBase64: pix.pixQrCodeBase64,
            expiresAt: pix.pixExpirationDate?.toISOString() ?? null,
          },
        },
        { headers: NO_STORE },
      );
    }

    if (input.mode === "hosted") {
      const charge = await createCreditCardCharge({ order, customer: asaasCustomer });
      return NextResponse.json({ invoiceUrl: charge.invoiceUrl }, { headers: NO_STORE });
    }

    const charge = await createCreditCardCharge({
      order,
      customer: asaasCustomer,
      cardData: input.card,
      remoteIp: ip,
    });
    // Aprovado: o pedido já foi liberado (idempotente com o webhook). PENDING/RISK_ANALYSIS: aguarda o webhook.
    if (charge.released) {
      return NextResponse.json(
        { ok: true, status: charge.status, released: true },
        { headers: NO_STORE },
      );
    }
    // PENDING / análise de risco: o pedido PERMANECE em AWAITING_PAYMENT até o webhook decidir.
    return NextResponse.json(
      {
        ok: true,
        status: charge.status,
        orderStatus: "AWAITING_PAYMENT",
        released: false,
        message:
          charge.status === "RISK_ANALYSIS"
            ? "Pagamento em análise de segurança. Assim que aprovado, seu pedido será enviado para a cozinha."
            : "Processando pagamento com a operadora do cartão... Não feche esta página.",
      },
      { status: 202, headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof PaymentConflictError) {
      // A cobrança anterior foi paga (pedido já liberado) ou não pôde ser invalidada com segurança.
      return NextResponse.json(
        {
          error:
            error.reason === "PAID"
              ? "Pagamento anterior já foi confirmado."
              : "Não foi possível cancelar a cobrança anterior agora. Tente novamente em instantes.",
        },
        { status: 409, headers: NO_STORE },
      );
    }
    // Nunca logamos corpo/cartão: só status HTTP e códigos do Asaas.
    console.error("[payments] falha ao criar cobrança", {
      orderId: order.id,
      mode: input.mode,
      httpStatus: error instanceof AsaasError ? error.httpStatus : "unknown",
      codes: error instanceof AsaasError ? error.codes : undefined,
    });
    const userMessage =
      error instanceof AsaasError
        ? error.userMessage
        : "Não foi possível processar o pagamento. Tente novamente.";
    const clientError = error instanceof AsaasError && error.httpStatus >= 400 && error.httpStatus < 500;
    return NextResponse.json(
      { error: userMessage, refused: input.mode === "card" && clientError },
      { status: clientError ? 422 : 502, headers: NO_STORE },
    );
  }
}
