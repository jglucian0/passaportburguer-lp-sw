/**
 * Sanitização da resposta da IA (funções puras).
 * A IA NUNCA escreve links: o WhatsApp não renderiza Markdown e ela inventa caminhos inexistentes.
 * Links só saem pelo botão cta_url montado no servidor ou pela mensagem determinística de checkout.
 */

const MARKDOWN_LINK = /\[([^\]]*)\]\(\s*[^)]*\)/g;
const RAW_URL = /(?:https?:\/\/|www\.)[^\s<>()]+/gi;
const HALLUCINATED_APP = /\bapp\.menu-rapido[^\s<>()]*/gi;
const BARE_DOMAIN = /\b(?:[a-z0-9-]+\.)+(?:com|br|app|io|net|org|me|link|dev|xyz)\b(?:\/[^\s<>()]*)?/gi;
const URL_LIKE = /^\s*(?:https?:\/\/|www\.)\S+\s*$|^\s*(?:[a-z0-9-]+\.)+(?:com|br|app|io|net|org|me|link|dev|xyz)\b\S*\s*$/i;

/** Remove a pontuação final que o `\S+` da URL engoliu, devolvendo-a ao texto. */
const keepTrailingPunctuation = (match: string) => match.match(/[.,;!?]+$/)?.[0] ?? "";

function cleanLine(line: string): string {
  const cleaned = line
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;!?])/g, "$1")
    .trim()
    .replace(/\s*[:\-–—]+$/, "")
    .trim();
  // Sobrou só enfeite (seta, emoji de apontar...)? A linha inteira era o link.
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : "";
}

export function stripUrlsAndMarkdownLinks(text: string): string {
  const lines = text.split("\n").map((line) => {
    const stripped = line
      .replace(MARKDOWN_LINK, (_m, label: string) => (label.trim() && !URL_LIKE.test(label) ? label.trim() : ""))
      .replace(RAW_URL, keepTrailingPunctuation)
      .replace(HALLUCINATED_APP, keepTrailingPunctuation)
      .replace(BARE_DOMAIN, keepTrailingPunctuation);
    return stripped === line ? line : cleanLine(stripped);
  });
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------------ */

const WORD_END = String.raw`(?![\p{L}])`;
const GREETING = String.raw`(?:bom dia|boa tarde|boa noite|oi+|ol[aá]|opa|e a[ií]|eae|fala|salve)`;
const CATCHPHRASE = String.raw`(?:bora (?:pra|para) mais um(?:\s+(?:pedido|lanche|burger|round|rodada))?|bora l[aá]|bora embarcar (?:nessa|nesse|esse)(?:\s+pedido)?)`;
/** Nome logo após a saudação ("Boa noite, Joao!"): só conta se for seguido de pontuação ou do fim. */
const NAME = String.raw`(?:[,\s]+\p{Lu}[\p{L}'’-]*(?=[!.,…?]|$))?`;
const OPENING = new RegExp(String.raw`^\s*(?:${GREETING}|${CATCHPHRASE})${WORD_END}${NAME}[!.,…?\s]*`, "iu");

/**
 * Com `shouldGreet === false` (conversa em andamento), remove saudações e bordões do começo
 * da resposta para ela ir direto ao assunto. Pode devolver "" se a mensagem era só saudação.
 */
export function stripRepeatedGreeting(text: string, shouldGreet: boolean): string {
  if (shouldGreet) return text;
  let out = text;
  for (let i = 0; i < 5; i++) {
    const next = out.replace(OPENING, "");
    if (next === out) break;
    out = next;
  }
  out = out.trim();
  return out && out !== text.trim() ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}
