/** Regras puras da sessão do WhatsApp (sem banco): estado do pedido, histórico isolado e saudação. */

/** Quantas mensagens da sessão atual vão ao Gemini. */
export const HISTORY_LIMIT = 12;
/** Dentro desta janela desde a última mensagem, o bot NÃO cumprimenta de novo. */
export const GREETING_WINDOW_MS = 90 * 60_000;

export type SessionProgress = {
  draftCart: unknown[] | null | undefined;
  addressConfirmed: boolean;
  paymentMethod: string | null | undefined;
};

export type NextStep = "CART" | "DELIVERY" | "PAYMENT" | "CHECKOUT";

export function nextStep(s: SessionProgress): NextStep {
  if (!s.draftCart || s.draftCart.length === 0) return "CART";
  if (!s.addressConfirmed) return "DELIVERY";
  if (!s.paymentMethod) return "PAYMENT";
  return "CHECKOUT";
}

/** Carrinho + entrega/retirada resolvida + pagamento: o backend fecha o pedido sozinho. */
export const isCheckoutReady = (s: SessionProgress): boolean => nextStep(s) === "CHECKOUT";

type HistoryRow = { createdAt: Date | string | number };

/**
 * Isola o contexto do Gemini ao pedido atual: só mensagens a partir de `sessionStartedAt`,
 * as últimas `limit`, em ordem cronológica (pedidos antigos nunca contaminam o novo).
 */
export function selectSessionMessages<T extends HistoryRow>(
  rows: T[],
  sessionStartedAt: Date | null | undefined,
  limit: number = HISTORY_LIMIT,
): T[] {
  const from = sessionStartedAt ? sessionStartedAt.getTime() : -Infinity;
  return rows
    .filter((r) => new Date(r.createdAt).getTime() >= from)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-limit);
}

/** Cumprimenta só se não houve mensagem anterior nos últimos 90 minutos. */
export function shouldGreet(lastMessageAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!lastMessageAt) return true;
  return now.getTime() - new Date(lastMessageAt).getTime() > GREETING_WINDOW_MS;
}

const CLOSING_WORDS = new Set([
  "ja", "chegou", "chegaram", "valeu", "vlw", "obrigado", "obrigada", "brigado", "brigada", "muito", "show", "top", "perfeito", "demais", "tmj",
]);

/** "Já chegou", "Valeu", "Obrigado"…: o cliente encerrou o papo (mensagem curta só com palavras de despedida). */
export function isClosingMessage(text: string): boolean {
  const words = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  return words.length > 0 && words.length <= 5 && words.every((w) => CLOSING_WORDS.has(w));
}
