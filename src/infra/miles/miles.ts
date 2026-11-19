import { and, asc, desc, eq, gt, isNull, like, or } from "drizzle-orm";

import {
  computeBalance,
  DEFAULT_MILES_CONFIG,
  expiryFrom,
  milesCouponCode,
  milesForOrder,
  type MilesBalance,
  type MilesConfig,
} from "@/core/miles/ledger";
import { db } from "@/infra/db";
import { loadMilesConfig } from "./config";
import { evaluateMissions } from "./missions";
import { coupons, milesLedger, milesRewards, orders } from "@/infra/db/schema";

export { loadMilesConfig };

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

async function ledgerRows(tenantId: string, customerId: string) {
  return db
    .select({ miles: milesLedger.miles, createdAt: milesLedger.createdAt, expiresAt: milesLedger.expiresAt })
    .from(milesLedger)
    .where(and(eq(milesLedger.tenantId, tenantId), eq(milesLedger.customerId, customerId)));
}

export async function getMilesBalance(tenantId: string, customerId: string, now: Date = new Date()): Promise<MilesBalance> {
  return computeBalance(await ledgerRows(tenantId, customerId), now);
}

/**
 * Credita as milhas de um pedido pago/entregue. Idempotente (índice único por pedido): webhook, resposta
 * síncrona e entrega podem chamar quantas vezes quiserem. Programa desligado = nada é creditado.
 */
export async function creditOrderMiles(orderId: string, now: Date = new Date()): Promise<number> {
  const [order] = await db
    .select({
      tenantId: orders.tenantId,
      customerId: orders.customerId,
      orderNumber: orders.orderNumber,
      status: orders.status,
      subtotalCents: orders.subtotalCents,
      discountCents: orders.discountCents,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order || order.status === "CANCELED" || order.status === "AWAITING_PAYMENT") return 0;

  const config = await loadMilesConfig(order.tenantId);
  if (!config.enabled) return 0;
  const miles = milesForOrder(order.subtotalCents - order.discountCents, config.milesPerReal);
  if (miles <= 0) return 0;

  try {
    await db.insert(milesLedger).values({
      tenantId: order.tenantId,
      customerId: order.customerId,
      type: "EARN",
      miles,
      orderId,
      description: `Pedido #${order.orderNumber}`,
      expiresAt: expiryFrom(now, config.validityMonths),
    });
    // Pedido válido pode fechar uma missão do período (bônus pago uma vez por período).
    const bonus = await evaluateMissions(order.tenantId, order.customerId, now).catch(() => 0);
    return miles + bonus;
  } catch (error) {
    if (isUniqueViolation(error)) return 0; // já creditado
    throw error;
  }
}

/** Pedido cancelado/estornado: debita as milhas que ele tinha rendido. Idempotente. */
export async function reverseOrderMiles(orderId: string): Promise<number> {
  const [earn] = await db
    .select()
    .from(milesLedger)
    .where(and(eq(milesLedger.orderId, orderId), eq(milesLedger.type, "EARN")))
    .limit(1);
  if (!earn) return 0;
  try {
    await db.insert(milesLedger).values({
      tenantId: earn.tenantId,
      customerId: earn.customerId,
      type: "REVERSAL",
      miles: -earn.miles,
      orderId,
      description: `${earn.description} cancelado`,
    });
    return earn.miles;
  } catch (error) {
    if (isUniqueViolation(error)) return 0;
    throw error;
  }
}

export type RedeemResult =
  | { ok: true; couponCode: string; discountCents: number; validUntil: Date }
  | { ok: false; error: string };

/** Troca milhas por um cupom de desconto pessoal (uso único, validade curta). */
export async function redeemReward(
  tenantId: string,
  customerId: string,
  rewardId: string,
  now: Date = new Date(),
): Promise<RedeemResult> {
  const config = await loadMilesConfig(tenantId);
  if (!config.enabled) return { ok: false, error: "O programa de milhas não está ativo." };

  const [reward] = await db
    .select()
    .from(milesRewards)
    .where(and(eq(milesRewards.id, rewardId), eq(milesRewards.tenantId, tenantId), eq(milesRewards.isActive, true)))
    .limit(1);
  if (!reward) return { ok: false, error: "Recompensa indisponível." };

  const balance = await getMilesBalance(tenantId, customerId, now);
  if (balance.available < reward.milesCost) {
    return { ok: false, error: `Você precisa de ${reward.milesCost} milhas (saldo: ${balance.available}).` };
  }

  const validUntil = new Date(now.getTime() + config.rewardCouponValidDays * 24 * 60 * 60 * 1000);
  let couponId: string | null = null;
  let code = "";
  for (let attempt = 0; attempt < 5 && !couponId; attempt++) {
    code = milesCouponCode();
    try {
      const [row] = await db
        .insert(coupons)
        .values({
          tenantId,
          code,
          type: "FIXED",
          value: reward.discountCents,
          minOrderCents: reward.minOrderCents,
          maxUses: 1,
          isActive: true,
          expiresAt: validUntil,
          customerId,
        })
        .returning({ id: coupons.id });
      couponId = row.id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  if (!couponId) return { ok: false, error: "Não foi possível gerar o cupom. Tente novamente." };

  const [entry] = await db
    .insert(milesLedger)
    .values({
      tenantId,
      customerId,
      type: "REDEEM",
      miles: -reward.milesCost,
      rewardId: reward.id,
      couponId,
      description: `Resgate: ${reward.name}`,
    })
    .returning({ id: milesLedger.id });

  // Dois resgates ao mesmo tempo (duplo clique): se o saldo disponível não cobre os dois, desfaz este.
  const rows = await ledgerRows(tenantId, customerId);
  const rawTotal = rows.reduce((sum, r) => sum + r.miles, 0);
  const afterBalance = computeBalance(rows, now);
  if (rawTotal < 0 || afterBalance.available < 0) {
    await db.delete(milesLedger).where(eq(milesLedger.id, entry.id));
    await db.delete(coupons).where(eq(coupons.id, couponId));
    return { ok: false, error: "Saldo insuficiente." };
  }

  return { ok: true, couponCode: code, discountCents: reward.discountCents, validUntil };
}

export type MilesAccount = {
  config: MilesConfig;
  balance: MilesBalance;
  rewards: { id: string; name: string; milesCost: number; discountCents: number; minOrderCents: number }[];
  history: { id: string; type: string; miles: number; description: string; createdAt: Date }[];
  activeCoupons: { code: string; discountCents: number; validUntil: Date | null; minOrderCents: number }[];
};

/** Tudo da tela "Minhas milhas" de um cliente. */
export async function getMilesAccount(tenantId: string, customerId: string, now: Date = new Date()): Promise<MilesAccount> {
  const [config, balance, rewards, history, activeCoupons] = await Promise.all([
    loadMilesConfig(tenantId),
    getMilesBalance(tenantId, customerId, now),
    db
      .select({
        id: milesRewards.id,
        name: milesRewards.name,
        milesCost: milesRewards.milesCost,
        discountCents: milesRewards.discountCents,
        minOrderCents: milesRewards.minOrderCents,
      })
      .from(milesRewards)
      .where(and(eq(milesRewards.tenantId, tenantId), eq(milesRewards.isActive, true)))
      .orderBy(asc(milesRewards.milesCost)),
    db
      .select({
        id: milesLedger.id,
        type: milesLedger.type,
        miles: milesLedger.miles,
        description: milesLedger.description,
        createdAt: milesLedger.createdAt,
      })
      .from(milesLedger)
      .where(and(eq(milesLedger.tenantId, tenantId), eq(milesLedger.customerId, customerId)))
      .orderBy(desc(milesLedger.createdAt))
      .limit(40),
    db
      .select({ code: coupons.code, value: coupons.value, expiresAt: coupons.expiresAt, minOrderCents: coupons.minOrderCents })
      .from(coupons)
      .where(
        and(
          eq(coupons.tenantId, tenantId),
          eq(coupons.customerId, customerId),
          eq(coupons.isActive, true),
          like(coupons.code, "MILHAS-%"),
          or(isNull(coupons.expiresAt), gt(coupons.expiresAt, now)),
        ),
      ),
  ]);
  return {
    config,
    balance,
    rewards,
    history,
    activeCoupons: activeCoupons.map((c) => ({
      code: c.code,
      discountCents: c.value,
      validUntil: c.expiresAt,
      minOrderCents: c.minOrderCents,
    })),
  };
}

/** Linha para o WhatsApp depois do pagamento: milhas que o pedido rendeu e o saldo. Vazia sem programa/crédito. */
export async function milesEarnedLine(orderId: string): Promise<string> {
  try {
    const [earn] = await db
      .select({ tenantId: milesLedger.tenantId, customerId: milesLedger.customerId, miles: milesLedger.miles })
      .from(milesLedger)
      .where(and(eq(milesLedger.orderId, orderId), eq(milesLedger.type, "EARN")))
      .limit(1);
    if (!earn) return "";
    const balance = await getMilesBalance(earn.tenantId, earn.customerId);
    return `\n\nVocê ganhou ${earn.miles.toLocaleString("pt-BR")} milhas ✈️ Seu saldo: ${balance.available.toLocaleString("pt-BR")} milhas.`;
  } catch {
    return "";
  }
}
