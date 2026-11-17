/** Pedido mínimo para ENTREGA, sobre o subtotal dos produtos (sem taxa). Retirada não tem mínimo. */
export const MIN_DELIVERY_ORDER_CENTS = 3300;

/** O painel pode apenas elevar o mínimo acima de R$ 33,00. */
export function effectiveMinOrderCents(tenantMinCents: number): number {
  return Math.max(MIN_DELIVERY_ORDER_CENTS, tenantMinCents);
}

export function minOrderMessage(minCents: number, missingCents: number): string {
  const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return `Pedido mínimo de ${brl(minCents)} para entrega (faltam ${brl(missingCents)})`;
}
