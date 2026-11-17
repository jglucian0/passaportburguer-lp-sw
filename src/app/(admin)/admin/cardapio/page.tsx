import type { Metadata } from "next";

import { getAdminCoupons, getAdminMenu } from "@/actions/admin";
import { AdminShell } from "@/components/admin/admin-shell";
import { AvailabilityBoard } from "@/components/admin/availability-board";
import { requireOperator } from "@/infra/auth/admin-guard";

export const metadata: Metadata = { title: "Cardápio | Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminMenuPage() {
  const session = await requireOperator();

  const [categories, coupons] = await Promise.all([getAdminMenu(), getAdminCoupons()]);

  return (
    <AdminShell userName={session.name} role={session.role}>
      <AvailabilityBoard categories={categories} role={session.role} coupons={coupons} />
    </AdminShell>
  );
}
