import { createHmac, timingSafeEqual } from "node:crypto";

import { and, eq, notExists, sql } from "drizzle-orm";
import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/infra/db";
import { orders, paymentEvents } from "@/infra/db/schema";
import { loadStoreSettings } from "@/infra/db/store-settings";
import { sendOrderToSaipos } from "@/lib/saipos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Payload genérico (adapte o gateway ou converta antes de chegar aqui):
 * { "eventId": "<id único do evento/transação>", "orderId": "<uuid>", "amountCents": 4590, "status": "PAID" }
 *
 * Autenticação: header `x-signature` = "sha256=" + HMAC-SHA256(corpo bruto, PIX_WEBHOOK_SECRET).
 * Ajuste o nome do header/algoritmo conforme o gateway escolhido.
 */
const payloadSchema = z
  .object({
    eventId: z.string().min(1).max(120),
    orderId: z.string().uuid(),
    amountCents: z.number().int().positive(),
    status: z.literal("PAID"),
  })
  .strict();

function validSignature(raw: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  const received = Buffer.from(header.slice(7), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function POST(request: NextRequest) {
  const secret = process.env.PIX_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook não configurado." }, { status: 503 });
  }

  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-signature"), secret)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }
  const { eventId, orderId, amountCents } = parsed.data;

  const [target] = await db
    .select({
      tenantId: orders.tenantId,
      status: orders.status,
      paymentMethod: orders.paymentMethod,
      totalCents: orders.totalCents,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!target || target.paymentMethod !== "PIX") {
    return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  }
  if (amountCents !== target.totalCents) {
    console.error(`[pix-webhook] valor divergente no pedido ${orderId} (evento ${eventId})`);
    return NextResponse.json({ error: "Valor divergente." }, { status: 422 });
  }
  if (target.status !== "AWAITING_PAYMENT") {
    // Já confirmado (reenvio do gateway) ou cancelado: responde 200 para cessar retentativas.
    return NextResponse.json({ ok: true, updated: 0, reason: "not_awaiting_payment" });
  }

  const settings = await loadStoreSettings(target.tenantId);

  /* Lote atômico: confirma o pedido (só se o evento ainda não existe) e grava o evento.
     Evento repetido => ambos viram no-op (UPDATE barrado pelo NOT EXISTS; INSERT por ON CONFLICT). */
  const [updated] = await db.batch([
    db
      .update(orders)
      .set({ status: settings?.autoAcceptOrders ? "PREPARING" : "RECEIVED", updatedAt: new Date() })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.paymentMethod, "PIX"),
          eq(orders.status, "AWAITING_PAYMENT"),
          eq(orders.totalCents, amountCents),
          notExists(
            db.select({ one: sql`1` }).from(paymentEvents).where(eq(paymentEvents.eventId, eventId)),
          ),
        ),
      )
      .returning({ id: orders.id }),
    db
      .insert(paymentEvents)
      .values({ eventId, orderId, amountCents })
      .onConflictDoNothing({ target: paymentEvents.eventId }),
  ]);

  // Pagamento confirmado: agora o pedido PIX pode ir para o Saipos (falhas ficam registradas no pedido).
  if (updated.length > 0) {
    after(() => sendOrderToSaipos(orderId));
  }

  return NextResponse.json({ ok: true, updated: updated.length });
}
