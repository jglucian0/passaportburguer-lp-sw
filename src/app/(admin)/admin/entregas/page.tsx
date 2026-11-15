import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAdminDeliveryZones } from "@/actions/admin";
import { AdminShell } from "@/components/admin/admin-shell";
import { ZonesManager } from "@/components/admin/zones-manager";
import { getAdminSession } from "@/infra/auth/session";

export const metadata: Metadata = { title: "Entregas | Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminDeliveryPage() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");

  const zones = await getAdminDeliveryZones();

  return (
    <AdminShell userName={session.name} role={session.role}>
      <ZonesManager zones={zones} />
    </AdminShell>
  );
}
