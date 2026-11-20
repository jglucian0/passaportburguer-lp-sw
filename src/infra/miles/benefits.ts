import { and, eq, gt, sql } from "drizzle-orm";

import { tierFor } from "@/core/miles/ledger";
import { db } from "@/infra/db";
import { coupons, milesLedger, milesSettings } from "@/infra/db/schema";

import { loadMilesConfig } from "./config";

const DAY_MS = 24 * 60 * 60 * 1000;
const BENEFIT_VALID_DAYS = 31;

/**
 * Benefícios mensais dos níveis: no começo de cada mês, quem está na Executiva ou na Primeira Classe ganha cupons pessoais
 * (desconto em pedidos acima do mínimo; na Primeira Classe, também frete grátis). Idempotente: o código do cupom inclui
 * mês e cliente, e o índice único (loja, código) impede repetir. Rodado pelo cron diário.
 */
export async function issueMonthlyTierBenefits(now: Date = new Date()): Promise<{ issued: number }> {
  const tenantRows = await db.select({ tenantId: milesSettings.tenantId }).from(milesSettings).where(eq(milesSettings.enabled, true));
  const month = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const validUntil = new Date(now.getTime() + BENEFIT_VALID_DAYS * DAY_MS);
  let issued = 0;

  for (const { tenantId } of tenantRows) {
    const config = await loadMilesConfig(tenantId);
    if (!config.enabled || config.executiveMinOrders <= 0) continue;
    if (config.tierBenefitCents <= 0 && !config.firstClassFreeShipping) continue;

    const since = new Date(now.getTime() - config.tierWindowDays * DAY_MS);
    const counts = await db
      .select({ customerId: milesLedger.customerId, orders: sql<number>`count(*)::int` })
      .from(milesLedger)
      .where(and(eq(milesLedger.tenantId, tenantId), eq(milesLedger.type, "EARN"), gt(milesLedger.createdAt, since)))
      .groupBy(milesLedger.customerId);

    for (const row of counts) {
      const tier = tierFor(row.orders, config);
      if (tier.name === "TURISTA") continue;
      const tag = row.customerId.replace(/-/g, "").slice(0, 8).toUpperCase();

      const specs: { code: string; value: number; minOrderCents: number; freeShipping: boolean }[] = [];
      if (config.tierBenefitCents > 0) {
        specs.push({ code: `BENEF-A-${month}-${tag}`, value: config.tierBenefitCents, minOrderCents: config.tierBenefitMinOrderCents, freeShipping: false });
      }
      if (tier.name === "PRIMEIRA_CLASSE" && config.firstClassFreeShipping) {
        specs.push({ code: `BENEF-F-${month}-${tag}`, value: 0, minOrderCents: 0, freeShipping: true });
      }
      for (const spec of specs) {
        const created = await db
          .insert(coupons)
          .values({
            tenantId,
            code: spec.code,
            type: "FIXED",
            value: spec.value,
            minOrderCents: spec.minOrderCents,
            maxUses: 1,
            isActive: true,
            expiresAt: validUntil,
            customerId: row.customerId,
            freeShipping: spec.freeShipping,
          })
          .onConflictDoNothing()
          .returning({ id: coupons.id })
          .catch(() => []);
        issued += created.length;
      }
    }
  }
  return { issued };
}
