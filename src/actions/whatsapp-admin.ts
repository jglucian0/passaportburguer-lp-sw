"use server";

import { desc, eq, gt, or } from "drizzle-orm";
import { z } from "zod";

import { getActiveAdminSession as getAdminSession } from "@/infra/auth/active-session";
import { db } from "@/infra/db";
import { customers, whatsappMessages, whatsappSessions, type WhatsAppSessionState } from "@/infra/db/schema";
import { HANDOFF_MINUTES } from "@/infra/whatsapp/tools";

import { failure, success, type ActionResult } from "./result";

export type WhatsAppChatView = {
  phone: string;
  customerName: string | null;
  state: WhatsAppSessionState;
  lastInteractionAt: string;
  /** Presente (e no futuro) = IA pausada / atendimento humano. */
  botPausedUntil: string | null;
};

/** Sessões "recentes": conversa nas últimas 24h (janela da Meta) ou IA ainda pausada. */
const RECENT_MS = 24 * 60 * 60 * 1000;
const LIMIT = 60;

const phoneSchema = z.object({ phone: z.string().regex(/^\d{10,15}$/, "Telefone inválido.") });

async function requireAdmin() {
  return getAdminSession();
}

export async function listWhatsAppChats(): Promise<ActionResult<WhatsAppChatView[]>> {
  if (!(await requireAdmin())) return failure("Sessão expirada. Faça login novamente.");

  const now = new Date();
  const rows = await db
    .select({
      phone: whatsappSessions.phone,
      state: whatsappSessions.state,
      lastInteractionAt: whatsappSessions.lastInteractionAt,
      botPausedUntil: whatsappSessions.botPausedUntil,
      customerName: customers.name,
    })
    .from(whatsappSessions)
    .leftJoin(customers, eq(customers.id, whatsappSessions.customerId))
    .where(
      or(
        gt(whatsappSessions.lastInteractionAt, new Date(now.getTime() - RECENT_MS)),
        gt(whatsappSessions.botPausedUntil, now),
      ),
    )
    .orderBy(desc(whatsappSessions.lastInteractionAt))
    .limit(LIMIT);

  return success(
    rows.map((r) => ({
      phone: r.phone,
      customerName: r.customerName ?? null,
      state: r.state,
      lastInteractionAt: r.lastInteractionAt.toISOString(),
      botPausedUntil: r.botPausedUntil && r.botPausedUntil > now ? r.botPausedUntil.toISOString() : null,
    })),
  );
}

/** "Assumir conversa": pausa a IA por 30 min (cada clique renova o prazo a partir de agora). */
export async function takeOverWhatsAppChat(input: unknown): Promise<ActionResult<{ botPausedUntil: string }>> {
  const session = await requireAdmin();
  if (!session) return failure("Sessão expirada. Faça login novamente.");
  const parsed = phoneSchema.safeParse(input);
  if (!parsed.success) return failure("Telefone inválido.");

  const until = new Date(Date.now() + HANDOFF_MINUTES * 60_000);
  const updated = await db
    .update(whatsappSessions)
    .set({ botPausedUntil: until, updatedAt: new Date() })
    .where(eq(whatsappSessions.phone, parsed.data.phone))
    .returning({ phone: whatsappSessions.phone });
  if (updated.length === 0) return failure("Conversa não encontrada.");

  // Trilha: quem assumiu (também é o que a IA vê no histórico ao voltar).
  await db
    .insert(whatsappMessages)
    .values({
      phone: parsed.data.phone,
      role: "system",
      content: `HANDOFF: conversa assumida por ${session.name} (IA pausada por ${HANDOFF_MINUTES} min)`,
      mediaType: "text",
    })
    .catch(() => undefined);

  return success({ botPausedUntil: until.toISOString() });
}

/** "Reativar IA": libera o bot imediatamente. */
export async function resumeWhatsAppBot(input: unknown): Promise<ActionResult<null>> {
  const session = await requireAdmin();
  if (!session) return failure("Sessão expirada. Faça login novamente.");
  const parsed = phoneSchema.safeParse(input);
  if (!parsed.success) return failure("Telefone inválido.");

  const updated = await db
    .update(whatsappSessions)
    .set({ botPausedUntil: null, updatedAt: new Date() })
    .where(eq(whatsappSessions.phone, parsed.data.phone))
    .returning({ phone: whatsappSessions.phone });
  if (updated.length === 0) return failure("Conversa não encontrada.");

  await db
    .insert(whatsappMessages)
    .values({
      phone: parsed.data.phone,
      role: "system",
      content: `HANDOFF: IA reativada por ${session.name}`,
      mediaType: "text",
    })
    .catch(() => undefined);

  return success(null);
}
