import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { runPaymentRecovery } from "@/infra/marketing/payment-recovery";
import { runWinbackCampaign } from "@/infra/marketing/campaigns";
import { dispatchDueFollowups } from "@/infra/whatsapp/followups";
import { retryStalledInbox } from "@/infra/whatsapp/inbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const a = createHash("sha256").update(header.slice(7)).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

/**
 * Envia os retornos agendados (cliente que falou com a loja fechada) e roda a campanha de resgate. Chamar a cada ~5 min com
 * `Authorization: Bearer ${CRON_SECRET}`. Sem CRON_SECRET a rota fica desligada.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Primeiro, atendimentos que ficaram sem resposta por falha momentânea (reenvio silencioso).
  const retried = await retryStalledInbox().catch(() => 0);
  const summary = await dispatchDueFollowups();
  // Mesmo agendador: depois dos retornos, roda a campanha de resgate (desligada por padrão).
  const campaign = await runWinbackCampaign().catch((error) => {
    console.error("[marketing] campanha falhou:", error instanceof Error ? error.message : "erro");
    return { ran: false, reason: "ERROR" };
  });
  const paymentRecovery = await runPaymentRecovery().catch(() => ({ sent: 0, skipped: 0 }));
  return NextResponse.json({ ok: true, retried, ...summary, campaign, paymentRecovery }, { headers: { "Cache-Control": "no-store" } });
}
