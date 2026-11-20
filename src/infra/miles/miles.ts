import { and, asc, desc, eq, gt, isNull, like, or } from "drizzle-orm";

import {
  CASHBACK_STEP_MILES,
  cashbackDiscountCents,
  computeBalance,
  DEFAULT_MILES_CONFIG,
  expiryFrom,
  milesCouponCode,
  milesForOrder,
  tierFor,
  type MilesTier,
  type MilesBalance,
  type MilesConfig,
} from "@/core/miles/ledger";
import { db } from "@/infra/db";
import { loadMilesConfig } from "./config";
import { evaluateMissions } from "./missions";
import { coupons, milesLedger, milesRewards, orders, products } from "@/infra/db/schema";

export { loadMilesConfig };

/** Descrição fixa do bônus: o índice único do banco garante um por cliente. */
export const WELCOME_BONUS_DESCRIPTION = "Bônus de boas-vindas";

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

async function ledgerRows(tenantId: string, customerId: string) {
  return db
    .select({
      miles: milesLedger.miles,
      createdAt: milesLedger.createdAt,
      expiresAt: milesLedger.expiresAt,
      type: milesLedger.type,
    })
    .from(milesLedger)
    .where(and(eq(milesLedger.tenantId, tenantId), eq(milesLedger.customerId, customerId)))
    .then((rows) =>
      rows.map((r) => ({ miles: r.miles, createdAt: r.createdAt, expiresAt: r.expiresAt, renews: r.type === "EARN" })),
    );
}

export async function getMilesBalance(tenantId: string, customerId: string, now: Date = new Date()): Promise<MilesBalance> {
  const [rows, config] = await Promise.all([ledgerRows(tenantId, customerId), loadMilesConfig(tenantId)]);
  return computeBalance(rows, now, 30, config.rollingValidityDays);
}

/** Pedidos pagos (créditos de pedido) do cliente na janela dos níveis. */
async function countTierOrders(tenantId: string, customerId: string, config: MilesConfig, now: Date): Promise<number> {
  if (config.executiveMinOrders <= 0) return 0;
  const since = new Date(now.getTime() - config.tierWindowDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: milesLedger.id })
    .from(milesLedger)
    .where(
      and(
        eq(milesLedger.tenantId, tenantId),
        eq(milesLedger.customerId, customerId),
        eq(milesLedger.type, "EARN"),
        gt(milesLedger.createdAt, since),
      ),
    );
  return rows.length;
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
  const tier = tierFor(await countTierOrders(order.tenantId, order.customerId, config, now), config);
  const miles = milesForOrder(order.subtotalCents - order.discountCents, config.milesPerReal, tier.multiplierPct);
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
    // Primeiro pedido pago do cliente: bônus de boas-vindas (uma vez só, garantido pelo índice único).
    let welcome = 0;
    if (config.welcomeBonusMiles > 0) {
      const granted = await db
        .insert(milesLedger)
        .values({
          tenantId: order.tenantId,
          customerId: order.customerId,
          type: "BONUS",
          miles: config.welcomeBonusMiles,
          description: WELCOME_BONUS_DESCRIPTION,
          expiresAt: expiryFrom(now, config.validityMonths),
        })
        .onConflictDoNothing()
        .returning({ id: milesLedger.id })
        .catch(() => []);
      if (granted.length > 0) welcome = config.welcomeBonusMiles;
    }
    // Pedido válido pode fechar uma missão do período (bônus pago uma vez por período).
    const bonus = await evaluateMissions(order.tenantId, order.customerId, now).catch(() => 0);
    return miles + welcome + bonus;
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

type RedeemSpec = {
  milesCost: number;
  discountCents: number;
  minOrderCents: number;
  /** Teto do desconto em % dos itens (cashback). */
  maxDiscountPercent: number | null;
  /** Item grátis (recompensa de produto). */
  freeProductId?: string | null;
  rewardId: string | null;
  label: string;
};

/** Troca milhas por um cupom de desconto pessoal de uma recompensa cadastrada (uso único, validade curta). */
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

  // Item grátis: o valor do cupom é o preço atual do produto (só para exibir; o desconto real vem do pedido).
  let discountCents = reward.discountCents;
  if (reward.freeProductId) {
    const [product] = await db
      .select({ priceCents: products.priceCents, isAvailable: products.isAvailable })
      .from(products)
      .where(and(eq(products.id, reward.freeProductId), eq(products.tenantId, tenantId)))
      .limit(1);
    if (!product || !product.isAvailable) return { ok: false, error: "Este prêmio está indisponível no momento." };
    discountCents = product.priceCents;
  }

  return issueMilesCoupon(tenantId, customerId, config, now, {
    milesCost: reward.milesCost,
    discountCents,
    freeProductId: reward.freeProductId,
    // Nunca abaixo do pedido mínimo geral de resgate (trava de margem).
    minOrderCents: Math.max(reward.minOrderCents, config.redeemMinOrderCents),
    maxDiscountPercent: null,
    rewardId: reward.id,
    label: `Resgate: ${reward.name}`,
  });
}

/**
 * Cashback livre: o cliente escolhe quantas milhas converter em desconto (mínimo e múltiplos configuráveis).
 * O cupom tem pedido mínimo e teto em % dos itens para proteger a margem.
 */
export async function redeemCashback(
  tenantId: string,
  customerId: string,
  miles: number,
  now: Date = new Date(),
): Promise<RedeemResult> {
  const config = await loadMilesConfig(tenantId);
  if (!config.enabled) return { ok: false, error: "O programa de milhas não está ativo." };
  if (!Number.isInteger(miles) || miles <= 0) return { ok: false, error: "Quantidade de milhas inválida." };
  if (miles < config.cashbackMinMiles) {
    return { ok: false, error: `O resgate em desconto começa em ${config.cashbackMinMiles} milhas.` };
  }
  if (miles % CASHBACK_STEP_MILES !== 0) {
    return { ok: false, error: `Escolha um múltiplo de ${CASHBACK_STEP_MILES} milhas.` };
  }
  const discountCents = cashbackDiscountCents(miles, config.cashbackMilesPerReal);
  if (discountCents <= 0) return { ok: false, error: "Quantidade de milhas inválida." };

  return issueMilesCoupon(tenantId, customerId, config, now, {
    milesCost: miles,
    discountCents,
    minOrderCents: config.redeemMinOrderCents,
    maxDiscountPercent: config.cashbackCapPercent > 0 ? config.cashbackCapPercent : null,
    rewardId: null,
    label: `Cashback: ${(discountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
  });
}

async function issueMilesCoupon(
  tenantId: string,
  customerId: string,
  config: MilesConfig,
  now: Date,
  spec: RedeemSpec,
): Promise<RedeemResult> {
  const balance = await getMilesBalance(tenantId, customerId, now);
  if (balance.available < spec.milesCost) {
    return { ok: false, error: `Você precisa de ${spec.milesCost} milhas (saldo: ${balance.available}).` };
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
          value: spec.discountCents,
          minOrderCents: spec.minOrderCents,
          maxDiscountPercent: spec.maxDiscountPercent,
          freeProductId: spec.freeProductId ?? null,
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
      miles: -spec.milesCost,
      rewardId: spec.rewardId,
      couponId,
      description: spec.label,
    })
    .returning({ id: milesLedger.id });

  // Dois resgates ao mesmo tempo (duplo clique): se o saldo disponível não cobre os dois, desfaz este.
  const rows = await ledgerRows(tenantId, customerId);
  const rawTotal = rows.reduce((sum, r) => sum + r.miles, 0);
  const afterBalance = computeBalance(rows, now, 30, config.rollingValidityDays);
  if (rawTotal < 0 || afterBalance.available < 0) {
    await db.delete(milesLedger).where(eq(milesLedger.id, entry.id));
    await db.delete(coupons).where(eq(coupons.id, couponId));
    return { ok: false, error: "Saldo insuficiente." };
  }

  return { ok: true, couponCode: code, discountCents: spec.discountCents, validUntil };
}

export type MilesAccount = {
  config: MilesConfig;
  tier: MilesTier;
  tierOrders: number;
  balance: MilesBalance;
  rewards: {
    id: string;
    name: string;
    milesCost: number;
    discountCents: number;
    minOrderCents: number;
    /** Nome do produto quando a recompensa é um item grátis. */
    freeProductName: string | null;
  }[];
  history: { id: string; type: string; miles: number; description: string; createdAt: Date }[];
  activeCoupons: {
    code: string;
    discountCents: number;
    validUntil: Date | null;
    minOrderCents: number;
    maxDiscountPercent: number | null;
    freeProductName: string | null;
    freeShipping: boolean;
  }[];
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
        freeProductName: products.name,
      })
      .from(milesRewards)
      .leftJoin(products, eq(products.id, milesRewards.freeProductId))
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
      .select({
        code: coupons.code,
        value: coupons.value,
        expiresAt: coupons.expiresAt,
        minOrderCents: coupons.minOrderCents,
        maxDiscountPercent: coupons.maxDiscountPercent,
        freeProductName: products.name,
        freeShipping: coupons.freeShipping,
      })
      .from(coupons)
      .leftJoin(products, eq(products.id, coupons.freeProductId))
      .where(
        and(
          eq(coupons.tenantId, tenantId),
          eq(coupons.customerId, customerId),
          eq(coupons.isActive, true),
          or(like(coupons.code, "MILHAS-%"), like(coupons.code, "BENEF-%")),
          or(isNull(coupons.expiresAt), gt(coupons.expiresAt, now)),
        ),
      ),
  ]);
  const tierOrders = await countTierOrders(tenantId, customerId, config, now);
  return {
    config,
    tier: tierFor(tierOrders, config),
    tierOrders,
    balance,
    rewards,
    history,
    activeCoupons: activeCoupons.map((c) => ({
      code: c.code,
      discountCents: c.value,
      validUntil: c.expiresAt,
      minOrderCents: c.minOrderCents,
      maxDiscountPercent: c.maxDiscountPercent,
      freeProductName: c.freeProductName,
      freeShipping: c.freeShipping,
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
