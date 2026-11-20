import { eq } from "drizzle-orm";

import { DEFAULT_MILES_CONFIG, type MilesConfig } from "@/core/miles/ledger";
import { db } from "@/infra/db";
import { milesSettings } from "@/infra/db/schema";

/** Configuração do programa. Sem linha cadastrada = padrões, com o programa DESLIGADO. */
export async function loadMilesConfig(tenantId: string): Promise<MilesConfig> {
  const [row] = await db.select().from(milesSettings).where(eq(milesSettings.tenantId, tenantId)).limit(1);
  if (!row) return DEFAULT_MILES_CONFIG;
  return {
    enabled: row.enabled,
    milesPerReal: row.milesPerReal,
    validityMonths: row.validityMonths,
    rewardCouponValidDays: row.rewardCouponValidDays,
    welcomeBonusMiles: row.welcomeBonusMiles,
    cashbackMilesPerReal: row.cashbackMilesPerReal,
    cashbackMinMiles: row.cashbackMinMiles,
    cashbackCapPercent: row.cashbackCapPercent,
    redeemMinOrderCents: row.redeemMinOrderCents,
    rollingValidityDays: row.rollingValidityDays,
    tierWindowDays: row.tierWindowDays,
    executiveMinOrders: row.executiveMinOrders,
    executiveMultiplierPct: row.executiveMultiplierPct,
    firstClassMinOrders: row.firstClassMinOrders,
    firstClassMultiplierPct: row.firstClassMultiplierPct,
    tierBenefitCents: row.tierBenefitCents,
    tierBenefitMinOrderCents: row.tierBenefitMinOrderCents,
    firstClassFreeShipping: row.firstClassFreeShipping,
  };
}
