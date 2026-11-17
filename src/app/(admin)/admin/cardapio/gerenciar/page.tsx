import type { Metadata } from "next";

import { getAdminMenu } from "@/actions/admin";
import { AdminShell } from "@/components/admin/admin-shell";
import { MenuManager } from "@/components/admin/menu-manager";
import { requireOwner } from "@/infra/auth/admin-guard";

export const metadata: Metadata = { title: "Gerenciar cardápio | Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminMenuManagePage() {
  const session = await requireOwner();

  const categories = await getAdminMenu();

  return (
    <AdminShell userName={session.name} role={session.role}>
      <MenuManager categories={categories} />
    </AdminShell>
  );
}
