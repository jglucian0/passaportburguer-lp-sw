import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/infra/db";
import {
  whatsappInboxBuffer,
  whatsappMessages,
  whatsappSessions,
} from "@/infra/db/schema";

import { markMessageAsRead } from "./client";
import { errorSummary } from "./log";
import type { InboundMessage } from "./webhook";

/** Espera para agrupar mensagens em rajada (1,8 s: rápido sem partir "oi" + "queria um burger"). */
export const DEBOUNCE_MS = 1_800;
/** Lock atômico do turno por telefone (whatsapp_sessions.processing_lock_until). */
export const TURN_LOCK_MS = 30_000;
/** Quantas vezes um turno pode reencadear o seguinte (mensagens que chegaram enquanto respondia). */
const MAX_FOLLOW_UPS = 3;

/**
 * Adquire o lock do turno de forma atômica (um único statement):
 *   INSERT ... ON CONFLICT (phone) DO UPDATE SET processing_lock_until = now()+30s
 *   WHERE processing_lock_until IS NULL OR processing_lock_until < now()
 * Sem linha devolvida => outro turno já está respondendo este telefone.
 */
async function acquireTurnLock(phone: string): Promise<boolean> {
  const until = new Date(Date.now() + TURN_LOCK_MS);
  const rows = await db
    .insert(whatsappSessions)
    .values({ phone, processingLockUntil: until })
    .onConflictDoUpdate({
      target: whatsappSessions.phone,
      set: { processingLockUntil: until },
      setWhere: or(isNull(whatsappSessions.processingLockUntil), lt(whatsappSessions.processingLockUntil, sql`now()`)),
    })
    .returning({ phone: whatsappSessions.phone });
  return rows.length > 0;
}

/** Turnos encadeados podem passar de 30 s: renova o lock a cada turno. */
async function renewTurnLock(phone: string): Promise<void> {
  await db
    .update(whatsappSessions)
    .set({ processingLockUntil: new Date(Date.now() + TURN_LOCK_MS) })
    .where(eq(whatsappSessions.phone, phone))
    .catch((error) => console.error("[whatsapp-bot] falha ao renovar o lock:", errorSummary(error)));
}

async function releaseTurnLock(phone: string): Promise<void> {
  await db
    .update(whatsappSessions)
    .set({ processingLockUntil: null })
    .where(eq(whatsappSessions.phone, phone))
    .catch((error) => console.error("[whatsapp-bot] falha ao liberar o lock:", errorSummary(error)));
}

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

/** Após 3 turnos que falharam, o item é dado como processado (a IA não fica em loop). */
export const MAX_ATTEMPTS = 3;
/** Reserva do lote durante o turno; se o processo morrer, expira e o item volta à fila. */
export const LOCK_MS = 120_000;

/**
 * Debounce por telefone. Após esperar, se chegou mensagem mais recente (de outra execução),
 * esta encerra; a última execução assume todas as pendentes agrupadas.
 *
 * Não-perda: o lote é só RESERVADO (lock + attempts) ao começar; `processed = true` só depois que o
 * turno da IA terminou e a resposta foi enviada. Se falhar, os itens voltam à fila (com a contagem de
 * tentativas) e entram no próximo turno desse cliente, até MAX_ATTEMPTS.
 */
export async function processAfterDebounce(
  phone: string,
  myLastWamid: string,
  delayMs = DEBOUNCE_MS,
  followUps = 0,
): Promise<void> {
  await sleep(delayMs);

  const [latest] = await db
    .select({ wamid: whatsappInboxBuffer.wamid })
    .from(whatsappInboxBuffer)
    .where(and(eq(whatsappInboxBuffer.phone, phone), eq(whatsappInboxBuffer.processed, false)))
    .orderBy(desc(whatsappInboxBuffer.receivedAt), desc(whatsappInboxBuffer.id))
    .limit(1);
  if (!latest || latest.wamid !== myLastWamid) return; // outra execução assume (ou já processado)

  // Lock atômico por telefone: se outro turno está respondendo, encerra sem duplicar a resposta.
  // As mensagens novas ficam no buffer (processed = false); o turno ativo as atende em fila, sem atropelar.
  if (!(await acquireTurnLock(phone))) return;

  const seen = new Set<string>();
  try {
    let handled = await claimAndRunBatch(phone);
    handled.forEach((id) => seen.add(id));

    // O turno acima já PERSISTIU a resposta em whatsapp_messages. Só então olha o que chegou enquanto
    // respondia e encadeia o próximo turno AINDA com o lock (nenhum outro turno entra no meio).
    for (let i = followUps; i < MAX_FOLLOW_UPS; i++) {
      if ((await pendingWamids(phone, seen)).length === 0) break;
      await renewTurnLock(phone);
      handled = await claimAndRunBatch(phone);
      if (handled.length === 0) break;
      handled.forEach((id) => seen.add(id));
    }
  } finally {
    await releaseTurnLock(phone);
  }

  // Corrida na borda: mensagem que entrou depois da última checagem e antes de liberar o lock
  // não conseguiu o lock; sem webhook novo ela ficaria encalhada.
  if (followUps < MAX_FOLLOW_UPS) {
    const fresh = await pendingWamids(phone, seen);
    if (fresh.length > 0) await processAfterDebounce(phone, fresh[0], 0, followUps + 1);
  }
}

/** wamids (mais recente primeiro) das mensagens ainda não processadas, fora as que este turno já tratou. */
async function pendingWamids(phone: string, seen: Set<string>): Promise<string[]> {
  const pending = await db
    .select({ id: whatsappInboxBuffer.id, wamid: whatsappInboxBuffer.wamid })
    .from(whatsappInboxBuffer)
    .where(and(eq(whatsappInboxBuffer.phone, phone), eq(whatsappInboxBuffer.processed, false)))
    .orderBy(desc(whatsappInboxBuffer.receivedAt), desc(whatsappInboxBuffer.id));
  return pending.filter((r) => !seen.has(r.id)).map((r) => r.wamid);
}

/** Reserva o lote pendente, roda o turno e atualiza o buffer. Devolve os ids do lote tratado. */
async function claimAndRunBatch(phone: string): Promise<string[]> {
  // Reserva atômica: só uma execução leva as linhas (as já reservadas e não expiradas ficam de fora).
  const now = new Date();
  const claimed = await db
    .update(whatsappInboxBuffer)
    .set({ attempts: sql`${whatsappInboxBuffer.attempts} + 1`, lockedUntil: new Date(now.getTime() + LOCK_MS) })
    .where(
      and(
        eq(whatsappInboxBuffer.phone, phone),
        eq(whatsappInboxBuffer.processed, false),
        or(isNull(whatsappInboxBuffer.lockedUntil), lt(whatsappInboxBuffer.lockedUntil, now)),
      ),
    )
    .returning({
      id: whatsappInboxBuffer.id,
      payload: whatsappInboxBuffer.payload,
      receivedAt: whatsappInboxBuffer.receivedAt,
      attempts: whatsappInboxBuffer.attempts,
    });
  if (claimed.length === 0) return [];

  const ordered = [...claimed].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const ids = ordered.map((r) => r.id);
  const batch = ordered.map((r) => r.payload as InboundMessage);

  let ok = false;
  try {
    ok = await handleBatch(phone, batch);
  } catch (error) {
    console.error("[whatsapp-bot] falha no lote:", errorSummary(error));
  }

  if (ok) {
    await db
      .update(whatsappInboxBuffer)
      .set({ processed: true, lockedUntil: null })
      .where(inArray(whatsappInboxBuffer.id, ids));
    return ids;
  }

  // Falhou: itens que já esgotaram as tentativas são dados como processados; os demais voltam à fila.
  const giveUp = ordered.filter((r) => r.attempts >= MAX_ATTEMPTS).map((r) => r.id);
  const retry = ordered.filter((r) => r.attempts < MAX_ATTEMPTS).map((r) => r.id);
  if (giveUp.length > 0) {
    console.error("[whatsapp-bot] desistindo de itens após tentativas esgotadas:", giveUp.length);
    await db
      .update(whatsappInboxBuffer)
      .set({ processed: true, lockedUntil: null })
      .where(inArray(whatsappInboxBuffer.id, giveUp));
  }
  if (retry.length > 0) {
    await db
      .update(whatsappInboxBuffer)
      .set({ lockedUntil: null })
      .where(inArray(whatsappInboxBuffer.id, retry));
  }
  return ids;
}

/** true = lote concluído (resposta entregue ou bot pausado); false = falhou e deve voltar à fila. */
async function handleBatch(phone: string, batch: InboundMessage[]): Promise<boolean> {
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

  // Transbordo humano: só registra, não aciona a IA (concluído).
  if (session?.botPausedUntil && session.botPausedUntil.getTime() > Date.now()) return true;

  const { runBotTurn } = await import("./agent");
  return runBotTurn(phone, batch);
}
