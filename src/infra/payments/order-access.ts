import { eq } from "drizzle-orm";

import { getAuthSession, unauthorizedResponse } from "@/infra/auth/customer-session";
import { db } from "@/infra/db";
import { customers, orders } from "@/infra/db/schema";
import { getBrazilianPhoneVariants } from "@/infra/whatsapp/phone";
import { verifyWhatsAppToken } from "@/infra/whatsapp/session-token";

/**
 * Acesso ao pagamento de um pedido:
 *  - `session`: cliente logado (dono do pedido, checado na consulta);
 *  - `token`: link assinado do WhatsApp (ORDER_PAYMENT), válido em aba anônima/WebView, SEM login.
 *    O token só vale para o pedido da rota e para o telefone dono dele; quem o usa vê dados mascarados.
 */
export type OrderAccess = { via: "session" | "token"; customerId: string; tenantId: string };
export type OrderAccessResult = { ok: true; access: OrderAccess } | { ok: false; status: 401 | 403 | 404 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ORDER_TOKEN_HEADER = "x-order-token";

/** Token do pedido na query (?token=) ou no header x-order-token. */
export function readOrderToken(request: Request): string | null {
  const fromHeader = request.headers.get(ORDER_TOKEN_HEADER);
  if (fromHeader) return fromHeader;
  try {
    return new URL(request.url).searchParams.get("token");
  } catch {
    return null;
  }
}

/** Token válido (assinatura, validade, propósito ORDER_PAYMENT) e emitido para ESTE pedido. */
export function verifyOrderPaymentToken(token: string, orderId: string): { phone: string } | null {
  const claims = verifyWhatsAppToken(token);
  if (!claims || claims.purpose !== "ORDER_PAYMENT" || claims.orderId !== orderId) return null;
  return { phone: claims.phone };
}

/** Resolve o acesso só por token (usado também pela página, que lê a sessão por conta própria). */
export async function resolveTokenAccess(token: string | null, orderId: string): Promise<OrderAccessResult> {
  if (!token) return { ok: false, status: 401 };
  if (!UUID.test(orderId)) return { ok: false, status: 404 };
  const claims = verifyOrderPaymentToken(token, orderId);
  if (!claims) return { ok: false, status: 403 };

  const [order] = await db
    .select({ customerId: orders.customerId, tenantId: orders.tenantId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return { ok: false, status: 404 };

  // O telefone do token precisa ser o do cliente dono do pedido.
  const [customer] = await db.select({ phone: customers.phone }).from(customers).where(eq(customers.id, order.customerId)).limit(1);
  if (!customer || !getBrazilianPhoneVariants(claims.phone).includes(customer.phone)) return { ok: false, status: 403 };

  return { ok: true, access: { via: "token", customerId: order.customerId, tenantId: order.tenantId } };
}

/** Token válido do pedido primeiro (WebView com login antigo não atrapalha); senão a sessão; senão 401/403. */
export async function resolveOrderAccess(request: Request, orderId: string): Promise<OrderAccessResult> {
  const token = readOrderToken(request);
  const viaToken = await resolveTokenAccess(token, orderId);
  if (viaToken.ok) return viaToken;

  const session = await getAuthSession();
  if (session) return { ok: true, access: { via: "session", customerId: session.customerId, tenantId: session.tenantId } };
  return viaToken;
}

export function accessDeniedResponse(status: 401 | 403 | 404): Response {
  if (status === 401) return unauthorizedResponse();
  return Response.json(
    { error: status === 403 ? "Link de pagamento inválido ou expirado." : "Pedido não encontrado." },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
