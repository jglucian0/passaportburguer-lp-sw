import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { registerBody } from "@/core/schemas/auth";
import { fail, parseBody } from "@/infra/auth/account";
import { getAuthSession, unauthorizedResponse } from "@/infra/auth/customer-session";
import { db } from "@/infra/db";
import { customers } from "@/infra/db/schema";
import { enforceRateLimit } from "@/infra/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Conclui o cadastro após a validação única do WhatsApp (que já criou a sessão).
 * Só funciona enquanto a conta ainda não tem senha — nunca sobrescreve uma senha existente.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "auth:register", 8, 60);
  if (limited) return limited;

  const body = await parseBody(request, registerBody);
  if (body.error) return body.error;
  const { name, email, password } = body.data;

  const session = await getAuthSession();
  if (!session) return unauthorizedResponse();

  const [taken] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.tenantId, session.tenantId), eq(customers.email, email)))
    .limit(1);
  if (taken && taken.id !== session.customerId) return fail("Este e-mail já está em uso.", 409);

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const updated = await db
      .update(customers)
      .set({ name, email, passwordHash, phoneVerifiedAt: new Date() })
      .where(
        and(
          eq(customers.id, session.customerId),
          eq(customers.tenantId, session.tenantId),
          isNull(customers.passwordHash),
        ),
      )
      .returning({ name: customers.name, phone: customers.phone });
    if (updated.length === 0) return fail("Cadastro já concluído. Entre com sua senha.", 409);
    return NextResponse.json(updated[0], { headers: { "Cache-Control": "no-store" } });
  } catch {
    return fail("Este e-mail já está em uso.", 409);
  }
}
