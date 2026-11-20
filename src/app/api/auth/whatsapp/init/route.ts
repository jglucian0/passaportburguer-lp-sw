import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { NextResponse } from "next/server";

import { whatsappInitBody } from "@/core/schemas/auth";
import { fail, parseBody } from "@/infra/auth/account";
import {
  buildOtpRequestUrl,
  buildWaUrl,
  generateEmbarkCode,
  generateOtpCode,
  getOtpDelivery,
  getWhatsappAuthMode,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_MS,
  phoneVariants,
  type OtpDelivery,
} from "@/infra/auth/otp";
import { guardOtpSend } from "@/infra/auth/otp-guard";
import { db } from "@/infra/db";
import { whatsappOtps } from "@/infra/db/schema";
import { enforceRateLimit, getClientIp } from "@/infra/security/rate-limit";
import { verifyTurnstile } from "@/infra/security/turnstile";
import { getTenantRef } from "@/infra/tenant/resolve";
import { sendAuthTemplate } from "@/infra/whatsapp/client";
import { errorSummary } from "@/infra/whatsapp/log";
import { describeOtpSendError } from "@/infra/whatsapp/otp-template";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

type ActiveOtp = { code: string; createdAt: Date; expiresAt: Date };

/**
 * Resposta ao cliente. No modo "inbound" o código é exibido (o cliente o envia pelo wa.me).
 * Nos modos "window"/"template" o código NUNCA sai daqui: ele só chega pelo WhatsApp e o cliente o digita.
 * `resendAt`: quando o botão "Reenviar" libera (cooldown de 60 s contado desde a criação do código).
 */
function payload(delivery: OtpDelivery, otp: ActiveOtp, now: Date) {
  const base = {
    delivery,
    mode: getWhatsappAuthMode(),
    expiresIn: Math.max(1, Math.round((otp.expiresAt.getTime() - now.getTime()) / 1000)),
    expiresAt: otp.expiresAt.getTime(),
    resendAt: otp.createdAt.getTime() + OTP_RESEND_COOLDOWN_SECONDS * 1000,
  };
  if (delivery === "inbound") return { ...base, code: otp.code, waUrl: buildWaUrl(otp.code) };
  if (delivery === "window") return { ...base, waUrl: buildOtpRequestUrl() };
  return base;
}

function blocked(message: string, status: number, retryAfterSeconds?: number) {
  return NextResponse.json(
    { error: message, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) },
    {
      status,
      headers: { ...NO_STORE, ...(retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : {}) },
    },
  );
}

async function findActiveOtp(phones: string[], now: Date): Promise<ActiveOtp | null> {
  const [row] = await db
    .select({ code: whatsappOtps.code, createdAt: whatsappOtps.createdAt, expiresAt: whatsappOtps.expiresAt })
    .from(whatsappOtps)
    .where(and(inArray(whatsappOtps.phone, phones), eq(whatsappOtps.verified, false), gt(whatsappOtps.expiresAt, now)))
    .orderBy(desc(whatsappOtps.createdAt))
    .limit(1);
  return row ?? null;
}

/** Cria o código (único no banco); null se não achou um livre em 5 sorteios. */
async function insertOtp(phone: string, delivery: OtpDelivery, now: Date): Promise<(ActiveOtp & { id: string }) | null> {
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
  for (let attempt = 0; attempt < 5; attempt++) {
    /* inbound (legado): PASS-XXXX achado na mensagem; window/template: 6 dígitos digitados no site. */
    const code = delivery === "inbound" ? generateEmbarkCode() : generateOtpCode();
    const inserted = await db
      .insert(whatsappOtps)
      .values({ phone, code, verified: false, expiresAt })
      .onConflictDoNothing({ target: whatsappOtps.code })
      .returning({ id: whatsappOtps.id });
    if (inserted.length > 0) return { id: inserted[0].id, code, createdAt: now, expiresAt };
  }
  return null;
}

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "auth:whatsapp-init", 5, 300);
  if (limited) return limited;

  const body = await parseBody(request, whatsappInitBody);
  if (body.error) return body.error;
  const local = body.data.phone;
  const phone = `55${local}`;
  const ip = getClientIp(request.headers);

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

  const ref = await getTenantRef();
  if (!ref) return fail("Loja não encontrada.", 404);

  const now = new Date();
  /* Higiene: expirados somem. */
  await db.delete(whatsappOtps).where(lt(whatsappOtps.expiresAt, now));

  /* Código ativo + sem pedido de reenvio: devolve o estado (aba recarregada ao voltar do WhatsApp). Não envia nada. */
  const phones = phoneVariants(local).map((v) => `55${v}`);
  const active = await findActiveOtp(phones, now);
  if (active && !body.data.resend) {
    return NextResponse.json(payload(delivery, active, now), { headers: NO_STORE });
  }

  /* A partir daqui haverá um código novo (e, em "template", uma mensagem paga): barreiras anti-abuso, na ordem. */
  const human = await verifyTurnstile(body.data.turnstileToken, ip);
  if (!human.ok) return blocked(human.error, 403);

  if (delivery === "template") {
    const guard = await guardOtpSend({ phone, ip });
    if (!guard.ok) return blocked(guard.message, 429, guard.retryAfterSeconds);
  }

  /* Reenvio invalida o código anterior; sem código ativo, limpa resíduos (ex.: verificados não consumidos). */
  await db.delete(whatsappOtps).where(inArray(whatsappOtps.phone, phones));

  const created = await insertOtp(phone, delivery, now);
  if (!created) return fail("Não foi possível gerar o código. Tente novamente.", 503);

  if (delivery === "template") {
    try {
      await sendAuthTemplate(phone, templateName!, templateLang, created.code);
    } catch (error) {
      console.error("[whatsapp-otp] falha ao enviar o template:", errorSummary(error));
      await db.delete(whatsappOtps).where(eq(whatsappOtps.id, created.id));
      const failure = describeOtpSendError(error);
      return blocked(failure.message, failure.status);
    }
  }

  return NextResponse.json(payload(delivery, created, now), { headers: NO_STORE });
}
