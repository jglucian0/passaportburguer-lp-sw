import type { Metadata } from "next";

import { getAdminMarketing } from "@/actions/admin";
import { AdminShell } from "@/components/admin/admin-shell";
import { MarketingForm } from "@/components/admin/marketing-form";
import { requireOwner } from "@/infra/auth/admin-guard";

export const metadata: Metadata = { title: "Marketing | Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminMarketingPage() {
  const session = await requireOwner();
  const data = await getAdminMarketing();

  return (
    <AdminShell userName={session.name} role={session.role}>
      {data ? <MarketingForm data={data} /> : <p className="py-16 text-center text-sm text-slate-500">Indisponível.</p>}
    </AdminShell>
  );
}
