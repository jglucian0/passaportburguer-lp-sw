import { NextResponse } from "next/server";

import { getAuthSession } from "@/infra/auth/customer-session";

export const dynamic = "force-dynamic";

/** Quem está logado agora (só o primeiro nome). O cabeçalho usa isto para não mostrar um nome que sobrou no navegador. */
export async function GET() {
  const session = await getAuthSession();
  return NextResponse.json(
    { name: session ? session.name.trim().split(/\s+/)[0] : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
