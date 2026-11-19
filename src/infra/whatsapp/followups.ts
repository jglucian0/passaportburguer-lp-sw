import { and, asc, desc, eq, gt, inArray, lte } from "drizzle-orm";

import { getStoreStatus, nextOpeningAt } from "@/core/store/opening-hours";
import { db } from "@/infra/db";
import { customers, orders, whatsappFollowups, whatsappMessages, whatsappSessions } from "@/infra/db/schema";
import { loadStoreSettings } from "@/infra/db/store-settings";

import { sendCtaUrlButton, sendTemplateMessage, sendTextMessage } from "./client";
import { errorSummary } from "./log";
import { customerPhoneVariants, getTenantId } from "./shared";
import { generateQuickMenuLink, getCustomerContext } from "./tools";

/** Janela de atendimento da Meta: texto livre só até 24 h depois da última mensagem do cliente. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Atraso aleatório depois da abertura, para não parecer disparo automático. */
const JITTER_MIN_MS = 5 * 60_000;
const JITTER_MAX_MS = 20 * 60_000;
const MAX_PER_RUN = 30;
/** O link do cardápio enviado no retorno vale mais que o do chat (o cliente pode demorar a ver). */
const MENU_LINK_MINUTES = 180;

const randomBetween = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

/* ------------------------------------------------------------------ */
/* Texto                                                               */
/* ------------------------------------------------------------------ */

/** Variações (humanizado): a primeira é o texto aprovado pela loja. */
export function reopenMessage(firstName: string | null, variant: number): string {
  const name = firstName ? ` ${firstName}` : "";
  const variants = [
    `Oi${name}! Aqui é do Passaporte Burguer 😄 Vi que você passou por aqui há pouco, mas seu pedido ainda não chegou pra gente. Bora matar essa fome?`,
    `Oi${name}! Já abrimos aqui no Passaporte Burguer 🍔 Você tinha falado com a gente e a chapa já está quente. Quer dar uma olhada no cardápio?`,
    `E aí${name}! Passando pra avisar que o Passaporte Burguer já está aberto 😋 Bora escolher o lanche de hoje?`,
  ];
  return variants[((variant % variants.length) + variants.length) % variants.length];
}

/** Template aprovado na Meta (plug-and-play): só é usado fora da janela de 24 h e se o nome estiver configurado. */
export function reopenTemplate(): { name: string; language: string } | null {
  const name = process.env.WHATSAPP_TEMPLATE_REOPEN?.trim();
  if (!name) return null;
  return { name, language: process.env.WHATSAPP_TEMPLATE_LANG?.trim() || "pt_BR" };
}

/* ------------------------------------------------------------------ */
/* Opt-out                                                             */
/* ------------------------------------------------------------------ */

export async function setMarketingOptOut(phone: string): Promise<void> {
  await db
    .insert(whatsappSessions)
    .values({ phone, marketingOptOutAt: new Date() })
    .onConflictDoUpdate({ target: whatsappSessions.phone, set: { marketingOptOutAt: new Date() } });
  await cancelFollowups(phone, "OPT_OUT");
}

export async function cancelFollowups(phone: string, reason: string): Promise<void> {
  await db
    .update(whatsappFollowups)
    .set({ status: "CANCELLED", outcome: reason })
    .where(and(eq(whatsappFollowups.phone, phone), eq(whatsappFollowups.status, "PENDING")));
}

/* ------------------------------------------------------------------ */
/* Enfileirar (chamado no fim de cada turno do bot)                    */
/* ------------------------------------------------------------------ */

/**
 * Cliente falou com a loja FECHADA: agenda UMA mensagem de retorno para a próxima abertura
 * (ou, se não há horário previsto, ex.: pausa manual, para assim que a loja voltar).
 */
export async function enqueueReopenFollowup(phone: string, now: Date = new Date()): Promise<"queued" | "skipped"> {
  const tenantId = await getTenantId();
  if (!tenantId) return "skipped";
  const settings = await loadStoreSettings(tenantId);
  if (!settings) return "skipped";

  const status = getStoreStatus({ openingHours: settings.openingHours, isOpenOverride: settings.isOpenOverride, now });
  if (status.isOpen) return "skipped";

  const [session] = await db.select().from(whatsappSessions).where(eq(whatsappSessions.phone, phone)).limit(1);
  if (session?.marketingOptOutAt) return "skipped";
  if (session?.botPausedUntil && session.botPausedUntil.getTime() > now.getTime()) return "skipped"; // humano atendendo

  const [lastUser] = await db
    .select({ createdAt: whatsappMessages.createdAt })
    .from(whatsappMessages)
    .where(and(eq(whatsappMessages.phone, phone), eq(whatsappMessages.role, "user")))
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(1);
  const lastCustomerMessageAt = lastUser?.createdAt ?? now;

  const opensAt = status.reason === "MANUALLY_CLOSED" ? null : nextOpeningAt(settings.openingHours, now);
  const base = opensAt ?? now;
  const scheduledFor = new Date(base.getTime() + randomBetween(JITTER_MIN_MS, JITTER_MAX_MS));

  try {
    await db.insert(whatsappFollowups).values({ phone, kind: "REOPEN", scheduledFor, lastCustomerMessageAt });
    return "queued";
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") return "skipped"; // já existe um retorno pendente para este telefone
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Disparo (cron)                                                      */
/* ------------------------------------------------------------------ */

export type DispatchSummary = { storeOpen: boolean; due: number; sent: number; cancelled: number; skipped: number; failed: number };

type SendDeps = {
  text: typeof sendTextMessage;
  cta: typeof sendCtaUrlButton;
  template: typeof sendTemplateMessage;
};
const defaultSend: SendDeps = { text: sendTextMessage, cta: sendCtaUrlButton, template: sendTemplateMessage };

async function orderedSince(phone: string, since: Date): Promise<boolean> {
  const variants = customerPhoneVariants(phone);
  if (variants.length === 0) return false;
  const rows = await db.select({ id: customers.id }).from(customers).where(inArray(customers.phone, variants));
  if (rows.length === 0) return false;
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        inArray(
          orders.customerId,
          rows.map((r) => r.id),
        ),
        gt(orders.createdAt, since),
      ),
    )
    .limit(1);
  return !!order;
}

/** Envia os retornos vencidos. Só roda com a loja ABERTA; cada item é revalidado antes de sair. */
export async function dispatchDueFollowups(now: Date = new Date(), send: SendDeps = defaultSend): Promise<DispatchSummary> {
  const summary: DispatchSummary = { storeOpen: false, due: 0, sent: 0, cancelled: 0, skipped: 0, failed: 0 };

  const tenantId = await getTenantId();
  if (!tenantId) return summary;
  const settings = await loadStoreSettings(tenantId);
  if (!settings) return summary;
  const status = getStoreStatus({ openingHours: settings.openingHours, isOpenOverride: settings.isOpenOverride, now });
  summary.storeOpen = status.isOpen;
  if (!status.isOpen) return summary; // fechada: os itens continuam na fila

  const due = await db
    .select()
    .from(whatsappFollowups)
    .where(and(eq(whatsappFollowups.status, "PENDING"), lte(whatsappFollowups.scheduledFor, now)))
    .orderBy(asc(whatsappFollowups.scheduledFor))
    .limit(MAX_PER_RUN);
  summary.due = due.length;

  const finish = (id: string, statusValue: "CANCELLED" | "SKIPPED", outcome: string) =>
    db
      .update(whatsappFollowups)
      .set({ status: statusValue, outcome })
      .where(and(eq(whatsappFollowups.id, id), eq(whatsappFollowups.status, "PENDING")));

  for (const item of due) {
    try {
      const [session] = await db.select().from(whatsappSessions).where(eq(whatsappSessions.phone, item.phone)).limit(1);
      if (session?.marketingOptOutAt) {
        await finish(item.id, "CANCELLED", "OPT_OUT");
        summary.cancelled++;
        continue;
      }
      if (session?.botPausedUntil && session.botPausedUntil.getTime() > now.getTime()) {
        await finish(item.id, "CANCELLED", "HANDOFF");
        summary.cancelled++;
        continue;
      }
      // O cliente voltou a falar depois de entrar na fila: a conversa já seguiu, não incomoda.
      const [later] = await db
        .select({ id: whatsappMessages.id })
        .from(whatsappMessages)
        .where(
          and(
            eq(whatsappMessages.phone, item.phone),
            eq(whatsappMessages.role, "user"),
            gt(whatsappMessages.createdAt, new Date(item.createdAt.getTime() + 1000)),
          ),
        )
        .limit(1);
      if (later) {
        await finish(item.id, "CANCELLED", "CUSTOMER_ACTIVE");
        summary.cancelled++;
        continue;
      }
      if (await orderedSince(item.phone, item.lastCustomerMessageAt)) {
        await finish(item.id, "CANCELLED", "ORDERED");
        summary.cancelled++;
        continue;
      }

      const insideWindow = now.getTime() - item.lastCustomerMessageAt.getTime() < SERVICE_WINDOW_MS;
      const template = reopenTemplate();
      if (!insideWindow && !template) {
        // Sem template aprovado não dá para falar fora das 24 h: descarta sem enviar.
        await finish(item.id, "SKIPPED", "WINDOW_EXPIRED_NO_TEMPLATE");
        summary.skipped++;
        continue;
      }

      // Reivindica o item: dois crons simultâneos nunca enviam duas vezes.
      const claimed = await db
        .update(whatsappFollowups)
        .set({ status: "SENT", sentAt: now, outcome: insideWindow ? "text" : "template" })
        .where(and(eq(whatsappFollowups.id, item.id), eq(whatsappFollowups.status, "PENDING")))
        .returning({ id: whatsappFollowups.id });
      if (claimed.length === 0) continue;

      const customer = await getCustomerContext(item.phone).catch(() => null);
      const firstName = customer && customer.isRegistered ? customer.firstName : null;

      try {
        if (insideWindow) {
          const body = reopenMessage(firstName, Math.floor(Math.random() * 3));
          const { url } = generateQuickMenuLink(item.phone, MENU_LINK_MINUTES);
          await send.cta(item.phone, body, "Cardápio Rápido", url);
          await db
            .insert(whatsappMessages)
            .values({ phone: item.phone, role: "assistant", content: body, mediaType: "text" })
            .catch(() => undefined);
        } else if (template) {
          await send.template(item.phone, template.name, template.language, [firstName ?? "amigo(a)"]);
          await db
            .insert(whatsappMessages)
            .values({ phone: item.phone, role: "assistant", content: reopenMessage(firstName, 0), mediaType: "text" })
            .catch(() => undefined);
        }
        summary.sent++;
      } catch (error) {
        // Sem nova tentativa (evita spam): o motivo fica registrado.
        console.error("[whatsapp-followups] falha no envio:", errorSummary(error));
        await db
          .update(whatsappFollowups)
          .set({ status: "CANCELLED", outcome: "SEND_FAILED" })
          .where(eq(whatsappFollowups.id, item.id));
        summary.failed++;
      }
    } catch (error) {
      console.error("[whatsapp-followups] falha ao processar item:", errorSummary(error));
      summary.failed++;
    }
  }
  return summary;
}
