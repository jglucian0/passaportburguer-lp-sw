import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAdminStoreSettings } from "@/actions/admin";
import { AdminShell } from "@/components/admin/admin-shell";
import { StoreSettingsForm } from "@/components/admin/store-settings-form";
import { getAdminSession } from "@/infra/auth/session";

export const metadata: Metadata = { title: "Configurações | Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminConfigPage() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");

  const settings = await getAdminStoreSettings();

  return (
    <AdminShell userName={session.name} role={session.role}>
      {settings ? (
        <StoreSettingsForm settings={settings} role={session.role} />
      ) : (
        <p className="py-16 text-center text-sm text-muted">Loja não encontrada.</p>
      )}
    </AdminShell>
  );
}
