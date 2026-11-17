import type { Metadata } from "next";

import { getAdminMenu, getAdminStoreSettings } from "@/actions/admin";
import { AdminShell } from "@/components/admin/admin-shell";
import { KdsBoard } from "@/components/admin/kds-board";
import { requireOperator } from "@/infra/auth/admin-guard";
import { loadAdminOrders } from "@/infra/db/admin-orders";

export const metadata: Metadata = { title: "Pedidos | Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  const session = await requireOperator();

  const [orders, settings, menu] = await Promise.all([
    loadAdminOrders(session.tenantId),
    getAdminStoreSettings(),
    getAdminMenu(),
  ]);

  return (
    <AdminShell userName={session.name} role={session.role} fitViewport>
      <KdsBoard
        initialOrders={orders}
        initialNow={Date.now()}
        menu={menu}
        storeName={settings?.name ?? "Passaporte Burguer"}
      />
    </AdminShell>
  );
}
