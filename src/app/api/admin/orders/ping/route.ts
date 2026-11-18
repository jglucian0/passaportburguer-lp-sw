import { count, eq, gt, max } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getActiveAdminSession as getAdminSession } from "@/infra/auth/active-session";
import { db } from "@/infra/db";
import { orders, whatsappSessions } from "@/infra/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const [row] = await db
    .select({ lastUpdatedAt: max(orders.updatedAt), total: count() })
    .from(orders)
    .where(eq(orders.tenantId, session.tenantId));

  /* Atendimentos humanos pedidos pelo bot do WhatsApp (bot pausado e ainda vigente). */
  const [handoffs] = await db
    .select({ total: count() })
    .from(whatsappSessions)
    .where(gt(whatsappSessions.botPausedUntil, new Date()));

  return NextResponse.json(
    {
      humanHandoffs: handoffs?.total ?? 0,
      lastUpdatedAt: row?.lastUpdatedAt ? row.lastUpdatedAt.toISOString() : null,
      total: row?.total ?? 0,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
