import { redirect } from "next/navigation";

import { isOperationalRole, type AdminSession } from "./session";
import { getActiveAdminSession as getAdminSession } from "./active-session";

/** Páginas do painel: exige sessão operacional (OWNER ou KITCHEN). */
export async function requireOperator(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session || !isOperationalRole(session.role)) redirect("/admin/login");
  return session;
}

/** Páginas de cardápio/entregas/config: somente o proprietário; a cozinha volta ao KDS. */
export async function requireOwner(): Promise<AdminSession> {
  const session = await requireOperator();
  if (session.role !== "OWNER") redirect("/admin/pedidos");
  return session;
}
