import type { Metadata } from "next";

import { getAdminMiles } from "@/actions/admin";
import { AdminShell } from "@/components/admin/admin-shell";
import { MilesManager } from "@/components/admin/miles-manager";
import { requireOwner } from "@/infra/auth/admin-guard";

export const metadata: Metadata = { title: "Milhas | Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminMilesPage() {
  const session = await requireOwner();
  const data = await getAdminMiles();

  return (
    <AdminShell userName={session.name} role={session.role}>
      {data ? <MilesManager data={data} /> : <p className="py-16 text-center text-sm text-slate-500">Indisponível.</p>}
    </AdminShell>
  );
}
