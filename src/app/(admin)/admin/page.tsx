import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAdminOrders, getAdminStoreSettings } from "@/actions/admin";
import { AdminShell } from "@/components/admin/admin-shell";
import { OrderBoard } from "@/components/admin/order-board";
import { SoundAlert } from "@/components/admin/sound-alert";
import { StoreToggle } from "@/components/admin/store-toggle";
import { getAdminSession } from "@/infra/auth/session";

export const metadata: Metadata = { title: "Pedidos | Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");

  const [orders, settings] = await Promise.all([getAdminOrders(), getAdminStoreSettings()]);

  return (
    <AdminShell userName={session.name} role={session.role}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Gestor de pedidos</h1>
          <p className="text-xs text-muted">Atualiza automaticamente a cada 15 segundos com a aba aberta.</p>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <SoundAlert />
          {settings ? <StoreToggle isManuallyClosed={settings.isManuallyClosed} /> : null}
        </div>
      </div>

      <OrderBoard orders={orders} />
    </AdminShell>
  );
}
