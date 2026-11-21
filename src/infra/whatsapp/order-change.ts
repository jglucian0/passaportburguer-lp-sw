import { normalizeText } from "./guardrails";

/**
 * Cliente com pedido JÁ PAGO / na cozinha pedindo para alterar, adicionar ou tirar algo. O bot não altera pedido
 * fechado (o pedido já foi para a cozinha e para o PDV): quem resolve é um atendente. Detecção determinística,
 * sem depender da IA, para nunca responder com o cardápio de novo.
 */

/* Os textos chegam normalizados (sem acento, letras repetidas colapsadas: "errei" -> "erei", "acrescentar" -> "acrecentar"). */

/** Pedido que já saiu do "aguardando pagamento" e ainda não foi entregue (o aguardando pagamento a IA cancela sozinha). */
const IN_KITCHEN = new Set(["RECEIVED", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY"]);

const CHANGE_PATTERNS: RegExp[] = [
  /\b(erei|me enganei|pedi erado|pedido erado|ero no (meu )?pedido|esqueci de|troquei sem querer)\b/,
  /\b(alterar|mudar|trocar|corrigir|editar|modificar)\b.*\b(pedido|lanche|burger|hamburguer|item|bebida|adicional|endereco|pagamento|forma de pagamento)\b/,
  /\b(adicionar|(acrescentar|acrecentar)|incluir|colocar|botar|juntar)\b.*\b(mais|outro|outra|um|uma|alguma|algo|no pedido|ao pedido)\b/,
  /\b(tirar|remover|retirar)\b.*\b(do pedido|do lanche|do burger|do hamburguer|da batata|o pedido)\b/,
  /\b(quero|queria|poso|posso|da pra|tem como|consigo|preciso|gostaria de)\b.*\b(alterar|mudar|trocar|corrigir|tirar|remover|retirar|adicionar|(acrescentar|acrecentar)|incluir|cancelar)\b/,
  /\bmais (um|uma|alguma coisa|algo)\b.*\b(no|ao) (meu )?pedido\b/,
];

export type OrderChangeMatch = { number: number; status: string };

export function orderChangeFor(
  texts: string[],
  activeOrder: { number: number; status: string } | null | undefined,
): OrderChangeMatch | null {
  if (!activeOrder || !IN_KITCHEN.has(activeOrder.status)) return null;
  const joined = normalizeText(texts.join(" "));
  if (!joined) return null;
  return CHANGE_PATTERNS.some((re) => re.test(joined)) ? { number: activeOrder.number, status: activeOrder.status } : null;
}

export function orderChangeReply(match: OrderChangeMatch): string {
  return match.status === "OUT_FOR_DELIVERY"
    ? `Entendi! Seu pedido #${match.number} já saiu para a entrega, então não consigo alterar por aqui. Já chamei um atendente para ver o que dá pra fazer com você, só um instante 😊`
    : `Entendi! Como o seu pedido #${match.number} já foi para a cozinha, não consigo alterar por aqui. Já chamei um atendente para ajustar com você, só um instante 😊`;
}

/** Minutos que o bot fica calado depois de passar o cliente para o atendente (tempo de o atendente entrar na conversa). */
export const ORDER_CHANGE_HANDOFF_MINUTES = 90;
