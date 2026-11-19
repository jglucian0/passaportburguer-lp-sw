import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";

import type { CartCoupon } from "@/core/cart/calculate-cart";
import { db } from "@/infra/db";
import { coupons, orders } from "@/infra/db/schema";

export type CouponLookup =
  | { ok: true; couponId: string; coupon: CartCoupon }
  | { ok: false; error: string };

export const normalizeCouponCode = (code: string): string => code.trim().toUpperCase().replace(/\s+/g, "");

/**
 * Valida o cupom para um cliente: existe, ativo, dentro da validade, com usos disponíveis e,
 * se for pessoal (campanha), do próprio cliente. O desconto em si é calculado por calculateCart.
 */
export async function lookupCoupon(tenantId: string, rawCode: string, customerId: string): Promise<CouponLookup> {
  const code = normalizeCouponCode(rawCode);
  if (!code) return { ok: false, error: "Informe o código do cupom." };

  const [row] = await db
    .select()
    .from(coupons)
    .where(and(eq(coupons.tenantId, tenantId), eq(coupons.code, code)))
    .limit(1);

  // Mesma mensagem para "não existe" e "é de outra pessoa": não revela cupons alheios.
  if (!row || (row.customerId && row.customerId !== customerId)) return { ok: false, error: "Cupom inválido." };
  if (!row.isActive) return { ok: false, error: "Este cupom não está mais disponível." };
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return { ok: false, error: "Este cupom expirou." };
  if (row.maxUses != null && row.usedCount >= row.maxUses) return { ok: false, error: "Este cupom já foi utilizado." };

  return {
    ok: true,
    couponId: row.id,
    coupon: { code: row.code, type: row.type, value: row.value, minOrderCents: row.minOrderCents },
  };
}

/**
 * Consome o cupom do pedido (pagamento confirmado): conta o uso e, ao atingir o limite, desativa o cupom.
 * Idempotente: `coupon_consumed_at` garante que webhook + resposta síncrona não consumam duas vezes.
 */
export async function consumeOrderCoupon(orderId: string): Promise<boolean> {
  const [claimed] = await db
    .update(orders)
    .set({ couponConsumedAt: new Date() })
    .where(and(eq(orders.id, orderId), isNull(orders.couponConsumedAt), sql`${orders.couponId} is not null`))
    .returning({ couponId: orders.couponId });
  if (!claimed?.couponId) return false;

  await db
    .update(coupons)
    .set({
      usedCount: sql`${coupons.usedCount} + 1`,
      isActive: sql`case when ${coupons.maxUses} is not null and ${coupons.usedCount} + 1 >= ${coupons.maxUses} then false else ${coupons.isActive} end`,
    })
    .where(eq(coupons.id, claimed.couponId));
  return true;
}

/**
 * Cupons pessoais (campanha ou milhas) ainda utilizáveis pelo cliente. Quem escolhe qual vale é o cálculo
 * do pedido (priceCart): sempre UM só, o de maior desconto, nunca somando.
 */
export async function findPersonalCoupons(tenantId: string, customerId: string): Promise<Extract<CouponLookup, { ok: true }>[]> {
  const now = new Date();
  const rows = await db
    .select()
    .from(coupons)
    .where(
      and(
        eq(coupons.tenantId, tenantId),
        eq(coupons.customerId, customerId),
        eq(coupons.isActive, true),
        or(isNull(coupons.expiresAt), gt(coupons.expiresAt, now)),
        or(isNull(coupons.maxUses), sql`${coupons.usedCount} < ${coupons.maxUses}`),
      ),
    )
    .orderBy(desc(coupons.createdAt));
  return rows.map((row) => ({
    ok: true as const,
    couponId: row.id,
    coupon: { code: row.code, type: row.type, value: row.value, minOrderCents: row.minOrderCents },
  }));
}
