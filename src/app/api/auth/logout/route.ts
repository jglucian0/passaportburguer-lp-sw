import { NextResponse } from "next/server";

import { revokeCurrentSession } from "@/infra/auth/customer-session";

export const dynamic = "force-dynamic";

/** Revoga a sessão no banco e apaga o cookie. */
export async function POST() {
  await revokeCurrentSession();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
