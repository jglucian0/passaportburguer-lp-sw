import { db } from "@/infra/db";
import { whatsappMessages, whatsappSessions } from "@/infra/db/schema";

export const HANDOFF_MINUTES = 30;

export async function requestHumanHandoff(phone: string, reason: string) {
  const until = new Date(Date.now() + HANDOFF_MINUTES * 60_000);
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
