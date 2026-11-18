import { and, desc, eq, inArray } from "drizzle-orm";

import { randomUUID } from "node:crypto";

import { db } from "@/infra/db";
import { settlePayment } from "./settle";
import {
  customers,
  payments,
  type Order,
  type Payment,
  type PaymentStatus,
} from "@/infra/db/schema";

/**
 * Cliente isolado da API v3 do Asaas (Pix dinâmico + cartão de crédito).
 *
 * Regras de segurança:
 *  - valor SEMPRE de `order.totalCents` (lido do banco pelo chamador), nunca do frontend;
 *  - dados do cartão vivem só em memória durante a chamada: não são logados, persistidos
 *    nem incluídos em mensagens de erro (PCI-DSS / LGPD);
 *  - erros carregam apenas status HTTP e códigos/descrições devolvidos pelo Asaas.
 */

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

export type AsaasCustomerInput = {
  /** Id interno (customers.id): vai em `externalReference`. */
  id: string;
  name: string;
  /** Apenas dígitos (DDD + número). */
  phone: string;
  email?: string | null;
  asaasCustomerId?: string | null;
  /** CPF/CNPJ (só dígitos). Necessário para cobrar. */
  cpfCnpj?: string | null;
};

export type ChargeOrder = Pick<Order, "id" | "totalCents">;
export type CardChargeOrder = ChargeOrder & Pick<Order, "tenantId">;

export type CardData = {
  holderName: string;
  /** Somente dígitos. */
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
  holderCpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  email: string;
};

export type PixChargeResult = {
  paymentId: string;
  status: PaymentStatus;
  pixPayload: string;
  pixQrCodeBase64: string;
  pixExpirationDate: Date | null;
  invoiceUrl: string | null;
};

export type CardChargeResult = {
  paymentId: string;
  status: PaymentStatus;
  invoiceUrl: string | null;
  /** true quando foi gerada só a fatura hospedada (sem dados de cartão). */
  hosted: boolean;
  /** true quando a aprovação síncrona já liberou o pedido para a cozinha. */
  released: boolean;
};

export class AsaasError extends Error {
  readonly httpStatus: number;
  readonly codes: string[];
  /** Mensagem segura para exibir ao cliente. */
  readonly userMessage: string;

  constructor(httpStatus: number, codes: string[], userMessage: string) {
    super(`Asaas respondeu ${httpStatus}${codes.length ? ` (${codes.join(",")})` : ""}`);
    this.name = "AsaasError";
    this.httpStatus = httpStatus;
    this.codes = codes;
    this.userMessage = userMessage;
  }
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

const REQUEST_TIMEOUT_MS = 20_000;

type AsaasErrorBody = { errors?: { code?: string; description?: string }[] };

function config(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env.ASAAS_API_URL?.replace(/\/+$/, "");
  const apiKey = process.env.ASAAS_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("Asaas não configurado (ASAAS_API_URL / ASAAS_API_KEY).");
  return { baseUrl, apiKey };
}

async function asaasRequest<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const { baseUrl, apiKey } = config();

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        access_token: apiKey,
        "Content-Type": "application/json",
        "User-Agent": "passaporte-burguer",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Nunca anexamos a requisição (pode conter dados de cartão) ao erro.
    throw new AsaasError(0, [], "Não foi possível falar com o provedor de pagamento. Tente novamente.");
  }

  if (!response.ok) {
    let errors: AsaasErrorBody["errors"];
    try {
      errors = ((await response.json()) as AsaasErrorBody).errors;
    } catch {
      errors = undefined;
    }
    const codes = (errors ?? []).map((e) => e.code ?? "unknown");
    const description = errors?.[0]?.description?.slice(0, 200);
    throw new AsaasError(
      response.status,
      codes,
      response.status >= 400 && response.status < 500 && description
        ? description
        : "O provedor de pagamento está indisponível. Tente novamente em instantes.",
    );
  }

  return (await response.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Helpers puros                                                       */
/* ------------------------------------------------------------------ */

/** Data atual (YYYY-MM-DD) no fuso America/Sao_Paulo. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Reais com 2 casas a partir de centavos inteiros (sem erro de ponto flutuante). */
export function centsToReais(cents: number): number {
  return Math.round(cents) / 100;
}

/** "2026-11-18 23:59:59" (horário de Brasília) -> Date. */
export function parseAsaasDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T23:59:59-03:00`
    : `${value.replace(" ", "T")}${/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? "" : "-03:00"}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function mapAsaasStatus(status: string | undefined): PaymentStatus {
  switch (status) {
    case "CONFIRMED":
      return "CONFIRMED";
    case "RECEIVED":
    case "RECEIVED_IN_CASH":
      return "RECEIVED";
    case "OVERDUE":
      return "OVERDUE";
    case "AWAITING_RISK_ANALYSIS":
      return "RISK_ANALYSIS";
    case "REPROVED_BY_RISK_ANALYSIS":
      return "FAILED";
    case "REFUNDED":
    case "REFUND_REQUESTED":
    case "REFUND_IN_PROGRESS":
      return "REFUNDED";
    default:
      return "PENDING";
  }
}

/* ------------------------------------------------------------------ */
/* Cliente                                                             */
/* ------------------------------------------------------------------ */

async function persistCustomerId(customerId: string, asaasId: string): Promise<void> {
  await db.update(customers).set({ asaasCustomerId: asaasId }).where(eq(customers.id, customerId));
}

/** Reaproveita o cus_xxx salvo; senão busca por CPF/CNPJ; senão cria. Persiste o id. */
export async function getOrCreateAsaasCustomer(customer: AsaasCustomerInput): Promise<string> {
  if (customer.asaasCustomerId) return customer.asaasCustomerId;

  const cpfCnpj = customer.cpfCnpj?.replace(/\D/g, "") || null;

  if (cpfCnpj) {
    const found = await asaasRequest<{ data?: { id: string }[] }>(
      "GET",
      `/customers?cpfCnpj=${encodeURIComponent(cpfCnpj)}&limit=1`,
    );
    const existing = found.data?.[0]?.id;
    if (existing) {
      await persistCustomerId(customer.id, existing);
      return existing;
    }
  }

  const created = await asaasRequest<{ id: string }>("POST", "/customers", {
    name: customer.name,
    cpfCnpj: cpfCnpj ?? undefined,
    mobilePhone: customer.phone,
    email: customer.email ?? undefined,
    externalReference: customer.id,
    // Os avisos ao cliente são nossos (site/WhatsApp); o Asaas não deve disparar e-mail/SMS.
    notificationDisabled: true,
  });
  await persistCustomerId(customer.id, created.id);
  return created.id;
}

/* ------------------------------------------------------------------ */
/* Cobranças                                                           */
/* ------------------------------------------------------------------ */

type AsaasPayment = { id: string; status?: string; invoiceUrl?: string };

/**
 * Cancela no Asaas as cobranças ainda PENDING do pedido (exceto `keepPaymentId`),
 * evitando que o cliente pague duas vezes ou pague um pedido já cancelado.
 */
export async function cancelPendingCharges(orderId: string, keepPaymentId?: string): Promise<void> {
  const pending = await db
    .select({ id: payments.id, providerPaymentId: payments.providerPaymentId })
    .from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.status, "PENDING")));

  for (const p of pending) {
    if (p.providerPaymentId === keepPaymentId) continue;
    try {
      await asaasRequest("DELETE", `/payments/${encodeURIComponent(p.providerPaymentId)}`);
      await db.update(payments).set({ status: "OVERDUE" }).where(eq(payments.id, p.id));
    } catch (error) {
      // Best-effort: se o Asaas não removeu, mantém PENDING para nova tentativa.
      console.error("[asaas] falha ao cancelar cobrança pendente", {
        orderId,
        code: error instanceof AsaasError ? error.httpStatus : "unknown",
      });
    }
  }
}

async function findReusablePix(orderId: string): Promise<Payment | null> {
  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.method, "PIX"), eq(payments.status, "PENDING")))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  if (!row || !row.pixPayload || !row.pixQrCodeBase64) return null;
  if (row.pixExpirationDate && row.pixExpirationDate.getTime() <= Date.now()) return null;
  return row;
}

export async function createPixCharge({
  order,
  customer,
}: {
  order: ChargeOrder;
  customer: AsaasCustomerInput;
}): Promise<PixChargeResult> {
  // Idempotente: duplo clique/recarga reaproveita o QR Code ainda válido.
  const reusable = await findReusablePix(order.id);
  if (reusable) {
    return {
      paymentId: reusable.providerPaymentId,
      status: reusable.status,
      pixPayload: reusable.pixPayload!,
      pixQrCodeBase64: reusable.pixQrCodeBase64!,
      pixExpirationDate: reusable.pixExpirationDate,
      invoiceUrl: reusable.invoiceUrl,
    };
  }

  await cancelPendingCharges(order.id);
  const asaasCustomerId = await getOrCreateAsaasCustomer(customer);

  const charge = await asaasRequest<AsaasPayment>("POST", "/payments", {
    customer: asaasCustomerId,
    billingType: "PIX",
    value: centsToReais(order.totalCents),
    dueDate: todayInSaoPaulo(),
    externalReference: order.id,
    description: `Pedido ${order.id.slice(0, 8)}`,
  });

  const qr = await asaasRequest<{ encodedImage: string; payload: string; expirationDate?: string }>(
    "GET",
    `/payments/${encodeURIComponent(charge.id)}/pixQrCode`,
  );

  const expiration = parseAsaasDateTime(qr.expirationDate);
  const status = mapAsaasStatus(charge.status);

  await db
    .insert(payments)
    .values({
      orderId: order.id,
      provider: "asaas",
      providerPaymentId: charge.id,
      providerCustomerId: asaasCustomerId,
      method: "PIX",
      amountCents: order.totalCents,
      status,
      pixPayload: qr.payload,
      pixQrCodeBase64: qr.encodedImage,
      pixExpirationDate: expiration,
      invoiceUrl: charge.invoiceUrl ?? null,
    })
    .onConflictDoNothing({ target: payments.providerPaymentId });

  return {
    paymentId: charge.id,
    status,
    pixPayload: qr.payload,
    pixQrCodeBase64: qr.encodedImage,
    pixExpirationDate: expiration,
    invoiceUrl: charge.invoiceUrl ?? null,
  };
}

/**
 * Cartão de crédito.
 *  - com `cardData`: checkout transparente (captura imediata; dados só em memória);
 *  - sem `cardData`: gera a fatura hospedada e devolve `invoiceUrl` para pagamento seguro no Asaas.
 * O pedido NÃO é liberado aqui: quem aprova é o webhook do Asaas.
 */
export async function createCreditCardCharge({
  order,
  customer,
  cardData,
  remoteIp,
}: {
  order: CardChargeOrder;
  customer: AsaasCustomerInput;
  cardData?: CardData | null;
  remoteIp?: string | null;
}): Promise<CardChargeResult> {
  if (cardData && (!remoteIp || remoteIp === "unknown")) {
    throw new AsaasError(400, [], "Não foi possível validar sua conexão. Tente novamente.");
  }

  await cancelPendingCharges(order.id);
  const asaasCustomerId = await getOrCreateAsaasCustomer({
    ...customer,
    cpfCnpj: cardData?.holderCpfCnpj ?? customer.cpfCnpj,
  });

  const base = {
    customer: asaasCustomerId,
    billingType: "CREDIT_CARD" as const,
    value: centsToReais(order.totalCents),
    dueDate: todayInSaoPaulo(),
    externalReference: order.id,
    description: `Pedido ${order.id.slice(0, 8)}`,
  };

  const payload = cardData
    ? {
        ...base,
        creditCard: {
          holderName: cardData.holderName,
          number: cardData.number,
          expiryMonth: cardData.expiryMonth,
          expiryYear: cardData.expiryYear,
          ccv: cardData.ccv,
        },
        creditCardHolderInfo: {
          name: cardData.holderName,
          email: cardData.email,
          cpfCnpj: cardData.holderCpfCnpj,
          postalCode: cardData.postalCode,
          addressNumber: cardData.addressNumber,
          phone: customer.phone,
        },
        remoteIp,
      }
    : base;

  let charge: AsaasPayment;
  try {
    charge = await asaasRequest<AsaasPayment>("POST", "/payments", payload);
  } catch (error) {
    // Recusa/erro 4xx: registra a tentativa como FAILED (trilha de auditoria; sem dados de cartão).
    if (cardData && error instanceof AsaasError && error.httpStatus >= 400 && error.httpStatus < 500) {
      await db
        .insert(payments)
        .values({
          orderId: order.id,
          provider: "asaas",
          providerPaymentId: `failed_${randomUUID()}`,
          providerCustomerId: asaasCustomerId,
          method: "CREDIT_CARD",
          amountCents: order.totalCents,
          status: "FAILED",
        })
        .catch(() => undefined);
    }
    throw error;
  }

  const status = mapAsaasStatus(charge.status);

  const inserted = await db
    .insert(payments)
    .values({
      orderId: order.id,
      provider: "asaas",
      providerPaymentId: charge.id,
      providerCustomerId: asaasCustomerId,
      method: "CREDIT_CARD",
      amountCents: order.totalCents,
      status,
      invoiceUrl: charge.invoiceUrl ?? null,
    })
    .onConflictDoNothing({ target: payments.providerPaymentId })
    .returning({ id: payments.id });

  /* Aprovação imediata: libera o pedido já (idempotente com o webhook PAYMENT_CONFIRMED que chega depois). */
  let released = false;
  if (cardData && (status === "CONFIRMED" || status === "RECEIVED")) {
    const [existing] = inserted.length
      ? inserted
      : await db
          .select({ id: payments.id })
          .from(payments)
          .where(eq(payments.providerPaymentId, charge.id))
          .limit(1);
    if (existing) {
      ({ released } = await settlePayment({
        paymentId: existing.id,
        orderId: order.id,
        tenantId: order.tenantId,
        paidCents: order.totalCents,
        status,
      }));
    }
  }

  return { paymentId: charge.id, status, invoiceUrl: charge.invoiceUrl ?? null, hosted: !cardData, released };
}

/** Remove a cobrança do Asaas (pedido expirado/cancelado). Best-effort. */
export async function cancelOrderCharges(orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return;
  const rows = await db
    .select({ orderId: payments.orderId })
    .from(payments)
    .where(and(inArray(payments.orderId, orderIds), eq(payments.status, "PENDING")));
  for (const orderId of new Set(rows.map((r) => r.orderId))) {
    await cancelPendingCharges(orderId);
  }
}
