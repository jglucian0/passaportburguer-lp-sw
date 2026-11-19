import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { NextResponse } from "next/server";

import { whatsappInitBody } from "@/core/schemas/auth";
import { fail, findCustomerByPhone, isRegistered, parseBody } from "@/infra/auth/account";
import {
  buildOtpRequestUrl,
  buildWaUrl,
  generateEmbarkCode,
  getOtpDelivery,
  getWhatsappAuthMode,
  OTP_TTL_MS,
  phoneVariants,
  type OtpDelivery,
} from "@/infra/auth/otp";
import { db } from "@/infra/db";
import { whatsappOtps } from "@/infra/db/schema";
import { enforceRateLimit } from "@/infra/security/rate-limit";
import { getTenantRef } from "@/infra/tenant/resolve";
import { errorSummary } from "@/infra/whatsapp/log";
import { sendAuthTemplate } from "@/infra/whatsapp/client";

export const dynamic = "force-dynamic";

/**
 * Resposta ao cliente. No modo "inbound" o código é exibido (o cliente o envia pelo wa.me).
 * Nos modos "window"/"template" o código NUNCA sai daqui: ele só chega pelo WhatsApp e o cliente o digita.
 */
function payload(delivery: OtpDelivery, code: string, expiresAt: Date, now: Date) {
  const base = {
    delivery,
    mode: getWhatsappAuthMode(),
    expiresIn: Math.max(1, Math.round((expiresAt.getTime() - now.getTime()) / 1000)),
    expiresAt: expiresAt.getTime(),
  };
  if (delivery === "inbound") return { ...base, code, waUrl: buildWaUrl(code) };
  if (delivery === "window") return { ...base, waUrl: buildOtpRequestUrl() };
  return base;
}

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "auth:whatsapp-init", 5, 300);
  if (limited) return limited;

  const body = await parseBody(request, whatsappInitBody);
  if (body.error) return body.error;
  const local = body.data.phone;
  const phone = `55${local}`;

  const delivery = getOtpDelivery();
  const templateName = process.env.WHATSAPP_OTP_TEMPLATE?.trim();
  const templateLang = process.env.WHATSAPP_OTP_TEMPLATE_LANG?.trim() || "pt_BR";

  /* "window" e "inbound" dependem do número da loja (wa.me); "template" depende do template aprovado. */
  if (delivery === "template" ? !templateName : !buildWaUrl("PASS-0000")) {
    console.error(
      delivery === "template" ? "[whatsapp] WHATSAPP_OTP_TEMPLATE não configurado." : "[whatsapp] STORE_WHATSAPP não configurado.",
    );
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
  /* Higiene: expirados somem. */
  await db.delete(whatsappOtps).where(lt(whatsappOtps.expiresAt, now));

  /* Idempotência: se já há código ativo (não verificado, dentro da validade) para o número
     (com/sem 9º dígito), reaproveita — a aba pode ter sido recarregada ao voltar do WhatsApp. */
  const phones = phoneVariants(local).map((v) => `55${v}`);
  const [active] = await db
    .select({ code: whatsappOtps.code, expiresAt: whatsappOtps.expiresAt })
    .from(whatsappOtps)
    .where(
      and(
        inArray(whatsappOtps.phone, phones),
        eq(whatsappOtps.verified, false),
        gt(whatsappOtps.expiresAt, now),
      ),
    )
    .orderBy(desc(whatsappOtps.createdAt))
    .limit(1);
  if (active) {
    return NextResponse.json(payload(delivery, active.code, active.expiresAt, now), {
      headers: { "Cache-Control": "no-store" },
    });
  }

  /* Sem código ativo: limpa resíduos (ex.: verificados não consumidos) e cria um novo. */
  await db.delete(whatsappOtps).where(inArray(whatsappOtps.phone, phones));

  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateEmbarkCode();
    const inserted = await db
      .insert(whatsappOtps)
      .values({ phone, code, verified: false, expiresAt })
      .onConflictDoNothing({ target: whatsappOtps.code })
      .returning({ id: whatsappOtps.id });
    if (inserted.length === 0) continue;

    /* Produção: o servidor entrega o código por template de autenticação, sem o cliente mandar nada. */
    if (delivery === "template") {
      try {
        await sendAuthTemplate(phone, templateName!, templateLang, code);
      } catch (error) {
        console.error("[whatsapp-otp] falha ao enviar o template:", errorSummary(error));
        await db.delete(whatsappOtps).where(eq(whatsappOtps.id, inserted[0].id));
        return fail("Não foi possível enviar o código agora. Tente novamente.", 503);
      }
    }

    return NextResponse.json(payload(delivery, code, expiresAt, now), {
      headers: { "Cache-Control": "no-store" },
    });
  }
  return fail("Não foi possível gerar o código. Tente novamente.", 503);
}
