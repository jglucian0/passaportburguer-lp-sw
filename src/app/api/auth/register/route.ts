import { and, eq, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { registerBody } from "@/core/schemas/auth";
import { fail, parseBody } from "@/infra/auth/account";
import { getAuthSession, unauthorizedResponse } from "@/infra/auth/customer-session";
import { db } from "@/infra/db";
import { customers } from "@/infra/db/schema";
import { enforceRateLimit } from "@/infra/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Conclui o cadastro (nome + CPF) logo após a validação do WhatsApp, que já criou a sessão.
 * Só preenche o que falta: quem já tem nome e CPF não é sobrescrito (idempotente).
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "auth:register", 8, 60);
  if (limited) return limited;

  const body = await parseBody(request, registerBody);
  if (body.error) return body.error;
  const { name, document } = body.data;

  const session = await getAuthSession();
  if (!session) return unauthorizedResponse();

  const updated = await db
    .update(customers)
    .set({ name, ...(document ? { documentNumber: document } : {}), phoneVerifiedAt: sql`COALESCE(${customers.phoneVerifiedAt}, now())` })
    .where(
      and(
        eq(customers.id, session.customerId),
        eq(customers.tenantId, session.tenantId),
        or(sql`${customers.documentNumber} IS NULL`, sql`btrim(${customers.name}) = ''`),
      ),
    )
    .returning({ name: customers.name, phone: customers.phone });
  if (updated.length > 0) {
    return NextResponse.json(updated[0], { headers: { "Cache-Control": "no-store" } });
  }

  /* Já completo: devolve o cadastro existente. */
  const [current] = await db
    .select({ name: customers.name, phone: customers.phone })
    .from(customers)
    .where(and(eq(customers.id, session.customerId), eq(customers.tenantId, session.tenantId)))
    .limit(1);
  if (!current) return fail("Cadastro não encontrado.", 404);
  return NextResponse.json(current, { headers: { "Cache-Control": "no-store" } });
}
