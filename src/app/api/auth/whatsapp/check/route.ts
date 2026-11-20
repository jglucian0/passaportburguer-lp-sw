import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { whatsappCheckBody } from "@/core/schemas/auth";
import { fail, findCustomerByPhone, isProfileComplete, parseBody } from "@/infra/auth/account";
import { createCustomerSession } from "@/infra/auth/customer-session";
import {
  getOtpDelivery,
  getWhatsappAuthMode,
  isLockedAfterWrong,
  isOtpExpired,
  OTP_MAX_WRONG_ATTEMPTS,
  OTP_TTL_MS,
} from "@/infra/auth/otp";
import { db } from "@/infra/db";
import { customers, whatsappOtps } from "@/infra/db/schema";
import { checkRateLimit, enforceRateLimit } from "@/infra/security/rate-limit";
import { getTenantRef } from "@/infra/tenant/resolve";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  /* O cliente consulta a cada 3 s enquanto está no WhatsApp: limite próprio, mais folgado que o do init. */
  const limited = await enforceRateLimit(request, "auth:whatsapp-check", 120, 300);
  if (limited) return limited;

  const body = await parseBody(request, whatsappCheckBody);
  if (body.error) return body.error;
  const { phone: local, code, confirm } = body.data;
  const phone = `55${local}`;

  const typedMode = getOtpDelivery() !== "inbound";

  const [otp] = await db
    .select()
    .from(whatsappOtps)
    .where(
      typedMode
        ? eq(whatsappOtps.phone, phone)
        : and(eq(whatsappOtps.phone, phone), eq(whatsappOtps.code, code)),
    )
    .orderBy(desc(whatsappOtps.createdAt))
    .limit(1);

  if (!otp || isOtpExpired(otp.expiresAt)) {
    if (otp) await db.delete(whatsappOtps).where(eq(whatsappOtps.id, otp.id));
    return fail("Código expirado. Gere um novo código.", 410);
  }

  const ref = await getTenantRef();
  if (!ref) return fail("Loja não encontrada.", 404);
  const existing = await findCustomerByPhone(ref.id, local);

  let verified = otp.verified;
  /* Códigos digitados ("window"/"template"): acertar o código que chegou no WhatsApp É a prova de posse.
     Erros são contados POR CÓDIGO: na 5ª errada o código é apagado e só um novo código (com cooldown) resolve. */
  if (typedMode && !verified) {
    if (otp.code !== code) {
      const attempt = await checkRateLimit({
        identifier: otp.id,
        route: "auth:otp-wrong-code",
        limit: OTP_MAX_WRONG_ATTEMPTS,
        windowSeconds: OTP_TTL_MS / 1000,
        failClosed: true,
      });
      const wrongCount = attempt.allowed ? OTP_MAX_WRONG_ATTEMPTS - attempt.remaining : OTP_MAX_WRONG_ATTEMPTS + 1;
      if (isLockedAfterWrong(wrongCount)) {
        await db.delete(whatsappOtps).where(eq(whatsappOtps.id, otp.id));
        return fail("Muitas tentativas incorretas. Peça um novo código.", 429);
      }
      return fail("Código incorreto. Confira a mensagem do WhatsApp e tente de novo.", 400);
    }
    verified = true;
  }
  /* Sandbox: a confirmação do cliente no site basta. Em "meta", só o Webhook verifica. */
  if (!verified && confirm === true && getWhatsappAuthMode() === "sandbox") {
    verified = true;
  }
  if (!verified) return NextResponse.json({ status: "pending" });

  /* Consumo único: só quem apagar a linha segue (evita reuso concorrente). */
  const consumed = await db
    .delete(whatsappOtps)
    .where(eq(whatsappOtps.id, otp.id))
    .returning({ id: whatsappOtps.id });
  if (consumed.length === 0) return NextResponse.json({ status: "pending" });

  /* Já existe (com ou sem o 9º dígito)? Reaproveita em vez de criar duplicata. O número está provado agora. */
  if (!existing) {
    await db
      .insert(customers)
      .values({ tenantId: ref.id, name: "", phone: local, phoneVerifiedAt: new Date() })
      .onConflictDoNothing({ target: [customers.tenantId, customers.phone] });
  } else if (!existing.phoneVerifiedAt) {
    await db
      .update(customers)
      .set({ phoneVerifiedAt: new Date() })
      .where(and(eq(customers.id, existing.id), eq(customers.tenantId, ref.id)));
  }

  const customer = await findCustomerByPhone(ref.id, local);
  if (!customer) return fail("Não foi possível concluir agora. Tente novamente.", 500);

  await createCustomerSession(customer.id);

  return NextResponse.json(
    { status: "verified", needsRegistration: !isProfileComplete(customer), name: customer.name, phone: customer.phone },
    { headers: { "Cache-Control": "no-store" } },
  );
}
