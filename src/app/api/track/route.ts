import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { db } from "@/infra/db";
import { funnelEvents, type FunnelEventType } from "@/infra/db/schema";
import { checkRateLimit, getClientIp } from "@/infra/security/rate-limit";
import { getTenantId } from "@/infra/whatsapp/shared";
import { ATTRIBUTION_COOKIE, sanitizeAttribution } from "@/lib/attribution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EVENTS: readonly FunnelEventType[] = ["VISIT", "VIEW_PRODUCT", "ADD_TO_CART", "CHECKOUT"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse/i;

/** Funil do cardápio: recebe um evento anônimo (sem dados pessoais). Sempre 204 para não atrapalhar a tela. */
export async function POST(request: Request) {
  const done = () => new NextResponse(null, { status: 204 });
  try {
    if (BOT.test(request.headers.get("user-agent") ?? "")) return done();
    const body = (await request.json().catch(() => null)) as { event?: unknown; visitorId?: unknown; productId?: unknown } | null;
    const event = EVENTS.find((e) => e === body?.event);
    const visitorId = typeof body?.visitorId === "string" && UUID.test(body.visitorId) ? body.visitorId : null;
    if (!event || !visitorId) return done();
    const productId = typeof body?.productId === "string" && UUID.test(body.productId) ? body.productId : null;

    const limit = await checkRateLimit({ identifier: getClientIp(request.headers), route: "track", limit: 240, windowSeconds: 600 });
    if (!limit.allowed) return done();

    const tenantId = await getTenantId();
    if (!tenantId) return done();

    let source: string | null = null;
    try {
      const raw = (await cookies()).get(ATTRIBUTION_COOKIE)?.value;
      if (raw) source = sanitizeAttribution(JSON.parse(raw))?.source ?? null;
    } catch {
      /* sem origem */
    }

    await db.insert(funnelEvents).values({ tenantId, visitorId, event, productId, source });
  } catch {
    /* rastreio nunca falha para o cliente */
  }
  return done();
}
