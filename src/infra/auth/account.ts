import bcrypt from "bcryptjs";
import { createHmac, randomInt } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { buildPasswordRecoveryEmail } from "@/emails/password-recovery-email";
import { phoneVariants } from "@/infra/auth/otp";
import { db } from "@/infra/db";
import { maskEmail } from "@/infra/security/mask";
import { customers } from "@/infra/db/schema";


export const RESET_TTL_MS = 15 * 60 * 1000;
export const RESET_MAX_ATTEMPTS = 5;

/** Hash descartável: iguala o tempo de resposta quando a conta não existe. */
export const DUMMY_HASH = bcrypt.hashSync("passaporteburguer-dummy", 10);

export const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** Lê e valida o corpo JSON (limite de tamanho + Zod strict). Erro → resposta 400 pronta. */
export async function parseBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<{ data: z.infer<S>; error?: undefined } | { data?: undefined; error: NextResponse }> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 10_000) return { error: fail("Requisição inválida.", 413) };
  const raw = await request.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { error: fail(parsed.error.issues[0]?.message ?? "Dados inválidos.", 400) };
  }
  return { data: parsed.data };
}

export async function findCustomerByPhone(tenantId: string, localPhone: string) {
  /* Com ou sem o 9º dígito é a mesma pessoa; se houver duplicata antiga, prefere a conta já registrada. */
  const rows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), inArray(customers.phone, phoneVariants(localPhone))))
    .limit(2);
  return rows.find(isRegistered) ?? rows[0] ?? null;
}

/** Conta com WhatsApp validado e senha definida: o acesso é só por senha. */
export function isRegistered(customer: { phoneVerifiedAt: Date | null; passwordHash: string | null }) {
  return customer.phoneVerifiedAt !== null && customer.passwordHash !== null;
}

/* ------------------------- Código de recuperação ------------------------- */

export function generateResetCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashResetCode(customerId: string, code: string): string {
  const secret = process.env.AUTH_SECRET ?? "";
  return createHmac("sha256", secret).update(`${customerId}:${code}`).digest("hex");
}

/* ------------------------------- E-mail ---------------------------------- */

/** Envia via Resend; sem `RESEND_API_KEY`, apenas loga o código (somente fora de produção). */
export async function sendResetEmail(to: string, name: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      console.error("[recover] RESEND_API_KEY não configurada; e-mail de recuperação não enviado.");
    } else {
      console.log(`[recover] (dev) código de recuperação para ${maskEmail(to)}: ${code}`);
    }
    return;
  }

  const email = buildPasswordRecoveryEmail({ name, code });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? "Passaporte Burguer <onboarding@resend.dev>",
      to: [to],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });
  if (!res.ok) {
    /* Sem o corpo da resposta: o Resend pode ecoar o e-mail do destinatário. */
    console.error("[recover] Resend falhou:", res.status);
  }
}
