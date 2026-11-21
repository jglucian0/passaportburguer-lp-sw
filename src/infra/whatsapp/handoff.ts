import { db } from "@/infra/db";

import { endOfTodaySaoPaulo } from "./greeting";
import { whatsappMessages, whatsappSessions } from "@/infra/db/schema";

export const HANDOFF_MINUTES = 30;

/**
 * Bot não consegue atender (cliente insiste em pedir pelo chat, não entendeu, repetiu a mesma resposta):
 * para de responder esse cliente até o fim do dia e deixa o aviso no painel (o ping do admin conta bot pausado).
 */
export async function escalateForToday(phone: string, reason: string) {
  const until = endOfTodaySaoPaulo();
  const cleanReason = reason.trim().slice(0, 300) || "Sem motivo informado";
  await db
    .insert(whatsappSessions)
    .values({ phone, botPausedUntil: until })
    .onConflictDoUpdate({ target: whatsappSessions.phone, set: { botPausedUntil: until, updatedAt: new Date() } });
  await db
    .insert(whatsappMessages)
    .values({ phone, role: "system", content: `HANDOFF: precisa de atendimento humano — ${cleanReason}`, mediaType: "text" })
    .catch(() => undefined);
  return { ok: true, pausedUntil: until.toISOString() };
}

export async function requestHumanHandoff(phone: string, reason: string, minutes: number = HANDOFF_MINUTES) {
  const until = new Date(Date.now() + minutes * 60_000);
  const cleanReason = reason.trim().slice(0, 300) || "Sem motivo informado";

  await db
    .insert(whatsappSessions)
    .values({ phone, botPausedUntil: until })
    .onConflictDoUpdate({
      target: whatsappSessions.phone,
      set: { botPausedUntil: until, updatedAt: new Date() },
    });

  /* Marca no histórico (e é o que o painel lê para listar atendimentos pedidos). */
  await db.insert(whatsappMessages).values({
    phone,
    role: "system",
    content: `HANDOFF: ${cleanReason}`,
    mediaType: "text",
  });

  /* Sem WhatsApp para a loja: o número do bot é o mesmo do atendente. O aviso é o HANDOFF no histórico, lido pelo painel. */

  return { ok: true, pausedUntil: until.toISOString() };
}
