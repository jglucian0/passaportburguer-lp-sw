import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAdminMenu } from "@/actions/admin";
import { AdminShell } from "@/components/admin/admin-shell";
import { MenuManager } from "@/components/admin/menu-manager";
import { getAdminSession } from "@/infra/auth/session";

export const metadata: Metadata = { title: "Cardápio | Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminMenuPage() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");

  const categories = await getAdminMenu();

  return (
    <AdminShell userName={session.name} role={session.role}>
      <MenuManager categories={categories} />
    </AdminShell>
  );
}
