import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { WhatsAppMediaType } from "@/infra/db/schema";

/** Compara em tempo constante sem vazar tamanho (compara os SHA-256). */
export function safeEqual(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Valida `x-hub-signature-256` (`sha256=<hex>`) sobre o corpo bruto.
 * Aceita mais de um App Secret (um webhook compartilhado por dois apps da Meta); segredos vazios são ignorados.
 */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string | undefined | (string | undefined)[],
): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const secrets = (Array.isArray(appSecret) ? appSecret : [appSecret]).filter((s): s is string => !!s);
  // Sem nenhum segredo configurado: falha fechada.
  return secrets.some((secret) =>
    safeEqual(header, "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex")),
  );
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
  /** Número da empresa que recebeu a mensagem (metadata.phone_number_id). */
  phoneNumberId?: string;
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
      const value = (change as { value?: { messages?: unknown; metadata?: { phone_number_id?: unknown } } })?.value;
      const messages = value?.messages;
      if (!Array.isArray(messages)) continue;
      const phoneNumberId =
        typeof value?.metadata?.phone_number_id === "string" ? value.metadata.phone_number_id : undefined;
      for (const m of messages) {
        const parsed = toInbound(m as RawMessage);
        if (parsed) out.push({ ...parsed, phoneNumberId });
      }
    }
  }
  return out;
}
