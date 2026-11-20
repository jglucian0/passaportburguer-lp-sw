import { db } from "@/infra/db";
import { whatsappMessages, whatsappSessions } from "@/infra/db/schema";

/**
 * Coexistência (app WhatsApp Business + API): quando o dono responde pelo celular, a Meta manda
 * `smb_message_echoes`. O bot então se cala naquele chat por um tempo, para não atravessar o atendente.
 */

const DEFAULT_PAUSE_MINUTES = 60;
const MAX_PAUSE_MINUTES = 1440;

export function echoPauseMinutes(): number {
  const n = Number(process.env.WHATSAPP_ECHO_PAUSE_MINUTES);
  return Number.isInteger(n) && n >= 1 && n <= MAX_PAUSE_MINUTES ? n : DEFAULT_PAUSE_MINUTES;
}

type EchoPayload = {
  entry?: Array<{
    changes?: Array<{ field?: string; value?: { message_echoes?: Array<{ to?: unknown }> } }>;
  }>;
};

/** Telefones dos CLIENTES (campo `to`) que receberam resposta manual; sem duplicatas. */
export function extractEchoRecipients(payload: unknown): string[] {
  const recipients = new Set<string>();
  for (const entry of (payload as EchoPayload)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "smb_message_echoes") continue;
      for (const echo of change.value?.message_echoes ?? []) {
        if (typeof echo.to === "string" && /^\d{10,15}$/.test(echo.to)) recipients.add(echo.to);
      }
    }
  }
  return [...recipients];
}

/** Pausa o bot deste chat por `minutes` e deixa o aviso no histórico (visível no painel). */
export async function pauseBotForOwnerReply(phone: string, minutes: number = echoPauseMinutes()): Promise<void> {
  const until = new Date(Date.now() + minutes * 60_000);
  await db
    .insert(whatsappSessions)
    .values({ phone, botPausedUntil: until })
    .onConflictDoUpdate({ target: whatsappSessions.phone, set: { botPausedUntil: until, updatedAt: new Date() } });
  await db
    .insert(whatsappMessages)
    .values({
      phone,
      role: "system",
      content: `ATENDENTE respondeu pelo celular: bot pausado por ${minutes} min neste chat.`,
      mediaType: "text",
    })
    .catch(() => undefined);
}
