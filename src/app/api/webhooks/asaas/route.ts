import { and, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/infra/db";
import {
  orders,
  paymentEvents,
  payments,
  type FinancialAlertType,
  type PaymentStatus,
  type SaiposCancelStatus,
} from "@/infra/db/schema";
import { timelineInsert } from "@/infra/db/timeline";
import { settlePayment } from "@/infra/payments/settle";
import { reverseOrderMiles } from "@/infra/miles/miles";
import { tokenMatches } from "@/infra/payments/webhook-auth";
import { cancelOrderOnSaipos } from "@/lib/saipos";
import { formatCents } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Webhook do Asaas (v3).
 *  - Autenticação: header `asaas-access-token` == ASAAS_WEBHOOK_TOKEN (tempo constante).
 *  - Idempotência: o `id` do evento é inserido em `payment_events` com ON CONFLICT DO NOTHING;
 *    reentrega => 200 imediato. Se o processamento falhar, o registro é removido para que a
 *    retentativa do Asaas possa processar de novo.
 *  - Integridade: o valor pago precisa bater com `orders.total_cents`, senão não aprova.
 *  - LGPD: só `{ eventId, eventType, orderId, status }` vai para o log (nunca o payload/pagador).
 */
const eventSchema = z.object({
  id: z.string().min(1).max(120),
  event: z.string().min(1).max(80),
  payment: z.object({
    id: z.string().min(1).max(120),
    externalReference: z.string().max(120).nullish(),
    value: z.number().finite().nonnegative(),
    status: z.string().min(1).max(60),
  }),
});

type AsaasEvent = z.infer<typeof eventSchema>;

const PAID_EVENTS = new Set([
  "PAYMENT_RECEIVED",
  "PAYMENT_CONFIRMED",
  // Aprovado na análise de risco: o status do payload ainda pode estar PENDING; o evento é a prova.
  "PAYMENT_APPROVED_BY_RISK_ANALYSIS",
]);
const FAILED_EVENTS = new Set(["PAYMENT_CREDIT_CARD_CAPTURE_REFUSED", "PAYMENT_REPROVED_BY_RISK_ANALYSIS"]);
const CHARGEBACK_EVENTS = new Set(["PAYMENT_CHARGEBACK_REQUESTED", "PAYMENT_CHARGEBACK_DISPUTE"]);
const REFUND_EVENTS = new Set(["PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED"]);
/** Pedidos ainda "vivos": passam a CANCELED após estorno/chargeback. */
const ACTIVE_ORDER_STATUSES = ["AWAITING_PAYMENT", "RECEIVED", "PREPARING", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP"] as const;
const PAID_STATUSES = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function audit(level: "info" | "warn", fields: Record<string, unknown>) {
  console[level]("[asaas-webhook]", JSON.stringify(fields));
}

class RetryLater extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function findPayment(providerPaymentId: string) {
  const [row] = await db
    .select({ payment: payments, order: orders })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(eq(payments.providerPaymentId, providerPaymentId))
    .limit(1);
  return row ?? null;
}

type Outcome = Record<string, unknown>;

type FoundPayment = NonNullable<Awaited<ReturnType<typeof findPayment>>>;

async function handleRefundOrChargeback(
  evt: AsaasEvent,
  { payment, order }: FoundPayment,
  link: unknown,
  logBase: Record<string, unknown>,
): Promise<Outcome> {
  const { event, payment: p } = evt;
  const chargeback = CHARGEBACK_EVENTS.has(event);
  const alertType: FinancialAlertType = chargeback ? "CHARGEBACK" : "REFUNDED";
  const newStatus: PaymentStatus = chargeback ? "CHARGEBACK" : "REFUNDED";
  const valueCents = Math.round(p.value * 100);
  const reasonLabel = chargeback ? "Chargeback" : event === "PAYMENT_PARTIALLY_REFUNDED" ? "Estorno parcial" : "Estorno";
  const wasActive = (ACTIVE_ORDER_STATUSES as readonly string[]).includes(order.status);

  // Lote atômico: pagamento + cancelamento do pedido ativo + alerta financeiro + timeline + vínculo do evento.
  // Os índices 0 e 1 (pagamento e pedido) são contrato com os testes.
  const [, canceled] = await db.batch([
    db
      .update(payments)
      .set({ status: newStatus })
      // Chargeback prevalece sobre estorno; nunca o contrário.
      .where(
        and(
          eq(payments.id, payment.id),
          chargeback ? ne(payments.status, "CHARGEBACK") : notInArray(payments.status, ["REFUNDED", "CHARGEBACK"]),
        ),
      ),
    db
      .update(orders)
      .set({
        status: "CANCELED",
        cancelReason: chargeback ? "Chargeback solicitado." : "Pagamento estornado.",
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, order.id), inArray(orders.status, [...ACTIVE_ORDER_STATUSES])))
      .returning({ id: orders.id }),
    db.update(orders).set({ financialAlertType: alertType, updatedAt: new Date() }).where(eq(orders.id, order.id)),
    timelineInsert({
      orderId: order.id,
      type: chargeback ? "PAYMENT_CHARGEBACK" : "PAYMENT_REFUNDED",
      title: chargeback ? "Chargeback registrado no Asaas" : `${reasonLabel} no Asaas`,
      description: `${reasonLabel} de ${formatCents(valueCents)} (${event}).`,
      metadata: { asaasEvent: event, asaasEventId: evt.id, valueCents, orderStatusBefore: order.status },
      dedupeKey: `${evt.id}:financial`,
    }),
    link as never,
  ]);

  // Pedido cancelado por estorno/chargeback: as milhas que ele rendeu são devolvidas (idempotente).
  if (Array.isArray(canceled) && canceled.length > 0) {
    await reverseOrderMiles(order.id).catch(() => undefined);
  }

  /* ---- Saipos: só quando o pedido já foi enviado ---- */
  let saiposCancelStatus: SaiposCancelStatus = order.saiposCancelStatus ?? "NOT_APPLICABLE";
  const sentToSaipos = order.saiposSyncStatus === "SYNCED" && !!order.saiposOrderId;
  const alreadyHandled = saiposCancelStatus === "CANCELLED" || saiposCancelStatus === "RECONCILED";

  if (sentToSaipos && !alreadyHandled) {
    const result = await cancelOrderOnSaipos(order.saiposOrderId!);
    saiposCancelStatus = result.ok ? "CANCELLED" : "MANUAL_ACTION_REQUIRED";
    await db.batch([
      db.update(orders).set({ saiposCancelStatus, updatedAt: new Date() }).where(eq(orders.id, order.id)),
      timelineInsert({
        orderId: order.id,
        type: "SAIPOS_CANCEL_ATTEMPT",
        title: result.ok ? "Pedido cancelado no Saipos" : "Cancelamento no Saipos exige ação manual",
        description: result.ok
          ? "O Saipos aceitou o cancelamento do pedido."
          : result.unsupported
            ? "Sem endpoint de cancelamento na integração: ajuste o pedido no Saipos manualmente."
            : "O Saipos recusou o cancelamento (ex.: pedido já concluído): ajuste manualmente.",
        metadata: { saiposOrderId: order.saiposOrderId, ...(result.ok ? {} : { error: result.error }) },
        dedupeKey: `${evt.id}:saipos-cancel`,
      }),
    ]);
  }

  audit("warn", {
    ...logBase,
    status: newStatus,
    flag: chargeback ? "CHARGEBACK_HIGH_PRIORITY_OWNER_ACTION_REQUIRED" : "REFUND_AFTER_APPROVAL",
    wasActive,
    saiposCancelStatus,
  });
  return { flagged: chargeback ? "chargeback" : "refund", updated: canceled.length, saiposCancelStatus };
}

async function processEvent(evt: AsaasEvent): Promise<Outcome> {
  const { event, payment: p } = evt;
  let found = await findPayment(p.id);

  if (!found) {
    // Corrida: o webhook pode chegar antes de gravarmos a cobrança que acabamos de criar.
    const ref = p.externalReference;
    if (!ref || !UUID.test(ref)) return { ignored: "unknown_payment" };
    const [known] = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, ref)).limit(1);
    if (!known) return { ignored: "unknown_payment" };
    await sleep(1500);
    found = await findPayment(p.id);
    if (!found) throw new RetryLater();
  }

  const { payment, order } = found;
  const link = db
    .update(paymentEvents)
    .set({ orderId: order.id, providerPaymentId: p.id })
    .where(eq(paymentEvents.eventId, evt.id));
  const logBase = { eventId: evt.id, eventType: event, orderId: order.id };

  /* ---- Pagamento aprovado ---- */
  if (PAID_EVENTS.has(event)) {
    if (event !== "PAYMENT_APPROVED_BY_RISK_ANALYSIS" && !PAID_STATUSES.has(p.status)) {
      await link;
      audit("warn", { ...logBase, status: p.status, flag: "status_inconsistent_with_event" });
      return { ignored: "status_mismatch" };
    }

    const paidCents = Math.round(p.value * 100);
    if (paidCents !== order.totalCents) {
      // Não aprova: valor divergente exige revisão manual.
      await link;
      audit("warn", { ...logBase, status: p.status, flag: "AMOUNT_MISMATCH", expectedCents: order.totalCents, paidCents });
      return { flagged: "amount_mismatch" };
    }

    const newStatus: PaymentStatus = event === "PAYMENT_RECEIVED" ? "RECEIVED" : "CONFIRMED";

    // Lote atômico (pagamento + pedido + vínculo do evento). Se a resposta síncrona do cartão já
    // liberou o pedido, só o registro financeiro é atualizado (sem reenviar à cozinha/Saipos).
    const { released } = await settlePayment({
      paymentId: payment.id,
      orderId: order.id,
      tenantId: order.tenantId,
      paidCents,
      status: newStatus,
      extra: [link as never],
    });

    if (released) {
      audit("info", { ...logBase, status: newStatus });
      return { updated: 1 };
    }

    if (order.status === "CANCELED") {
      // Pagou depois de expirar/cancelar: não ressuscitamos o pedido; precisa de estorno manual.
      audit("warn", { ...logBase, status: newStatus, flag: "PAID_AFTER_CANCEL_REFUND_NEEDED" });
      return { flagged: "paid_after_cancel" };
    }
    audit("info", { ...logBase, status: newStatus });
    return { updated: 0 };
  }

  /* ---- Cartão recusado / reprovado na análise de risco ----
     O pedido segue em AWAITING_PAYMENT para o cliente tentar outro cartão ou Pix. */
  if (FAILED_EVENTS.has(event)) {
    await db.batch([
      db
        .update(payments)
        .set({ status: "FAILED" })
        .where(and(eq(payments.id, payment.id), inArray(payments.status, ["PENDING", "RISK_ANALYSIS"]))),
      link,
    ]);
    audit("info", { ...logBase, status: "FAILED" });
    return { updated: 1 };
  }

  /* ---- Em análise de risco: não cancela o pedido ---- */
  if (event === "PAYMENT_AWAITING_RISK_ANALYSIS") {
    await db.batch([
      db
        .update(payments)
        .set({ status: "RISK_ANALYSIS" })
        .where(and(eq(payments.id, payment.id), eq(payments.status, "PENDING"))),
      link,
    ]);
    audit("info", { ...logBase, status: "RISK_ANALYSIS" });
    return { updated: 1 };
  }

  /* ---- Estorno / chargeback (pedido possivelmente já na cozinha e no Saipos) ---- */
  if (REFUND_EVENTS.has(event) || CHARGEBACK_EVENTS.has(event)) {
    return handleRefundOrChargeback(evt, found, link, logBase);
  }

  /* ---- Vencido: só cancela pedido que ainda aguarda pagamento ---- */
  if (event === "PAYMENT_OVERDUE") {
    const [, canceled] = await db.batch([
      db
        .update(payments)
        .set({ status: "OVERDUE" })
        .where(
          and(eq(payments.id, payment.id), notInArray(payments.status, ["RECEIVED", "REFUNDED", "CHARGEBACK"])),
        ),
      db
        .update(orders)
        .set({ status: "CANCELED", cancelReason: "Pagamento não realizado (vencido).", updatedAt: new Date() })
        .where(and(eq(orders.id, order.id), eq(orders.status, "AWAITING_PAYMENT")))
        .returning({ id: orders.id }),
      link,
    ]);
    audit("info", { ...logBase, status: "OVERDUE" });
    return { updated: canceled.length };
  }

  await link;
  audit("info", { ...logBase, status: p.status });
  return { ignored: "event_not_handled" };
}

export async function POST(request: NextRequest) {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!expected || !tokenMatches(request.headers.get("asaas-access-token"), expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }
  const evt = parsed.data;

  /* Idempotência atômica: só quem insere o evento o processa. */
  const inserted = await db
    .insert(paymentEvents)
    .values({ eventId: evt.id, eventType: evt.event, providerPaymentId: evt.payment.id })
    .onConflictDoNothing({ target: paymentEvents.eventId })
    .returning({ eventId: paymentEvents.eventId });

  if (inserted.length === 0) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    const outcome = await processEvent(evt);
    return NextResponse.json({ ok: true, ...outcome });
  } catch (error) {
    // Libera o evento para a retentativa do Asaas e responde erro (sem vazar dados).
    await db.delete(paymentEvents).where(eq(paymentEvents.eventId, evt.id)).catch(() => undefined);
    console.error("[asaas-webhook] falha ao processar", {
      eventId: evt.id,
      eventType: evt.event,
      retry: error instanceof RetryLater,
    });
    return NextResponse.json(
      { error: "Falha ao processar o evento." },
      { status: error instanceof RetryLater ? 503 : 500 },
    );
  }
}
