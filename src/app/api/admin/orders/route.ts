import { NextResponse } from "next/server";

import { getActiveAdminSession as getAdminSession } from "@/infra/auth/active-session";
import { isOperationalRole } from "@/infra/auth/session";
import { loadAdminOrders } from "@/infra/db/admin-orders";

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

  const orders = await loadAdminOrders(session.tenantId);

  return NextResponse.json(
    { orders, serverTime: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
