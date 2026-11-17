import { eq } from "drizzle-orm";

import { db } from "./index";
import { resolveDeliveryRules } from "@/core/store/delivery-rules";

import { storeSettings, tenants, type DeliveryRules, type OpeningHours } from "./schema";

export type StoreSettingsRow = {
  address: string | null;
  deliveryRules: DeliveryRules;
  isOpenOverride: boolean | null;
  autoAcceptOrders: boolean;
  estimatedDeliveryMinutes: number;
  openingHours: OpeningHours;
};

/** Lê (sem cache) as configurações do tenant; cria o registro a partir de `tenants` se ainda não existir. */
export async function loadStoreSettings(tenantId: string): Promise<StoreSettingsRow | null> {
  const select = () =>
    db
      .select({
        isOpenOverride: storeSettings.isOpenOverride,
        autoAcceptOrders: storeSettings.autoAcceptOrders,
        estimatedDeliveryMinutes: storeSettings.estimatedDeliveryMinutes,
        openingHours: storeSettings.openingHours,
        address: storeSettings.address,
        deliveryRules: storeSettings.deliveryRules,
      })
      .from(storeSettings)
      .where(eq(storeSettings.tenantId, tenantId))
      .limit(1);

  const normalize = (row: Awaited<ReturnType<typeof select>>[number]): StoreSettingsRow => ({
    ...row,
    deliveryRules: resolveDeliveryRules(row.deliveryRules),
  });

  const [existing] = await select();
  if (existing) return normalize(existing);

  const [tenant] = await db
    .select({ openingHours: tenants.openingHours, isManuallyClosed: tenants.isManuallyClosed })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant) return null;

  await db
    .insert(storeSettings)
    .values({
      tenantId,
      isOpenOverride: tenant.isManuallyClosed ? false : null,
      openingHours: tenant.openingHours,
    })
    .onConflictDoNothing({ target: storeSettings.tenantId });

  const [created] = await select();
  return created ? normalize(created) : null;
}
