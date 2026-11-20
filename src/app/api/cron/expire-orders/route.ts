import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { issueMonthlyTierBenefits } from "@/infra/miles/benefits";
import { runMilesExpiryReminders } from "@/infra/miles/reminders";
import { expireAbandonedOrders } from "@/infra/payments/expire-orders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(header: string | null, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const a = createHash("sha256").update(header.slice(7)).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

/** Vercel Cron envia `Authorization: Bearer ${CRON_SECRET}`. Sem CRON_SECRET a rota fica desligada. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const expired = await expireAbandonedOrders();
  const milesReminders = await runMilesExpiryReminders().catch(() => ({ sent: 0, skipped: 0 }));
  const benefits = await issueMonthlyTierBenefits().catch(() => ({ issued: 0 }));
  return NextResponse.json({ ok: true, expired, milesReminders, benefits }, { headers: { "Cache-Control": "no-store" } });
}
