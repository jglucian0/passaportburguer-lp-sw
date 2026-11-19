/**
 * Perfil e segmentação de clientes (regras puras, sem banco): base das campanhas de remarketing.
 * Só contam pedidos "válidos": pagos/aceitos (nem cancelados, nem aguardando pagamento).
 */

export type CustomerSegment = "NEVER_ORDERED" | "NEW" | "ACTIVE" | "AT_RISK" | "LOST";

export type SegmentRules = {
  /** Fã: pedidos válidos dentro da janela abaixo (padrão: 4 em 60 dias). */
  fanMinOrders: number;
  fanWindowDays: number;
  /** Em risco: dias sem pedir > max(atRiskMinDays, atRiskFactor × intervalo habitual do cliente). */
  atRiskFactor: number;
  atRiskMinDays: number;
  /** Intervalo assumido para quem só fez 1 pedido (ainda não há histórico para calcular). */
  defaultIntervalDays: number;
  /** Perdido: sem pedir há mais que isso (ou 4× o intervalo habitual, o que for maior). */
  lostDays: number;
};

export const DEFAULT_SEGMENT_RULES: SegmentRules = {
  fanMinOrders: 4,
  fanWindowDays: 60,
  atRiskFactor: 1.5,
  atRiskMinDays: 7,
  defaultIntervalDays: 14,
  lostDays: 60,
};

export type CustomerOrderStats = {
  /** Pedidos válidos (all time). */
  orderCount: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  /** Pedidos válidos dentro da janela de fã. */
  recentOrderCount: number;
};

export type FavoriteProduct = { productId: string | null; name: string; quantity: number };

export type CustomerProfile = CustomerOrderStats & {
  customerId: string;
  firstName: string;
  phone: string;
  favorite: FavoriteProduct | null;
  /** Dias entre pedidos, em média (null com menos de 2 pedidos). */
  avgIntervalDays: number | null;
  daysSinceLastOrder: number | null;
  segment: CustomerSegment;
  /** "Da família": pede com frequência. Vale em qualquer segmento (um fã sumido é prioridade de resgate). */
  isFan: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function averageIntervalDays(stats: CustomerOrderStats): number | null {
  if (stats.orderCount < 2 || !stats.firstOrderAt || !stats.lastOrderAt) return null;
  const span = (stats.lastOrderAt.getTime() - stats.firstOrderAt.getTime()) / DAY_MS;
  return span / (stats.orderCount - 1);
}

export function classifyCustomer(
  stats: CustomerOrderStats,
  now: Date = new Date(),
  rules: SegmentRules = DEFAULT_SEGMENT_RULES,
): { segment: CustomerSegment; isFan: boolean; avgIntervalDays: number | null; daysSinceLastOrder: number | null } {
  if (stats.orderCount === 0 || !stats.lastOrderAt) {
    return { segment: "NEVER_ORDERED", isFan: false, avgIntervalDays: null, daysSinceLastOrder: null };
  }
  const avgIntervalDays = averageIntervalDays(stats);
  const daysSinceLastOrder = (now.getTime() - stats.lastOrderAt.getTime()) / DAY_MS;
  const expected = avgIntervalDays ?? rules.defaultIntervalDays;
  const isFan = stats.recentOrderCount >= rules.fanMinOrders;

  let segment: CustomerSegment;
  if (daysSinceLastOrder >= Math.max(rules.lostDays, expected * 4)) segment = "LOST";
  else if (daysSinceLastOrder > Math.max(rules.atRiskMinDays, expected * rules.atRiskFactor)) segment = "AT_RISK";
  else segment = stats.orderCount === 1 ? "NEW" : "ACTIVE";

  return { segment, isFan, avgIntervalDays, daysSinceLastOrder };
}

/** Lanche mais pedido (soma das quantidades). Empate: o pedido mais recente. */
export function pickFavorite(
  rows: { productId: string | null; name: string; quantity: number; lastOrderedAt: Date }[],
): FavoriteProduct | null {
  let best: (typeof rows)[number] | null = null;
  for (const r of rows) {
    if (!best || r.quantity > best.quantity || (r.quantity === best.quantity && r.lastOrderedAt > best.lastOrderedAt)) best = r;
  }
  return best ? { productId: best.productId, name: best.name, quantity: best.quantity } : null;
}
