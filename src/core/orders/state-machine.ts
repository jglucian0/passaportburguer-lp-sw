import type { DeliveryType, OrderStatus } from "../schemas/common";

export const TERMINAL_STATUSES: readonly OrderStatus[] = ["DELIVERED", "CANCELED"];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: "Aguardando pagamento",
  RECEIVED: "Recebido",
  PREPARING: "Em preparo",
  OUT_FOR_DELIVERY: "Saiu para entrega",
  READY_FOR_PICKUP: "Pronto para retirada",
  DELIVERED: "Entregue",
  CANCELED: "Cancelado",
};

/** Etapas do fluxo feliz (usadas pela barra de progresso do cliente). */
export function getProgressSteps(deliveryType: DeliveryType): OrderStatus[] {
  return deliveryType === "DELIVERY"
    ? ["RECEIVED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"]
    : ["RECEIVED", "PREPARING", "READY_FOR_PICKUP", "DELIVERED"];
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Próximo status do fluxo feliz, ou null se o pedido já terminou. */
export function getNextStatus(status: OrderStatus, deliveryType: DeliveryType): OrderStatus | null {
  switch (status) {
    case "AWAITING_PAYMENT":
      return "RECEIVED";
    case "RECEIVED":
      return "PREPARING";
    case "PREPARING":
      return deliveryType === "DELIVERY" ? "OUT_FOR_DELIVERY" : "READY_FOR_PICKUP";
    case "OUT_FOR_DELIVERY":
    case "READY_FOR_PICKUP":
      return "DELIVERED";
    default:
      return null;
  }
}

export function getAllowedTransitions(status: OrderStatus, deliveryType: DeliveryType): OrderStatus[] {
  if (isTerminalStatus(status)) return [];
  const next = getNextStatus(status, deliveryType);
  return next ? [next, "CANCELED"] : [];
}

export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  deliveryType: DeliveryType,
): boolean {
  return getAllowedTransitions(from, deliveryType).includes(to);
}

export function canCancel(status: OrderStatus, deliveryType: DeliveryType): boolean {
  return canTransition(status, "CANCELED", deliveryType);
}
