import type { Metadata } from "next";

import { getAdminStoreSettings, getAdminTeam } from "@/actions/admin";
import { AdminShell } from "@/components/admin/admin-shell";
import { StoreSettingsForm } from "@/components/admin/store-settings-form";
import { TeamManager } from "@/components/admin/team-manager";
import { requireOwner } from "@/infra/auth/admin-guard";

export const metadata: Metadata = { title: "Configurações | Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminConfigPage() {
  const session = await requireOwner();

  const [settings, team] = await Promise.all([getAdminStoreSettings(), getAdminTeam()]);

  return (
    <AdminShell userName={session.name} role={session.role}>
      {settings ? (
        <StoreSettingsForm settings={settings} role={session.role}>
          {session.role === "OWNER" ? <TeamManager members={team} currentUserId={session.userId} /> : null}
        </StoreSettingsForm>
      ) : (
        <p className="py-16 text-center text-sm text-slate-500">Loja não encontrada.</p>
      )}
    </AdminShell>
  );
}
