
function env(name: "WHATSAPP_PHONE_NUMBER_ID" | "WHATSAPP_ACCESS_TOKEN"): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} não definida.`);
  return v;
}

/* ------------------------------------------------------------------ */
/* Erros da Graph API                                                  */
/* ------------------------------------------------------------------ */

/** Códigos em que trocar para texto não adianta (o problema é o destinatário/janela, não o formato). */
const RECIPIENT_CODES = new Set([131030, 131026, 131047, 131021, 131049]);
/** #131030: "Recipient phone number not in allowed list". */
const NOT_IN_ALLOWED_LIST = 131030;

export class WhatsAppApiError extends Error {
  constructor(
    readonly status: number,
    readonly endpoint: string,
    /** Corpo devolvido pela Meta (uma linha, sem token e com números de telefone mascarados). */
    readonly errorBody: string,
    /** `error.code` da Meta (ex.: 131030), quando o corpo é JSON. */
    readonly code: number | null,
  ) {
    super(`WhatsApp API respondeu ${status} em ${endpoint}: ${errorBody}`);
    this.name = "WhatsAppApiError";
  }
}

/** Corpo do erro para log/Error: sem o token de acesso e sem números de telefone (LGPD). */
export function sanitizeApiErrorBody(body: string): string {
  let text = body;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (token) text = text.split(token).join("<redacted>");
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer <redacted>")
    .replace(/\d{10,15}/g, (d) => `${d.slice(0, 2)}${"*".repeat(d.length - 4)}${d.slice(-2)}`)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

function metaErrorCode(body: string): number | null {
  try {
    const code = (JSON.parse(body) as { error?: { code?: unknown } }).error?.code;
    return typeof code === "number" ? code : null;
  } catch {
    return null;
  }
}

async function toApiError(res: Response, method: string, path: string): Promise<WhatsAppApiError> {
  const raw = await res.text().catch(() => "");
  const error = new WhatsAppApiError(
    res.status,
    `${method} ${path}`,
    sanitizeApiErrorBody(raw),
    metaErrorCode(raw) ?? (/\b131030\b/.test(raw) ? NOT_IN_ALLOWED_LIST : null),
  );
  console.error("[whatsapp-api]", error.message);
  return error;
}

/* ------------------------------------------------------------------ */
/* 9º dígito brasileiro                                                */
/* ------------------------------------------------------------------ */

/**
 * Alterna o 9 após o DDD: 55+DDD+9+8 dígitos <-> 55+DDD+8 dígitos.
 * Retorna null se não for um celular brasileiro de 12/13 dígitos.
 */
export function alternateBrNumber(to: string): string | null {
  const d = to.replace(/\D/g, "");
  if (/^55\d{2}9\d{8}$/.test(d)) return `${d.slice(0, 4)}${d.slice(5)}`; // 13 -> 12
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) return `${d.slice(0, 4)}9${d.slice(4)}`; // 12 -> 13
  return null;
}

/**
 * Variante que a Meta aceitou depois de um #131030 (a lista de destinatários do sandbox casa com UM dos
 * formatos). Só é usada depois de provado que o `wa_id` original foi recusado.
 */
const recipientRewrites = new Map<string, string>();
export function resetRecipientRewrites(): void {
  recipientRewrites.clear();
}

/* ------------------------------------------------------------------ */
/* Envio                                                               */
/* ------------------------------------------------------------------ */

async function postMessages(payload: Record<string, unknown>): Promise<unknown> {
  const path = `/v21.0/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`;
  const res = await fetch(`https://graph.facebook.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("WHATSAPP_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  if (!res.ok) throw await toApiError(res, "POST", path);
  return res.json();
}

/**
 * O `to` é o `wa_id` exatamente como a Meta o entregou (sem mexer no 9º dígito). Só se a Meta recusar com
 * #131030 num número brasileiro é que tentamos, uma vez, o formato alternativo.
 */
async function graphPost(body: Record<string, unknown>): Promise<unknown> {
  const to = typeof body.to === "string" ? body.to : null;
  if (!to) return postMessages(body);

  const first = recipientRewrites.get(to) ?? to;
  try {
    return await postMessages({ ...body, to: first });
  } catch (error) {
    if (!(error instanceof WhatsAppApiError) || error.code !== NOT_IN_ALLOWED_LIST) throw error;
    const alt = alternateBrNumber(first);
    if (!alt) throw error;
    try {
      const result = await postMessages({ ...body, to: alt });
      if (alt === to) recipientRewrites.delete(to);
      else recipientRewrites.set(to, alt);
      return result;
    } catch {
      throw error; // o erro original é o mais informativo; o da 2ª tentativa já foi logado
    }
  }
}

/** Corta por pontos de código (não parte emoji ao meio); com `ellipsis`, o "…" cabe dentro do limite. */
export function truncate(text: string, max: number, ellipsis = false): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return ellipsis ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : chars.slice(0, max).join("");
}

const LIMITS = { text: 4096, body: 1024, buttonTitle: 20, buttonId: 256 } as const;

/** Erro de formato (400) que o texto simples contorna; recipiente/janela não tem como contornar. */
function canFallbackToText(error: unknown): boolean {
  return (
    error instanceof WhatsAppApiError &&
    error.status === 400 &&
    !(error.code !== null && RECIPIENT_CODES.has(error.code))
  );
}

export type ReplyButton = { id: string; title: string };

export function sendTextMessage(to: string, text: string) {
  return graphPost({
    to,
    type: "text",
    text: { body: truncate(text, LIMITS.text), preview_url: false },
  });
}

/** Máximo 3 botões (limite da Meta). Se a Meta recusar o formato (400), cai para texto com as opções. */
export async function sendInteractiveButtons(to: string, bodyText: string, buttons: ReplyButton[]) {
  if (buttons.length < 1 || buttons.length > 3) {
    throw new Error("sendInteractiveButtons aceita de 1 a 3 botões.");
  }
  const clean = buttons.map((b) => ({
    id: truncate(b.id, LIMITS.buttonId),
    title: truncate(b.title.trim(), LIMITS.buttonTitle),
  }));
  try {
    return await graphPost({
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: truncate(bodyText, LIMITS.body, true) },
        action: {
          buttons: clean.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })),
        },
      },
    });
  } catch (error) {
    if (!canFallbackToText(error)) throw error;
    const options = buttons.map((b) => `• ${b.title.trim()}`).join("\n");
    return sendTextMessage(to, `${truncate(bodyText, 3000, true)}\n\n${options}`);
  }
}

/**
 * Botão que abre um link (Cardápio Rápido / Checkout). Se a Meta recusar o formato (400: URL inválida,
 * texto fora do limite etc.), cai para texto simples com o link.
 */
export async function sendCtaUrlButton(to: string, bodyText: string, buttonText: string, url: string) {
  try {
    return await graphPost({
      to,
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: { text: truncate(bodyText, LIMITS.body, true) },
        action: {
          name: "cta_url",
          parameters: { display_text: truncate(buttonText.trim(), LIMITS.buttonTitle), url },
        },
      },
    });
  } catch (error) {
    if (!canFallbackToText(error)) throw error;
    // Se o corpo já traz o link (Pix), não repete.
    if (bodyText.includes(url)) return sendTextMessage(to, bodyText);
    // O link nunca é cortado: o corpo é que cede espaço.
    return sendTextMessage(to, `${truncate(bodyText, LIMITS.text - url.length - 4, true)}\n\n${url}`);
  }
}

/** Marca como lida (dois tiques azuis). */
export function markMessageAsRead(wamid: string) {
  return graphPost({ status: "read", message_id: wamid });
}

export type DownloadedMedia = { buffer: Buffer; mimeType: string };

/** Resolve a URL temporária da mídia e baixa o binário (a URL também exige o Bearer). */
export async function downloadMedia(mediaId: string): Promise<DownloadedMedia> {
  const auth = { Authorization: `Bearer ${env("WHATSAPP_ACCESS_TOKEN")}` };
  const path = `/v21.0/${encodeURIComponent(mediaId)}`;
  const metaRes = await fetch(`https://graph.facebook.com${path}`, { headers: auth });
  if (!metaRes.ok) throw await toApiError(metaRes, "GET", path);
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) throw new Error("Mídia sem URL.");

  const fileRes = await fetch(meta.url, { headers: auth });
  if (!fileRes.ok) throw new Error(`Falha ao baixar mídia (${fileRes.status}).`);
  return {
    buffer: Buffer.from(await fileRes.arrayBuffer()),
    mimeType: meta.mime_type ?? fileRes.headers.get("content-type") ?? "application/octet-stream",
  };
}
