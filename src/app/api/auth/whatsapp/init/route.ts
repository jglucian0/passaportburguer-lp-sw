import { eq, lt } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
  buildWaUrl,
  generateEmbarkCode,
  getWhatsappAuthMode,
  normalizeBrPhone,
  OTP_TTL_MS,
} from "@/infra/auth/otp";
import { db } from "@/infra/db";
import { whatsappOtps } from "@/infra/db/schema";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { phone?: unknown } | null;
  const phone = typeof body?.phone === "string" ? normalizeBrPhone(body.phone) : null;
  if (!phone) {
    return NextResponse.json({ error: "Informe um WhatsApp válido com DDD." }, { status: 400 });
  }
  if (!buildWaUrl("PASS-0000")) {
    console.error("[whatsapp] NEXT_PUBLIC_STORE_WHATSAPP não configurado.");
    return NextResponse.json({ error: "Login por WhatsApp indisponível no momento." }, { status: 503 });
  }

  const now = new Date();
  /* Higiene: expirados somem; um único código ativo por número. */
  await db.delete(whatsappOtps).where(lt(whatsappOtps.expiresAt, now));
  await db.delete(whatsappOtps).where(eq(whatsappOtps.phone, phone));

  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateEmbarkCode();
    const inserted = await db
      .insert(whatsappOtps)
      .values({ phone, code, verified: false, expiresAt })
      .onConflictDoNothing({ target: whatsappOtps.code })
      .returning({ id: whatsappOtps.id });
    if (inserted.length > 0) {
      return NextResponse.json({
        code,
        waUrl: buildWaUrl(code),
        mode: getWhatsappAuthMode(),
        expiresIn: OTP_TTL_MS / 1000,
      });
    }
  }
  return NextResponse.json({ error: "Não foi possível gerar o código. Tente novamente." }, { status: 503 });
}
