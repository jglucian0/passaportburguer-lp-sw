import { and, desc, eq, gte, inArray } from "drizzle-orm";

import {
  couponCodeFor,
  formatCouponDeadline,
  isWithinSendHours,
  NEW_CUSTOMER_MIN_DAYS,
  pickDiscountPercent,
  secondOrderMessage,
  winbackMessage,
  type MarketingConfig,
} from "@/core/marketing/campaign";
import type { CustomerProfile } from "@/core/marketing/segments";
import { getStoreStatus } from "@/core/store/opening-hours";
import { db } from "@/infra/db";
import { coupons, marketingSends, orders, products, whatsappMessages, whatsappSessions } from "@/infra/db/schema";
import { loadStoreSettings } from "@/infra/db/store-settings";
import { sendCtaUrlButton, sendTemplateMessage } from "@/infra/whatsapp/client";
import { errorSummary } from "@/infra/whatsapp/log";
import { getBrazilianPhoneVariants } from "@/infra/whatsapp/phone";
import { appUrl, getTenantId } from "@/infra/whatsapp/shared";
import { generateQuickMenuLink } from "@/infra/whatsapp/tools";

import { loadCustomerProfiles } from "./profile";
import { loadMarketingConfig } from "./settings";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Janela de atendimento da Meta: texto livre só até 24 h depois da última mensagem do cliente. */
const SERVICE_WINDOW_MS = DAY_MS;
/** Poucos por execução (o cron roda a cada ~5 min): o envio fica espalhado, como uma pessoa faria. */
const MAX_SENDS_PER_RUN = 5;
const MENU_LINK_MINUTES = 6 * 60;

/** Template aprovado na Meta para falar fora das 24 h (plug-and-play: só informar o nome no ambiente). */
export function winbackTemplate(): { name: string; language: string } | null {
  const name = process.env.WHATSAPP_TEMPLATE_WINBACK?.trim();
  if (!name) return null;
  return { name, language: process.env.WHATSAPP_TEMPLATE_LANG?.trim() || "pt_BR" };
}

/** Template do convite ao segundo pedido (mesmas 4 variáveis do resgate; texto próprio). */
export function secondOrderTemplate(): { name: string; language: string } | null {
  const name = process.env.WHATSAPP_TEMPLATE_SECOND_ORDER?.trim();
  if (!name) return null;
  return { name, language: process.env.WHATSAPP_TEMPLATE_LANG?.trim() || "pt_BR" };
}

/** Fotos locais (.webp) viram JPEG pela rota /api/marketing/photo; URLs absolutas só se já forem JPEG/PNG. */
export function photoUrlFor(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  if (imageUrl.startsWith("/")) return `${appUrl()}/api/marketing/photo?p=${encodeURIComponent(imageUrl)}`;
  return /^https:\/\/.+\.(jpe?g|png)(\?.*)?$/i.test(imageUrl) ? imageUrl : null;
}

export type CampaignSummary = {
  ran: boolean;
  reason?: string;
  candidates: number;
  sent: number;
  skipped: number;
  failed: number;
};

type Deps = {
  cta: typeof sendCtaUrlButton;
  template: typeof sendTemplateMessage;
};
const defaultDeps: Deps = { cta: sendCtaUrlButton, template: sendTemplateMessage };

function localHour(now: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(now);
  return Number(hour);
}

function eligibleSegment(profile: CustomerProfile, config: MarketingConfig): boolean {
  if (profile.orderCount < 1) return false;
  // Segundo pedido: só quem tem exatamente um pedido e já passou alguns dias dele.
  if (profile.segment === "NEW") {
    return config.targetNew && profile.orderCount === 1 && (profile.daysSinceLastOrder ?? 0) >= NEW_CUSTOMER_MIN_DAYS;
  }
  return (profile.segment === "AT_RISK" && config.targetAtRisk) || (profile.segment === "LOST" && config.targetLost);
}

/**
 * Campanha de resgate: quem pediu e sumiu (em risco / perdido) recebe um cupom pessoal sorteado
 * dentro da faixa do admin. Só roda com a campanha ligada, a loja aberta e no horário permitido.
 * Respeita: 1 mensagem por cliente a cada `minDaysBetween` dias, opt-out, atendimento humano e a
 * janela de 24 h da Meta (fora dela, só com template aprovado).
 */
export async function runWinbackCampaign(now: Date = new Date(), deps: Deps = defaultDeps): Promise<CampaignSummary> {
  const summary: CampaignSummary = { ran: false, candidates: 0, sent: 0, skipped: 0, failed: 0 };

  const tenantId = await getTenantId();
  if (!tenantId) return { ...summary, reason: "NO_TENANT" };
  const config = await loadMarketingConfig(tenantId);
  if (!config.enabled) return { ...summary, reason: "DISABLED" };
  if (!isWithinSendHours(localHour(now), config)) return { ...summary, reason: "OUTSIDE_SEND_HOURS" };

  const store = await loadStoreSettings(tenantId);
  if (!store) return { ...summary, reason: "NO_STORE" };
  if (!getStoreStatus({ openingHours: store.openingHours, isOpenOverride: store.isOpenOverride, now }).isOpen) {
    return { ...summary, reason: "STORE_CLOSED" };
  }

  const profiles = (await loadCustomerProfiles(tenantId, { now })).filter((p) => eligibleSegment(p, config));
  if (profiles.length === 0) return { ...summary, ran: true, reason: "NO_CANDIDATES" };

  // Limite por cliente: SENT dentro do intervalo mínimo, ou qualquer tentativa nas últimas 24 h.
  const capSince = new Date(now.getTime() - Math.max(config.minDaysBetween, 1) * DAY_MS);
  const recent = await db
    .select({ customerId: marketingSends.customerId, status: marketingSends.status, createdAt: marketingSends.createdAt })
    .from(marketingSends)
    .where(and(eq(marketingSends.tenantId, tenantId), gte(marketingSends.createdAt, capSince)));
  const blocked = new Set<string>();
  for (const r of recent) {
    if (r.status === "SENT" || now.getTime() - r.createdAt.getTime() < DAY_MS) blocked.add(r.customerId);
  }

  // Convite ao segundo pedido: uma vez só por cliente (quem já recebeu não recebe de novo).
  const alreadyInvited = await db
    .select({ customerId: marketingSends.customerId })
    .from(marketingSends)
    .where(and(eq(marketingSends.tenantId, tenantId), eq(marketingSends.segment, "NEW"), eq(marketingSends.status, "SENT")));
  for (const r of alreadyInvited) blocked.add(r.customerId);

  // Pagamento pendente nas últimas 2 h: o cliente está pedindo agora, não incomoda.
  const pending = await db
    .select({ customerId: orders.customerId })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, tenantId),
        eq(orders.status, "AWAITING_PAYMENT"),
        gte(orders.createdAt, new Date(now.getTime() - 2 * 60 * 60_000)),
      ),
    );
  for (const p of pending) blocked.add(p.customerId);

  // Fãs em risco primeiro (prioridade de resgate); depois quem está há mais tempo sem pedir.
  const candidates = profiles
    .filter((p) => !blocked.has(p.customerId))
    .sort((a, b) => Number(b.isFan) - Number(a.isFan) || (b.daysSinceLastOrder ?? 0) - (a.daysSinceLastOrder ?? 0));
  summary.ran = true;
  summary.candidates = candidates.length;

  for (const profile of candidates) {
    if (summary.sent >= MAX_SENDS_PER_RUN) break;
    try {
      const variants = getBrazilianPhoneVariants(profile.phone);
      if (variants.length === 0) continue;

      // Só fala com quem já conversou com a loja no WhatsApp (e nunca com quem pediu para parar / está com humano).
      const [session] = await db
        .select()
        .from(whatsappSessions)
        .where(inArray(whatsappSessions.phone, variants))
        .limit(1);
      if (!session || session.marketingOptOutAt) continue;
      if (session.botPausedUntil && session.botPausedUntil.getTime() > now.getTime()) continue;

      const record = (status: "SENT" | "SKIPPED" | "FAILED", outcome: string, extra: { couponId?: string; discountPercent?: number } = {}) =>
        db.insert(marketingSends).values({
          tenantId,
          customerId: profile.customerId,
          phone: session.phone,
          segment: profile.segment,
          isFan: profile.isFan,
          status,
          outcome,
          sentAt: status === "SENT" ? now : null,
          ...extra,
        });

      const isNew = profile.segment === "NEW";
      const template = isNew ? secondOrderTemplate() : winbackTemplate();
      const [lastUser] = await db
        .select({ createdAt: whatsappMessages.createdAt })
        .from(whatsappMessages)
        .where(and(eq(whatsappMessages.phone, session.phone), eq(whatsappMessages.role, "user")))
        .orderBy(desc(whatsappMessages.createdAt))
        .limit(1);
      const insideWindow = !!lastUser && now.getTime() - lastUser.createdAt.getTime() < SERVICE_WINDOW_MS;

      if (!insideWindow && !template) {
        // Fora das 24 h sem template aprovado: não cria cupom nem envia; tenta de novo em 24 h.
        await record("SKIPPED", "WAITING_TEMPLATE");
        summary.skipped++;
        continue;
      }

      // Cupom pessoal, uso único, com validade curta.
      const percent = pickDiscountPercent(config, profile.isFan);
      const expiresAt = new Date(now.getTime() + config.couponValidHours * 60 * 60_000);
      let couponId: string | null = null;
      let couponCode = "";
      for (let attempt = 0; attempt < 5 && !couponId; attempt++) {
        couponCode = couponCodeFor(profile.isFan, Math.random, isNew ? "SEGUNDO" : undefined);
        try {
          const [row] = await db
            .insert(coupons)
            .values({
              tenantId,
              code: couponCode,
              type: "PERCENT",
              value: percent,
              minOrderCents: config.couponMinOrderCents,
              maxUses: 1,
              isActive: true,
              expiresAt,
              customerId: profile.customerId,
            })
            .returning({ id: coupons.id });
          couponId = row.id;
        } catch (error) {
          const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
          if (code !== "23505") throw error; // código repetido: sorteia outro
        }
      }
      if (!couponId) {
        await record("FAILED", "COUPON_CODE");
        summary.failed++;
        continue;
      }

      const deadline = formatCouponDeadline(expiresAt);
      const favoriteName = profile.favorite?.name ?? null;
      const copy = { firstName: profile.firstName, favoriteName, percent, deadline, isFan: profile.isFan };

      let photo: string | null = null;
      if (profile.favorite?.productId) {
        const [product] = await db
          .select({ imageUrl: products.imageUrl })
          .from(products)
          .where(eq(products.id, profile.favorite.productId))
          .limit(1);
        photo = photoUrlFor(product?.imageUrl);
      }

      try {
        let body: string;
        if (insideWindow) {
          body = (isNew ? secondOrderMessage : winbackMessage)(copy, Math.floor(Math.random() * 2));
          const { url } = generateQuickMenuLink(session.phone, MENU_LINK_MINUTES);
          await deps.cta(session.phone, body, "Ver cardápio", url, photo);
        } else {
          // {{1}} nome, {{2}} lanche, {{3}} desconto, {{4}} validade
          body = (isNew ? secondOrderMessage : winbackMessage)(copy, 0);
          await deps.template(session.phone, template!.name, template!.language, [
            profile.firstName,
            favoriteName ?? "burger",
            `${percent}%`,
            deadline,
          ]);
        }
        await db
          .insert(whatsappMessages)
          .values({ phone: session.phone, role: "assistant", content: body, mediaType: "text" })
          .catch(() => undefined);
        await record("SENT", insideWindow ? "text" : "template", { couponId, discountPercent: percent });
        summary.sent++;
      } catch (error) {
        // Não chegou: o cupom não fica solto por aí.
        console.error("[marketing] falha no envio:", errorSummary(error));
        await db.update(coupons).set({ isActive: false }).where(eq(coupons.id, couponId));
        await record("FAILED", "SEND_FAILED", { couponId, discountPercent: percent });
        summary.failed++;
      }
    } catch (error) {
      console.error("[marketing] falha ao processar cliente:", errorSummary(error));
      summary.failed++;
    }
  }
  return summary;
}
