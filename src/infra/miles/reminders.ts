import { and, eq, inArray } from "drizzle-orm";

import { computeBalance, MILES_REMINDER_LEAD_DAYS } from "@/core/miles/ledger";
import { db } from "@/infra/db";
import { customers, milesLedger, milesSettings, whatsappMessages, whatsappSessions } from "@/infra/db/schema";
import { sendTemplateMessage, sendTextMessage } from "@/infra/whatsapp/client";
import { errorSummary } from "@/infra/whatsapp/log";
import { getBrazilianPhoneVariants } from "@/infra/whatsapp/phone";

import { loadMilesConfig } from "./config";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = DAY_MS; // texto livre só até 24 h após a última mensagem do cliente
const MAX_PER_RUN = 100;

export function milesExpiryMessage(firstName: string | null, miles: number, lapsesAt: Date): string {
  const name = firstName ? ` ${firstName}` : "";
  const date = lapsesAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
  return `Oi${name}! Suas ${miles.toLocaleString("pt-BR")} milhas do Passaporte Burguer vencem em ${date} ✈️ Faça um pedido até lá para renová-las e não perder nada!`;
}

/**
 * Avisa quem tem milhas prestes a vencer pela validade renovável (dia 38 de 45). Uma vez por ciclo
 * (a trava é o registro `miles-expiry:*`). Fora da janela de 24 h só vai se houver template aprovado
 * em WHATSAPP_TEMPLATE_MILES_EXPIRY ({{1}} nome, {{2}} milhas, {{3}} data). Respeita o opt-out de marketing.
 */
export async function runMilesExpiryReminders(now: Date = new Date()): Promise<{ sent: number; skipped: number }> {
  const tenantRows = await db.select({ tenantId: milesSettings.tenantId }).from(milesSettings).where(eq(milesSettings.enabled, true));
  let sent = 0;
  let skipped = 0;

  for (const { tenantId } of tenantRows) {
    const config = await loadMilesConfig(tenantId);
    if (!config.enabled || config.rollingValidityDays <= 0) continue;

    const rows = await db
      .select({
        customerId: milesLedger.customerId,
        miles: milesLedger.miles,
        createdAt: milesLedger.createdAt,
        expiresAt: milesLedger.expiresAt,
        type: milesLedger.type,
      })
      .from(milesLedger)
      .where(eq(milesLedger.tenantId, tenantId));
    const byCustomer = new Map<string, typeof rows>();
    for (const r of rows) byCustomer.set(r.customerId, [...(byCustomer.get(r.customerId) ?? []), r]);

    const due: { customerId: string; miles: number; lapsesAt: Date }[] = [];
    for (const [customerId, entries] of byCustomer) {
      const balance = computeBalance(
        entries.map((e) => ({ miles: e.miles, createdAt: e.createdAt, expiresAt: e.expiresAt, renews: e.type === "EARN" })),
        now,
        30,
        config.rollingValidityDays,
      );
      if (balance.available <= 0 || !balance.lapsesAt) continue;
      const left = balance.lapsesAt.getTime() - now.getTime();
      if (left > 0 && left <= MILES_REMINDER_LEAD_DAYS * DAY_MS) {
        due.push({ customerId, miles: balance.available, lapsesAt: balance.lapsesAt });
      }
    }

    for (const item of due.slice(0, MAX_PER_RUN)) {
      try {
        const [customer] = await db.select().from(customers).where(eq(customers.id, item.customerId)).limit(1);
        if (!customer) continue;
        const candidates = getBrazilianPhoneVariants(customer.phone).filter((v) => v.startsWith("55"));
        const [session] = candidates.length
          ? await db.select().from(whatsappSessions).where(inArray(whatsappSessions.phone, candidates)).limit(1)
          : [];
        if (session?.marketingOptOutAt) {
          skipped++;
          continue;
        }
        const phone = session?.phone ?? candidates[0];
        if (!phone) {
          skipped++;
          continue;
        }
        const firstName = customer.name.trim().split(/\s+/)[0] || null;
        const text = milesExpiryMessage(firstName, item.miles, item.lapsesAt);
        const inWindow = !!session && now.getTime() - session.lastInteractionAt.getTime() <= WINDOW_MS;
        const template = process.env.WHATSAPP_TEMPLATE_MILES_EXPIRY?.trim();
        if (!inWindow && !template) {
          skipped++;
          continue;
        }

        const key = `miles-expiry:${item.customerId}:${item.lapsesAt.toISOString().slice(0, 10)}`;
        const claimed = await db
          .insert(whatsappMessages)
          .values({ wamid: key, phone, role: "assistant", content: text, mediaType: "text" })
          .onConflictDoNothing({ target: whatsappMessages.wamid })
          .returning({ id: whatsappMessages.id });
        if (claimed.length === 0) continue; // já avisado neste ciclo

        try {
          if (inWindow) await sendTextMessage(phone, text);
          else {
            const date = item.lapsesAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
            await sendTemplateMessage(phone, template!, process.env.WHATSAPP_TEMPLATE_LANG?.trim() || "pt_BR", [
              firstName ?? "cliente",
              item.miles.toLocaleString("pt-BR"),
              date,
            ]);
          }
          sent++;
        } catch (error) {
          await db.delete(whatsappMessages).where(and(eq(whatsappMessages.wamid, key))).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        console.error("[miles] aviso de vencimento falhou:", errorSummary(error));
      }
    }
  }
  return { sent, skipped };
}
