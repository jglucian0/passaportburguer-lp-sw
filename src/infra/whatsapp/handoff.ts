import { db } from "@/infra/db";
import { whatsappMessages, whatsappSessions } from "@/infra/db/schema";

import { sendTextMessage } from "./client";

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

  /* Alerta ativo no WhatsApp da loja (best-effort: fora da janela de 24h a Meta pode recusar). */
  const store = process.env.STORE_WHATSAPP?.replace(/\D/g, "");
  if (store) {
    await sendTextMessage(
      store,
      `🔔 Cliente ${phone} pediu atendimento humano.\nMotivo: ${cleanReason}\nO bot ficará pausado por ${HANDOFF_MINUTES} min.`,
    ).catch(() => undefined);
  }

  return { ok: true, pausedUntil: until.toISOString() };
}
