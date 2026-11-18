import bcrypt from "bcryptjs";
import { and, eq, gt, lt, sql } from "drizzle-orm";
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

  /* Cada tentativa é "gasta" antes da comparação, num único UPDATE atômico condicionado ao limite:
     requisições paralelas não conseguem exceder RESET_MAX_ATTEMPTS. */
  const [reset] = await db
    .update(passwordResets)
    .set({ attempts: sql`${passwordResets.attempts} + 1` })
    .where(
      and(
        eq(passwordResets.customerId, customer.id),
        lt(passwordResets.attempts, RESET_MAX_ATTEMPTS),
        gt(passwordResets.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!reset) {
    /* Sem código, expirado ou com tentativas esgotadas: descarta o que sobrou. */
    await db.delete(passwordResets).where(eq(passwordResets.customerId, customer.id));
    return reject();
  }

  const expected = Buffer.from(reset.tokenHash, "hex");
  const given = Buffer.from(hashResetCode(customer.id, code), "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return reject();

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
