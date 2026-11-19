import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getStorefrontData } from "@/actions/storefront";
import { MilesView } from "@/components/storefront/miles-view";
import { StorefrontShell } from "@/components/storefront/storefront-shell";
import { getAuthSession } from "@/infra/auth/customer-session";
import { db } from "@/infra/db";
import { customers } from "@/infra/db/schema";
import { getMilesAccount } from "@/infra/miles/miles";
import { getMissionViews } from "@/infra/miles/missions";
import { eq } from "drizzle-orm";

export const metadata: Metadata = { title: "Minhas milhas", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MilesPage() {
  const [storefront, session] = await Promise.all([getStorefrontData(), getAuthSession()]);
  if (!storefront) {
    return <main className="flex min-h-dvh items-center justify-center p-6 text-center text-muted">Loja não encontrada.</main>;
  }
  // Sem login: a tela de entrada do Meu Passaporte (depois o cliente volta pelo menu).
  if (!session) redirect("/meus-pedidos");

  const [customer] = await db
    .select({ name: customers.name })
    .from(customers)
    .where(eq(customers.id, session.customerId))
    .limit(1);
  // Nunca derruba a página: se as tabelas de milhas ainda não existem (migração pendente), mostra "em breve".
  let account: Awaited<ReturnType<typeof getMilesAccount>> | null = null;
  let missions: Awaited<ReturnType<typeof getMissionViews>> = [];
  try {
    [account, missions] = await Promise.all([
      getMilesAccount(session.tenantId, session.customerId),
      getMissionViews(session.tenantId, session.customerId),
    ]);
  } catch (error) {
    console.error("[miles] falha ao carregar a página:", error instanceof Error ? error.message.split("\n")[0] : "erro");
  }
  const { tenant, categories, store } = storefront;

  return (
    <StorefrontShell tenant={tenant} store={store} categories={categories}>
      <div className="bg-[#071329] px-4 pb-10 pt-8 text-center">
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
          Minhas <span className="text-[#F59E0B]">Milhas</span>
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[#CBD5E1]">Cada pedido te leva mais longe. Acumule e troque por descontos.</p>
      </div>

      <div className="min-h-[calc(100dvh-64px)] bg-[#F4F6F9] px-4 pb-24 pt-6 text-[#0A2540]">
        <div className="mx-auto max-w-xl">
          <MilesView
            data={{
              enabled: account?.config.enabled ?? false,
              firstName: (customer?.name ?? "").trim().split(/\s+/)[0] ?? "",
              available: account?.balance.available ?? 0,
              expiringSoon: account?.balance.expiringSoon ?? 0,
              nextExpiry: account?.balance.nextExpiry?.toISOString() ?? null,
              milesPerReal: account?.config.milesPerReal ?? 0,
              rewards: account?.rewards ?? [],
              history: (account?.history ?? []).map((h) => ({ ...h, createdAt: h.createdAt.toISOString() })),
              coupons: (account?.activeCoupons ?? []).map((c) => ({ ...c, validUntil: c.validUntil?.toISOString() ?? null })),
              missions: missions.map((m) => ({
                id: m.id,
                name: m.name,
                period: m.period,
                bonusMiles: m.bonusMiles,
                minOrderCents: m.minOrderCents,
                done: m.progress.done,
                target: m.progress.target,
                awarded: m.awarded,
              })),
            }}
          />
        </div>
      </div>
    </StorefrontShell>
  );
}
