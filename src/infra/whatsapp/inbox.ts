import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/infra/db";
import {
  whatsappInboxBuffer,
  whatsappMessages,
  whatsappSessions,
} from "@/infra/db/schema";

import { markMessageAsRead } from "./client";
import type { InboundMessage } from "./webhook";

export const DEBOUNCE_MS = 5_000;

/**
 * Grava no buffer. `onConflictDoNothing` por wamid => reentrega da Meta é ignorada.
 * Retorna só as mensagens realmente novas.
 */
export async function bufferInbound(messages: InboundMessage[]): Promise<InboundMessage[]> {
  const fresh: InboundMessage[] = [];
  for (const m of messages) {
    const inserted = await db
      .insert(whatsappInboxBuffer)
      .values({ phone: m.phone, wamid: m.wamid, payload: m })
      .onConflictDoNothing({ target: whatsappInboxBuffer.wamid })
      .returning({ id: whatsappInboxBuffer.id });
    if (inserted.length > 0) {
      fresh.push(m);
      // Falha em marcar como lida não pode derrubar o webhook.
      await markMessageAsRead(m.wamid).catch(() => undefined);
    }
  }
  return fresh;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Debounce por telefone. Após esperar, se chegou mensagem mais recente (de outra execução),
 * esta encerra; a última execução assume todas as pendentes agrupadas.
 */
export async function processAfterDebounce(
  phone: string,
  myLastWamid: string,
  delayMs = DEBOUNCE_MS,
): Promise<void> {
  await sleep(delayMs);

  const [latest] = await db
    .select({ wamid: whatsappInboxBuffer.wamid })
    .from(whatsappInboxBuffer)
    .where(and(eq(whatsappInboxBuffer.phone, phone), eq(whatsappInboxBuffer.processed, false)))
    .orderBy(desc(whatsappInboxBuffer.receivedAt), desc(whatsappInboxBuffer.id))
    .limit(1);
  if (!latest || latest.wamid !== myLastWamid) return; // outra execução assume (ou já processado)

  // Claim atômico: só uma execução leva as linhas.
  const claimed = await db
    .update(whatsappInboxBuffer)
    .set({ processed: true })
    .where(and(eq(whatsappInboxBuffer.phone, phone), eq(whatsappInboxBuffer.processed, false)))
    .returning({ payload: whatsappInboxBuffer.payload, receivedAt: whatsappInboxBuffer.receivedAt });
  if (claimed.length === 0) return;

  const batch = claimed
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
    .map((r) => r.payload as InboundMessage);

  await handleBatch(phone, batch);
}

async function handleBatch(phone: string, batch: InboundMessage[]): Promise<void> {
  // Histórico (idempotente por wamid).
  await db
    .insert(whatsappMessages)
    .values(
      batch.map((m) => ({
        wamid: m.wamid,
        phone,
        role: "user" as const,
        content: m.content,
        mediaType: m.mediaType,
      })),
    )
    .onConflictDoNothing({ target: whatsappMessages.wamid });

  const [session] = await db
    .insert(whatsappSessions)
    .values({ phone })
    .onConflictDoUpdate({
      target: whatsappSessions.phone,
      set: { lastInteractionAt: sql`now()`, updatedAt: sql`now()` },
    })
    .returning({ botPausedUntil: whatsappSessions.botPausedUntil });

  // Transbordo humano: só registra, não aciona a IA.
  if (session?.botPausedUntil && session.botPausedUntil.getTime() > Date.now()) return;

  const { runBotTurn } = await import("./agent");
  await runBotTurn(phone, batch);
}
