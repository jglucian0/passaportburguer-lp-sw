import { after, NextResponse } from "next/server";

import { getActiveAdminSession as getAdminSession } from "@/infra/auth/active-session";
import { isOperationalRole } from "@/infra/auth/session";
import { loadAdminOrders } from "@/infra/db/admin-orders";
import { expireAbandonedOrders } from "@/infra/payments/expire-orders";
import { checkRateLimit } from "@/infra/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Lista os pedidos do KDS (em andamento + concluídos hoje). Consumido por polling a cada 8s. */
export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  if (!isOperationalRole(session.role)) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  /* Varredura de pedidos abandonados (> 30 min em AWAITING_PAYMENT) acionada pelo KDS aberto, no
     máximo a cada 2 min por loja: não depende do plano de cron da hospedagem. */
  const sweep = await checkRateLimit({
    identifier: session.tenantId,
    route: "expire-sweep",
    limit: 1,
    windowSeconds: 120,
  });
  if (sweep.allowed) {
    after(() => expireAbandonedOrders({ tenantId: session.tenantId }).catch(() => undefined));
  }

  const orders = await loadAdminOrders(session.tenantId);

  return NextResponse.json(
    { orders, serverTime: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
