import { eq, lt } from "drizzle-orm";
import { NextResponse } from "next/server";

import { whatsappInitBody } from "@/core/schemas/auth";
import { fail, findCustomerByPhone, isRegistered, parseBody } from "@/infra/auth/account";
import { buildWaUrl, generateEmbarkCode, getWhatsappAuthMode, OTP_TTL_MS } from "@/infra/auth/otp";
import { db } from "@/infra/db";
import { whatsappOtps } from "@/infra/db/schema";
import { enforceRateLimit } from "@/infra/security/rate-limit";
import { getTenantRef } from "@/infra/tenant/resolve";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "auth:whatsapp-init", 5, 300);
  if (limited) return limited;

  const body = await parseBody(request, whatsappInitBody);
  if (body.error) return body.error;
  const local = body.data.phone;
  const phone = `55${local}`;

  if (!buildWaUrl("PASS-0000")) {
    console.error("[whatsapp] STORE_WHATSAPP não configurado.");
    return fail("Login por WhatsApp indisponível no momento.", 503);
  }

  /* Conta já verificada com senha: entra só por senha (nada de reverificar via WhatsApp). */
  const ref = await getTenantRef();
  if (!ref) return fail("Loja não encontrada.", 404);
  const existing = await findCustomerByPhone(ref.id, local);
  if (existing && isRegistered(existing)) {
    return fail("Esta conta já foi verificada. Entre com sua senha.", 409);
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
      return NextResponse.json(
        {
          code,
          waUrl: buildWaUrl(code),
          mode: getWhatsappAuthMode(),
          expiresIn: OTP_TTL_MS / 1000,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  return fail("Não foi possível gerar o código. Tente novamente.", 503);
}
