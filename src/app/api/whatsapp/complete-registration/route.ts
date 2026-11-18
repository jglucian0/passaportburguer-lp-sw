import { NextResponse, type NextRequest } from "next/server";

import { completeRegistration } from "@/infra/whatsapp/registration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Cadastro pós-pagamento. Identidade = token assinado (o corpo nunca informa o telefone). */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Corpo inválido." }, { status: 400 });
  }
  const { status, body: payload } = await completeRegistration(body);
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}
