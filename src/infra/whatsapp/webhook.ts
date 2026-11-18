import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { WhatsAppMediaType } from "@/infra/db/schema";

/** Compara em tempo constante sem vazar tamanho (compara os SHA-256). */
export function safeEqual(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Valida `x-hub-signature-256` (`sha256=<hex>`) sobre o corpo bruto. */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string | undefined,
): boolean {
  if (!header || !appSecret || !header.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeEqual(header, expected);
}

/** Figurinha e reação são tratadas igual: gesto positivo, sem conteúdo a interpretar. */
export const STICKER_TEXT = "[Cliente enviou uma figurinha/reação positiva]";

export type InboundMessage = {
  wamid: string;
  phone: string;
  mediaType: WhatsAppMediaType;
  /** Texto legível (texto digitado, título do botão) ou marcador para mídia. */
  content: string;
  /** Id da mídia na Meta (áudio/imagem/sticker), para `downloadMedia`. */
  mediaId?: string;
  timestamp?: number;
  raw: unknown;
};

type RawMessage = {
  id?: unknown;
  from?: unknown;
  timestamp?: unknown;
  type?: unknown;
  text?: { body?: unknown };
  audio?: { id?: unknown };
  image?: { id?: unknown; caption?: unknown };
  sticker?: { id?: unknown };
  reaction?: { emoji?: unknown };
  interactive?: {
    button_reply?: { id?: unknown; title?: unknown };
    list_reply?: { id?: unknown; title?: unknown };
  };
};

function toInbound(m: RawMessage): InboundMessage | null {
  if (typeof m.id !== "string" || typeof m.from !== "string") return null;
  const phone = m.from.replace(/\D/g, "");
  if (!phone) return null;
  const base = {
    wamid: m.id,
    phone,
    timestamp: m.timestamp ? Number(m.timestamp) : undefined,
    raw: m,
  };

  switch (m.type) {
    case "text":
      return typeof m.text?.body === "string"
        ? { ...base, mediaType: "text", content: m.text.body }
        : null;
    case "audio":
      return {
        ...base,
        mediaType: "audio",
        content: "[áudio]",
        mediaId: typeof m.audio?.id === "string" ? m.audio.id : undefined,
      };
    case "image":
      return {
        ...base,
        mediaType: "image",
        content: typeof m.image?.caption === "string" ? m.image.caption : "[imagem]",
        mediaId: typeof m.image?.id === "string" ? m.image.id : undefined,
      };
    case "sticker":
      return {
        ...base,
        mediaType: "sticker",
        content: STICKER_TEXT,
        mediaId: typeof m.sticker?.id === "string" ? m.sticker.id : undefined,
      };
    case "reaction":
      // Reação removida (sem emoji) não é mensagem do cliente.
      return typeof m.reaction?.emoji === "string" && m.reaction.emoji
        ? { ...base, mediaType: "sticker", content: STICKER_TEXT }
        : null;
    case "interactive": {
      const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
      const title = typeof r?.title === "string" ? r.title : "";
      const id = typeof r?.id === "string" ? r.id : "";
      return { ...base, mediaType: "interactive", content: title || id || "[interativo]" };
    }
    default:
      return null; // tipos não suportados (localização, contatos, reações…)
  }
}

/** Extrai `entry[].changes[].value.messages[]`; ignora `statuses[]` e tipos não suportados. */
export function extractInboundMessages(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (body as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const messages = (change as { value?: { messages?: unknown } })?.value?.messages;
      if (!Array.isArray(messages)) continue;
      for (const m of messages) {
        const parsed = toInbound(m as RawMessage);
        if (parsed) out.push(parsed);
      }
    }
  }
  return out;
}
