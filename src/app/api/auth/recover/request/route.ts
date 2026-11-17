import { eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";

import { recoverRequestBody } from "@/core/schemas/auth";
import {
  fail,
  findCustomerByPhone,
  generateResetCode,
  hashResetCode,
  isRegistered,
  parseBody,
  RESET_TTL_MS,
  sendResetEmail,
} from "@/infra/auth/account";
import { db } from "@/infra/db";
import { passwordResets } from "@/infra/db/schema";
import { enforceRateLimit } from "@/infra/security/rate-limit";
import { getTenantRef } from "@/infra/tenant/resolve";

export const dynamic = "force-dynamic";

async function issueCode(tenantId: string, phone: string) {
  const customer = await findCustomerByPhone(tenantId, phone);
  if (!customer || !customer.email || !isRegistered(customer)) return;

  /* Reenvio em menos de 60s é ignorado em silêncio (evita spam de e-mail). */
  const recent = await db
    .select({ createdAt: passwordResets.createdAt })
    .from(passwordResets)
    .where(eq(passwordResets.customerId, customer.id));
  if (recent.some((r) => Date.now() - r.createdAt.getTime() < 60_000)) return;

  /* Um único código ativo por cliente. */
  await db.delete(passwordResets).where(eq(passwordResets.customerId, customer.id));

  const code = generateResetCode();
  await db.insert(passwordResets).values({
    customerId: customer.id,
    tokenHash: hashResetCode(customer.id, code),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });
  await sendResetEmail(customer.email, customer.name, code);
}

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "auth:recover", 5, 300);
  if (limited) return limited;

  const body = await parseBody(request, recoverRequestBody);
  if (body.error) return body.error;

  const ref = await getTenantRef();
  if (!ref) return fail("Loja não encontrada.", 404);

  /* Todo o trabalho (busca, gravação, e-mail) roda depois da resposta: a latência é a mesma
     exista a conta ou não, e a resposta nunca revela cadastros. */
  const { phone } = body.data;
  after(async () => {
    try {
      await issueCode(ref.id, phone);
    } catch (error) {
      console.error("[recover] falha ao emitir código:", error);
    }
  });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
