"use server";

import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { loginSchema } from "@/core/schemas/admin";
import { clearAdminSessionCookie, setAdminSessionCookie } from "@/infra/auth/session";
import { db } from "@/infra/db";
import { adminUsers } from "@/infra/db/schema";
import { getTenantRef } from "@/infra/tenant/resolve";

import { failure, fromZod, type ActionFailure } from "./result";

// Hash descartável: mantém o tempo de resposta parecido quando o e-mail não existe.
const DUMMY_HASH = bcrypt.hashSync("passaportburguer-dummy", 10);

const INVALID_CREDENTIALS = "E-mail ou senha inválidos.";

/** Compatível com `useActionState`: (estadoAnterior, formData). Em sucesso, redireciona para /admin. */
export async function loginAdmin(
  _prevState: ActionFailure | null,
  formData: FormData,
): Promise<ActionFailure | null> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return fromZod(parsed.error);

  const ref = await getTenantRef();
  if (!ref) return failure("Loja não encontrada.");

  const [user] = await db
    .select()
    .from(adminUsers)
    .where(and(eq(adminUsers.tenantId, ref.id), eq(adminUsers.email, parsed.data.email)))
    .limit(1);

  const passwordOk = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk) return failure(INVALID_CREDENTIALS);

  await setAdminSessionCookie({
    userId: user.id,
    tenantId: user.tenantId,
    name: user.name,
    role: user.role,
  });

  redirect("/admin");
}

export async function logoutAdmin(): Promise<void> {
  await clearAdminSessionCookie();
  redirect("/admin/login");
}
