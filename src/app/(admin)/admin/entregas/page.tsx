import type { Metadata } from "next";

import { getAdminDeliveryRules } from "@/actions/admin";
import { AdminShell } from "@/components/admin/admin-shell";
import { DeliveryRulesForm } from "@/components/admin/delivery-rules-form";
import { requireOwner } from "@/infra/auth/admin-guard";

export const metadata: Metadata = { title: "Entregas | Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminDeliveryPage() {
  const session = await requireOwner();

  const rules = await getAdminDeliveryRules();

  return (
    <AdminShell userName={session.name} role={session.role}>
      {rules ? (
        <DeliveryRulesForm rules={rules} />
      ) : (
        <p className="py-16 text-center text-sm text-slate-500">Loja não encontrada.</p>
      )}
    </AdminShell>
  );
}
