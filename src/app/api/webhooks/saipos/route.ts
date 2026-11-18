import { timingSafeEqual } from "node:crypto";

import { and, eq, or } from "drizzle-orm";
import { after, NextResponse, type NextRequest } from "next/server";

import type { DeliveryType, OrderStatus } from "@/core/schemas/common";
import { db } from "@/infra/db";
import { orders } from "@/infra/db/schema";
import { notifyOutForDelivery } from "@/infra/whatsapp/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Webhook de status do Saipos (cadastrar em "Configuração de Webhooks" no Saipos Developer).
 * Eventos (docs Saipos): CONFIRMED, READY_TO_DELIVER, DISPATCHED, CONCLUDED, CANCELLED.
 * Payload: { event, cod_store, order_id }.
 * A Saipos não documenta assinatura: cadastre a URL com o segredo na query
 * (/api/webhooks/saipos?secret=SAIPOS_WEBHOOK_SECRET). Também aceita x-webhook-secret / Bearer.
 */

function secretMatches(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalize(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function pick(body: Record<string, unknown>, keys: string[]): string | null {
  const nested = (body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
  for (const source of [body, nested]) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value) return value;
      if (typeof value === "number") return String(value);
    }
  }
  return null;
}

type Mapped = { status: OrderStatus } | "IGNORE";

/** Evento Saipos -> status interno (leva em conta o tipo de entrega). */
function mapEvent(event: string, deliveryType: DeliveryType): Mapped {
  switch (event) {
    case "CONFIRMED":
    case "ACEITO":
    case "EM_PREPARO":
      return { status: "PREPARING" };
    // "Aguardando entrega" do Saipos (pronto) e "saiu" (DISPATCHED) são o mesmo estágio para nós:
    // não dá para saber se já saiu, então os dois viram OUT_FOR_DELIVERY (rótulo "Aguardando entrega").
    case "READY_TO_DELIVER":
    case "PRONTO":
    case "DISPATCHED":
    case "SAIU_PARA_ENTREGA":
      return { status: deliveryType === "DELIVERY" ? "OUT_FOR_DELIVERY" : "READY_FOR_PICKUP" };
    case "CONCLUDED":
    case "CONCLUIDO":
      return { status: "DELIVERED" };
    case "CANCELLED":
    case "CANCELADO":
      return { status: "CANCELED" };
    default:
      return "IGNORE";
  }
}

/** Ordem do fluxo: o webhook só avança (eventos atrasados/duplicados não regridem o pedido). */
const RANK: Record<OrderStatus, number> = {
  AWAITING_PAYMENT: 0,
  RECEIVED: 1,
  PREPARING: 2,
  OUT_FOR_DELIVERY: 3,
  READY_FOR_PICKUP: 3,
  DELIVERED: 4,
  CANCELED: 5,
};

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.SAIPOS_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "Webhook não configurado." }, { status: 503 });
  }

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const received =
    request.headers.get("x-webhook-secret") ?? bearer ?? request.nextUrl.searchParams.get("secret");
  if (!secretMatches(received, expectedSecret)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }
  const payload = body as Record<string, unknown>;

  const codStore = pick(payload, ["cod_store"]);
  if (codStore && process.env.SAIPOS_STORE_ID && codStore !== process.env.SAIPOS_STORE_ID) {
    return NextResponse.json({ ok: true, updated: 0, reason: "other_store" });
  }

  const externalId = pick(payload, ["order_id", "id_order", "orderId", "external_id", "id"]);
  const event = normalize(pick(payload, ["status", "event", "order_status", "event_type"]));
  if (!externalId || !event) {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  // O order_id enviado ao Saipos é o UUID do pedido; saiposOrderId cobre ids próprios devolvidos por ele.
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(externalId);
  const [order] = await db
    .select({
      id: orders.id,
      status: orders.status,
      deliveryType: orders.deliveryType,
    })
    .from(orders)
    .where(uuid ? or(eq(orders.id, externalId), eq(orders.saiposOrderId, externalId)) : eq(orders.saiposOrderId, externalId))
    .limit(1);

  // 200 mesmo sem achar: evita retentativas infinitas do Saipos para pedidos que não são nossos.
  if (!order) return NextResponse.json({ ok: true, updated: 0, reason: "order_not_found" });

  const mapped = mapEvent(event, order.deliveryType);
  if (mapped === "IGNORE") return NextResponse.json({ ok: true, updated: 0, reason: "event_ignored" });

  const target = mapped.status;
  if (order.status === "CANCELED") {
    return NextResponse.json({ ok: true, updated: 0, reason: "already_canceled" });
  }
  // O Saipos permite cancelar mesmo depois de concluído: o cancelamento vale a partir de qualquer status
  // (inclusive DELIVERED) para os sistemas não ficarem divergentes. Os demais eventos só avançam.
  if (target !== "CANCELED") {
    if (order.status === "DELIVERED" || order.status === "AWAITING_PAYMENT") {
      return NextResponse.json({ ok: true, updated: 0, reason: "status_locked" });
    }
    if (RANK[target] <= RANK[order.status]) {
      return NextResponse.json({ ok: true, updated: 0, reason: "not_forward" });
    }
  }

  // Condicional ao status lido: protege contra corrida com o operador do /admin.
  const updated = await db
    .update(orders)
    .set({
      status: target,
      ...(target === "CANCELED" ? { cancelReason: "Cancelado pelo Saipos" } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, order.id), eq(orders.status, order.status)))
    .returning({ id: orders.id });

  if (updated.length > 0 && target === "OUT_FOR_DELIVERY") {
    after(() => notifyOutForDelivery(order.id));
  }

  return NextResponse.json({ ok: true, updated: updated.length });
}
