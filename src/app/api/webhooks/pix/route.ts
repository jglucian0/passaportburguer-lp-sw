import { timingSafeEqual } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/infra/db";
import { orders } from "@/infra/db/schema";
import { sendOrderToSaipos } from "@/lib/saipos";
import { loadStoreSettings } from "@/infra/db/store-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Payload genérico (adapte o gateway para enviar neste formato ou converta antes):
 * { "orderId": "<uuid>", "status": "PAID" }
 * Autenticação: header `x-webhook-secret` igual a PIX_WEBHOOK_SECRET.
 */
const payloadSchema = z.object({
  orderId: z.string().uuid(),
  status: z.literal("PAID"),
});

function secretMatches(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.PIX_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "Webhook não configurado." }, { status: 503 });
  }

  if (!secretMatches(request.headers.get("x-webhook-secret"), expectedSecret)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  // Idempotente: só confirma pedidos PIX ainda aguardando pagamento.
  const [target] = await db
    .select({ tenantId: orders.tenantId })
    .from(orders)
    .where(eq(orders.id, parsed.data.orderId))
    .limit(1);
  const settings = target ? await loadStoreSettings(target.tenantId) : null;

  const updated = await db
    .update(orders)
    .set({ status: settings?.autoAcceptOrders ? "PREPARING" : "RECEIVED", updatedAt: new Date() })
    .where(
      and(
        eq(orders.id, parsed.data.orderId),
        eq(orders.paymentMethod, "PIX"),
        eq(orders.status, "AWAITING_PAYMENT"),
      ),
    )
    .returning({ id: orders.id });

  // Pagamento confirmado: agora o pedido PIX pode ir para o Saipos (falhas ficam registradas no pedido).
  if (updated.length > 0) {
    after(() => sendOrderToSaipos(parsed.data.orderId));
  }

  return NextResponse.json({ ok: true, updated: updated.length });
}
