import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { phoneVariants } from "@/infra/auth/otp";
import { db } from "@/infra/db";
import { customers } from "@/infra/db/schema";

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
  /* Com ou sem o 9º dígito é a mesma pessoa; se houver duplicata antiga, prefere a conta com WhatsApp validado. */
  const rows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), inArray(customers.phone, phoneVariants(localPhone))))
    .limit(2);
  return rows.find((r) => r.phoneVerifiedAt !== null) ?? rows[0] ?? null;
}

/**
 * Cadastro completo = nome + CPF. Não existe senha: o cliente entra validando o WhatsApp
 * (código) a cada acesso, ou direto pelo link assinado do Cardápio Rápido.
 */
export function isProfileComplete(customer: { name: string; documentNumber: string | null }): boolean {
  return customer.name.trim().length >= 2 && !!customer.documentNumber;
}
