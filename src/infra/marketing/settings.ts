import { eq } from "drizzle-orm";

import { DEFAULT_MARKETING_CONFIG, type MarketingConfig } from "@/core/marketing/campaign";
import { db } from "@/infra/db";
import { marketingSettings } from "@/infra/db/schema";

/** Configuração das campanhas da loja. Sem linha cadastrada = padrões, com campanhas DESLIGADAS. */
export async function loadMarketingConfig(tenantId: string): Promise<MarketingConfig> {
  const [row] = await db.select().from(marketingSettings).where(eq(marketingSettings.tenantId, tenantId)).limit(1);
  if (!row) return DEFAULT_MARKETING_CONFIG;
  return {
    enabled: row.enabled,
    discountMinPercent: row.discountMinPercent,
    discountMaxPercent: row.discountMaxPercent,
    fanBonusPercent: row.fanBonusPercent,
    couponValidHours: row.couponValidHours,
    couponMinOrderCents: row.couponMinOrderCents,
    minDaysBetween: row.minDaysBetween,
    sendFromHour: row.sendFromHour,
    sendUntilHour: row.sendUntilHour,
    targetAtRisk: row.targetAtRisk,
    targetLost: row.targetLost,
    targetNew: row.targetNew,
  };
}
