import { NextResponse, type NextRequest } from "next/server";

import { submitQuickCart } from "@/infra/whatsapp/quick-cart";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Recebe a sacola do Cardápio Rápido. Autenticação = token assinado (HMAC) no corpo. */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Corpo inválido." }, { status: 400 });
  }
  const { status, body: payload } = await submitQuickCart(body);
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}
