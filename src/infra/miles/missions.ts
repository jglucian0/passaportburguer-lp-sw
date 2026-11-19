import { and, asc, eq, gte, notInArray } from "drizzle-orm";

import { expiryFrom } from "@/core/miles/ledger";
import { missionProgress, periodRange, type CountableOrder, type MissionProgress } from "@/core/miles/missions";
import { db } from "@/infra/db";
import { milesLedger, milesMissionAwards, milesMissions, orders } from "@/infra/db/schema";

import { loadMilesConfig } from "./config";

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** Pedidos válidos (nem cancelados, nem aguardando pagamento) do cliente desde `since`. */
async function loadCountableOrders(tenantId: string, customerId: string, since: Date): Promise<CountableOrder[]> {
  const rows = await db
    .select({ createdAt: orders.createdAt, subtotalCents: orders.subtotalCents, discountCents: orders.discountCents })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, tenantId),
        eq(orders.customerId, customerId),
        notInArray(orders.status, ["CANCELED", "AWAITING_PAYMENT"]),
        gte(orders.createdAt, since),
      ),
    );
  return rows.map((r) => ({ createdAt: r.createdAt, itemsAfterDiscountCents: r.subtotalCents - r.discountCents }));
}

export type MissionView = {
  id: string;
  name: string;
  period: "WEEK" | "MONTH";
  bonusMiles: number;
  minOrderCents: number;
  progress: MissionProgress;
  /** O bônus deste período já foi pago. */
  awarded: boolean;
};

/** Missões ativas com o progresso do cliente no período atual (tela "Minhas milhas"). */
export async function getMissionViews(tenantId: string, customerId: string, now: Date = new Date()): Promise<MissionView[]> {
  const missions = await db
    .select()
    .from(milesMissions)
    .where(and(eq(milesMissions.tenantId, tenantId), eq(milesMissions.isActive, true)))
    .orderBy(asc(milesMissions.bonusMiles));
  if (missions.length === 0) return [];

  // Mês cobre a semana; busca desde o início do mês anterior para a semana que cruza a virada.
  const since = new Date(periodRange("MONTH", now).start.getTime() - 7 * 24 * 60 * 60 * 1000);
  const customerOrders = await loadCountableOrders(tenantId, customerId, since);
  const awards = await db.select().from(milesMissionAwards).where(eq(milesMissionAwards.customerId, customerId));

  return missions.map((m) => {
    const progress = missionProgress(
      { period: m.period, targetOrders: m.targetOrders, minOrderCents: m.minOrderCents },
      customerOrders,
      now,
    );
    return {
      id: m.id,
      name: m.name,
      period: m.period,
      bonusMiles: m.bonusMiles,
      minOrderCents: m.minOrderCents,
      progress,
      awarded: awards.some((a) => a.missionId === m.id && a.periodKey === progress.range.key),
    };
  });
}

/**
 * Paga o bônus das missões cumpridas no período atual (uma vez por missão e período, garantido por índice
 * único). Devolve o total de milhas de bônus creditadas agora.
 */
export async function evaluateMissions(tenantId: string, customerId: string, now: Date = new Date()): Promise<number> {
  const config = await loadMilesConfig(tenantId);
  if (!config.enabled) return 0;

  const views = await getMissionViews(tenantId, customerId, now);
  let total = 0;
  for (const view of views) {
    if (!view.progress.completed || view.awarded) continue;
    try {
      await db
        .insert(milesMissionAwards)
        .values({ missionId: view.id, customerId, periodKey: view.progress.range.key });
    } catch (error) {
      if (isUniqueViolation(error)) continue; // outro processo já pagou
      throw error;
    }
    await db.insert(milesLedger).values({
      tenantId,
      customerId,
      type: "BONUS",
      miles: view.bonusMiles,
      description: `Missão cumprida: ${view.name}`,
      expiresAt: expiryFrom(now, config.validityMonths),
    });
    total += view.bonusMiles;
  }
  return total;
}
