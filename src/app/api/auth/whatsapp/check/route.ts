import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { whatsappCheckBody } from "@/core/schemas/auth";
import { fail, findCustomerByPhone, isRegistered, parseBody } from "@/infra/auth/account";
import { createCustomerSession } from "@/infra/auth/customer-session";
import { getOtpDelivery, getWhatsappAuthMode } from "@/infra/auth/otp";
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

  if (!otp || otp.expiresAt.getTime() < Date.now()) {
    if (otp) await db.delete(whatsappOtps).where(eq(whatsappOtps.id, otp.id));
    return fail("Código expirado. Gere um novo código.", 410);
  }

  /* Conta já registrada entra só por senha: o código do WhatsApp nunca gera sessão para ela. */
  const ref = await getTenantRef();
  if (!ref) return fail("Loja não encontrada.", 404);
  const existing = await findCustomerByPhone(ref.id, local);
  if (existing && isRegistered(existing)) {
    await db.delete(whatsappOtps).where(eq(whatsappOtps.id, otp.id));
    return fail("Esta conta já foi verificada. Entre com sua senha.", 409);
  }

  let verified = otp.verified;
  /* Códigos digitados ("window"/"template"): acertar o código que chegou no WhatsApp É a prova de posse.
     Erros são contados por telefone para barrar tentativa e erro (espaço de 32^4 códigos). */
  if (typedMode && !verified) {
    if (otp.code !== code) {
      const attempt = await checkRateLimit({
        identifier: phone,
        route: "auth:otp-wrong-code",
        limit: 5,
        windowSeconds: 600,
        failClosed: true,
      });
      if (!attempt.allowed) {
        await db.delete(whatsappOtps).where(eq(whatsappOtps.id, otp.id));
        return fail("Muitas tentativas incorretas. Gere um novo código.", 429);
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

  /* Já existe (com ou sem o 9º dígito)? Reaproveita em vez de criar duplicata. */
  if (!existing) {
    await db
      .insert(customers)
      .values({ tenantId: ref.id, name: "", phone: local })
      .onConflictDoNothing({ target: [customers.tenantId, customers.phone] });
  }

  const customer = await findCustomerByPhone(ref.id, local);
  if (!customer) return fail("Não foi possível concluir agora. Tente novamente.", 500);

  await createCustomerSession(customer.id);

  return NextResponse.json(
    { status: "verified", needsRegistration: true, name: customer.name, phone: customer.phone },
    { headers: { "Cache-Control": "no-store" } },
  );
}
