import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { loginBody } from "@/core/schemas/auth";
import { DUMMY_HASH, fail, findCustomerByPhone, isRegistered, parseBody } from "@/infra/auth/account";
import { createCustomerSession } from "@/infra/auth/customer-session";
import { db } from "@/infra/db";
import { customers } from "@/infra/db/schema";
import { enforceRateLimit } from "@/infra/security/rate-limit";
import { getTenantRef } from "@/infra/tenant/resolve";

export const dynamic = "force-dynamic";

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const INVALID = "WhatsApp ou senha inválidos.";

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "auth:login", 8, 60);
  if (limited) return limited;

  const body = await parseBody(request, loginBody);
  if (body.error) return body.error;
  const { phone, password } = body.data;

  const ref = await getTenantRef();
  if (!ref) return fail("Loja não encontrada.", 404);

  const customer = await findCustomerByPhone(ref.id, phone);

  /* Conta bloqueada: recusa na hora, sem sequer olhar a senha. */
  if (customer?.lockedUntil && customer.lockedUntil > new Date()) {
    const seconds = Math.ceil((customer.lockedUntil.getTime() - Date.now()) / 1000);
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    return NextResponse.json(
      { error: `Conta bloqueada por excesso de tentativas. Tente novamente em ${minutes} min.` },
      { status: 423, headers: { "Retry-After": String(seconds), "Cache-Control": "no-store" } },
    );
  }

  const registered = customer ? isRegistered(customer) : false;
  /* Sempre roda o bcrypt (hash descartável se não houver conta): tempo de resposta uniforme. */
  const ok = await bcrypt.compare(password, (registered && customer?.passwordHash) || DUMMY_HASH);

  if (!customer || !registered || !ok) {
    if (customer && registered) {
      /* Incremento atômico; ao chegar em 5 trava por 15 min e zera o contador. */
      await db
        .update(customers)
        .set({
          failedLoginAttempts: sql`CASE WHEN ${customers.failedLoginAttempts} + 1 >= ${MAX_FAILURES} THEN 0 ELSE ${customers.failedLoginAttempts} + 1 END`,
          lockedUntil: sql`CASE WHEN ${customers.failedLoginAttempts} + 1 >= ${MAX_FAILURES} THEN now() + make_interval(mins => ${LOCK_MINUTES}) ELSE ${customers.lockedUntil} END`,
        })
        .where(and(eq(customers.id, customer.id), eq(customers.tenantId, ref.id)));
    }
    return fail(INVALID, 401);
  }

  if (customer.failedLoginAttempts !== 0 || customer.lockedUntil) {
    await db
      .update(customers)
      .set({ failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(customers.id, customer.id));
  }

  await createCustomerSession(customer.id);
  return NextResponse.json(
    { name: customer.name, phone: customer.phone },
    { headers: { "Cache-Control": "no-store" } },
  );
}
