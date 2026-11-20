/**
 * Início de conversa e atalho "repetir pedido": textos fixos do backend (sem IA), curtos e com o carisma da casa.
 * Funções puras; o agent.ts cuida do envio.
 */

import type { GreetingMode } from "./greeting";
import { capitalize, isGreetingOnly, normalizeText } from "./guardrails";

export const REPEAT_BUTTON_ID = "REPEAT_LAST";
export const REPEAT_BUTTON_TITLE = "Repetir pedido";

/** Corpo do botão do Cardápio Rápido enviado pela IA (também usado para contar quantas vezes já foi mandado). */
export const MENU_BUTTON_BODY = "Aqui está o nosso cardápio digital 👇\nÉ rapidinho: escolhe, finaliza e pronto!";

/** Todos os corpos de botão do cardápio que o bot já envia (para saber se o link foi mandado há pouco). */
export const MENU_BUTTON_BODIES: readonly string[] = [
  MENU_BUTTON_BODY,
  "Escolha o destino de hoje 👇",
  "Escolha seu pedido pelo cardápio 👇",
];

/** O link do Cardápio Rápido vale 30 min: dentro desta janela o bot lembra do link em vez de reenviar o botão. */
export const MENU_BUTTON_FRESH_MS = 20 * 60 * 1000;

/** Lembretes (texto, sem botão) quando o cliente insiste em pedir pelo chat e o link já foi enviado. */
export const MENU_REMINDER_REPLIES: readonly string[] = [
  "Por aqui não consigo anotar pedidos 😃 Você faz o pedido pelo link do cardápio que já te enviei: é só escolher os itens, adicionar à sacola e finalizar por lá.",
  "O pedido é feito pelo cardápio digital que mandei acima. É só escolher os itens, adicionar à sacola e finalizar por lá 😃",
  "Pra eu conseguir mandar pra chapa, o pedido precisa ser feito pelo link do cardápio que enviei. Escolhe os itens, coloca na sacola e finaliza por lá!",
  "Aqui no chat eu não anoto pedido, mas é rapidinho: abre o link do cardápio que te mandei, monta a sacola e finaliza. Qualquer dúvida é só falar 😊",
];

/** Escolhe um lembrete que não tenha saído nas últimas mensagens do bot. */
export function pickMenuReminder(sentRecently: string[]): string {
  const fresh = MENU_REMINDER_REPLIES.filter((r) => !sentRecently.includes(r));
  const pool = fresh.length > 0 ? fresh : MENU_REMINDER_REPLIES;
  return pool[Math.floor(Math.random() * pool.length)];
}

export type StartFlow = {
  /** Mensagens de texto que saem ANTES do botão. */
  preface: string[];
  /** Corpo do botão "Cardápio Rápido". */
  ctaBody: string;
  /** Cliente cadastrado com pedido anterior: atalho para repetir. */
  repeatSummary: string | null;
};

export type StartCustomer = { isRegistered: false } | { isRegistered: true; firstName: string; lastOrderSummary: string | null };

/** Resumo curto do último pedido para o atalho (cabe no corpo do botão). */
function shortSummary(summary: string): string {
  const chars = Array.from(summary);
  return chars.length <= 120 ? summary : `${chars.slice(0, 119).join("").trimEnd()}…`;
}

/**
 * Início do atendimento (primeiro contato do dia ou nova conversa): SEMPRE o mesmo roteiro.
 * - novo: boas-vindas + como funciona + botão;
 * - cadastrado: chama pelo nome + botão + atalho do último pedido.
 */
export function buildStartFlow(greeting: string, mode: GreetingMode, customer: StartCustomer): StartFlow {
  if (!customer.isRegistered) {
    return {
      preface: [
        `${capitalize(greeting)}! Bem-vindo a bordo do Passaporte Burguer! ✈️`,
        "Aqui é simples: escolhe no cardápio digital, informa a entrega e paga pelo link. Eu aviso por aqui quando cair.",
      ],
      ctaBody: "Escolha o destino de hoje 👇",
      repeatSummary: null,
    };
  }
  const hello =
    mode === "FIRST_TODAY"
      ? `${capitalize(greeting)}, ${customer.firstName}! Bem-vindo de volta a bordo ✈️`
      : `Oi de novo, ${customer.firstName}! ✈️`;
  return {
    preface: [hello],
    ctaBody: "Escolha seu pedido pelo cardápio 👇",
    repeatSummary: customer.lastOrderSummary ? shortSummary(customer.lastOrderSummary) : null,
  };
}

export function repeatButtonBody(summary: string): string {
  return `Ou, se quiser o de sempre: ${summary}`;
}

/** Clique no atalho (a Meta devolve o título do botão como texto). */
export function isRepeatRequest(texts: string[]): boolean {
  return texts.length === 1 && normalizeText(texts[0]) === normalizeText(REPEAT_BUTTON_TITLE);
}

/**
 * O início roteirizado vale para saudação pura e para quem já chegou pedindo ("quero um México").
 * Pergunta ("vocês abrem hoje?") vai para a IA, que responde direto.
 */
export function shouldUseStartFlow(texts: string[]): boolean {
  return texts.every(isGreetingOnly) || texts.every((t) => !t.includes("?"));
}
