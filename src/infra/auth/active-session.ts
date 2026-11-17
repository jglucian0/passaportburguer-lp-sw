import { and, eq } from "drizzle-orm";

import { db } from "@/infra/db";
import { adminUsers } from "@/infra/db/schema";

import { getAdminSession, type AdminSession } from "./session";

/**
 * Sessão admin válida E com o usuário ainda ativo no banco.
 * O JWT é stateless; sem esta checagem, desativar um operador não derrubaria o acesso dele.
 * Fica fora de session.ts porque o middleware (edge) importa aquele arquivo.
 */
export async function getActiveAdminSession(): Promise<AdminSession | null> {
  const session = await getAdminSession();
  if (!session) return null;
  const [user] = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(
      and(
        eq(adminUsers.id, session.userId),
        eq(adminUsers.tenantId, session.tenantId),
        eq(adminUsers.isActive, true),
      ),
    )
    .limit(1);
  return user ? session : null;
}
