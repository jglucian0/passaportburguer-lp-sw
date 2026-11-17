import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { recoverResetBody } from "@/core/schemas/auth";
import {
  DUMMY_HASH,
  fail,
  findCustomerByPhone,
  hashResetCode,
  isRegistered,
  parseBody,
  RESET_MAX_ATTEMPTS,
} from "@/infra/auth/account";
import { createCustomerSession, revokeAllSessions } from "@/infra/auth/customer-session";
import { db } from "@/infra/db";
import { customers, passwordResets } from "@/infra/db/schema";
import { enforceRateLimit } from "@/infra/security/rate-limit";
import { getTenantRef } from "@/infra/tenant/resolve";

export const dynamic = "force-dynamic";

const INVALID = "Código inválido ou expirado.";

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "auth:recover", 5, 300);
  if (limited) return limited;

  const body = await parseBody(request, recoverResetBody);
  if (body.error) return body.error;
  const { phone, code, password } = body.data;

  const ref = await getTenantRef();
  if (!ref) return fail("Loja não encontrada.", 404);

  /* Falhas gastam um bcrypt descartável: tempo parecido com o caminho de sucesso. */
  const reject = async () => {
    await bcrypt.compare(password, DUMMY_HASH);
    return fail(INVALID);
  };

  const customer = await findCustomerByPhone(ref.id, phone);
  if (!customer || !isRegistered(customer)) return reject();

  const [reset] = await db
    .select()
    .from(passwordResets)
    .where(eq(passwordResets.customerId, customer.id))
    .limit(1);
  if (!reset || reset.expiresAt.getTime() < Date.now() || reset.attempts >= RESET_MAX_ATTEMPTS) {
    if (reset) await db.delete(passwordResets).where(eq(passwordResets.id, reset.id));
    return reject();
  }

  const expected = Buffer.from(reset.tokenHash, "hex");
  const given = Buffer.from(hashResetCode(customer.id, code), "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    await db
      .update(passwordResets)
      .set({ attempts: reset.attempts + 1 })
      .where(eq(passwordResets.id, reset.id));
    return reject();
  }

  /* Consumo único: só quem apagar a linha segue (evita reuso concorrente). */
  const consumed = await db
    .delete(passwordResets)
    .where(eq(passwordResets.id, reset.id))
    .returning({ id: passwordResets.id });
  if (consumed.length === 0) return reject();

  await db
    .update(customers)
    .set({
      passwordHash: await bcrypt.hash(password, 10),
      failedLoginAttempts: 0,
      lockedUntil: null,
    })
    .where(eq(customers.id, customer.id));

  /* Nova senha: derruba todas as sessões antigas e abre uma nova. */
  await revokeAllSessions(customer.id);
  await createCustomerSession(customer.id);
  return NextResponse.json(
    { name: customer.name, phone: customer.phone },
    { headers: { "Cache-Control": "no-store" } },
  );
}
