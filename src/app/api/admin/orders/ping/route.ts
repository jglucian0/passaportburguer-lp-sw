import { count, eq, max } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getActiveAdminSession as getAdminSession } from "@/infra/auth/active-session";
import { db } from "@/infra/db";
import { orders } from "@/infra/db/schema";

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

  return NextResponse.json(
    {
      lastUpdatedAt: row?.lastUpdatedAt ? row.lastUpdatedAt.toISOString() : null,
      total: row?.total ?? 0,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
