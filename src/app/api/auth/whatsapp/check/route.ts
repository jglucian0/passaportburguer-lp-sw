import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { setCustomerSessionCookie } from "@/infra/auth/session";
import { getWhatsappAuthMode, normalizeBrPhone, normalizeCode, toLocalPhone } from "@/infra/auth/otp";
import { db } from "@/infra/db";
import { customers, whatsappOtps } from "@/infra/db/schema";
import { getTenantRef } from "@/infra/tenant/resolve";

export const dynamic = "force-dynamic";

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    phone?: unknown;
    code?: unknown;
    confirm?: unknown;
  } | null;
  const phone = typeof body?.phone === "string" ? normalizeBrPhone(body.phone) : null;
  const code = normalizeCode(body?.code);
  if (!phone || !code) return fail("Dados inválidos.");

  const [otp] = await db
    .select()
    .from(whatsappOtps)
    .where(and(eq(whatsappOtps.phone, phone), eq(whatsappOtps.code, code)))
    .limit(1);

  if (!otp || otp.expiresAt.getTime() < Date.now()) {
    if (otp) await db.delete(whatsappOtps).where(eq(whatsappOtps.id, otp.id));
    return fail("Código expirado. Gere um novo código.", 410);
  }

  let verified = otp.verified;
  /* Sandbox: a confirmação do cliente no site basta. Em "meta", só o Webhook verifica. */
  if (!verified && body?.confirm === true && getWhatsappAuthMode() === "sandbox") {
    verified = true;
  }
  if (!verified) return NextResponse.json({ status: "pending" });

  /* Consumo único: só quem apagar a linha segue (evita reuso concorrente). */
  const consumed = await db
    .delete(whatsappOtps)
    .where(eq(whatsappOtps.id, otp.id))
    .returning({ id: whatsappOtps.id });
  if (consumed.length === 0) return NextResponse.json({ status: "pending" });

  const ref = await getTenantRef();
  if (!ref) return fail("Loja não encontrada.", 404);

  const local = toLocalPhone(phone);
  await db
    .insert(customers)
    .values({ tenantId: ref.id, name: "", phone: local })
    .onConflictDoNothing({ target: [customers.tenantId, customers.phone] });

  const [customer] = await db
    .select({ id: customers.id, name: customers.name, phone: customers.phone })
    .from(customers)
    .where(and(eq(customers.tenantId, ref.id), eq(customers.phone, local)))
    .limit(1);

  await setCustomerSessionCookie({ customerId: customer.id, tenantId: ref.id, phone: customer.phone });

  return NextResponse.json({
    status: "verified",
    needsName: customer.name.trim().length === 0,
    name: customer.name,
    phone: customer.phone,
  });
}
