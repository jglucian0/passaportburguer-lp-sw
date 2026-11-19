import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { cartItemInputSchema } from "@/core/schemas/cart";
import { db } from "@/infra/db";
import {
  whatsappMessages,
  whatsappSessions,
  type WhatsAppDraftCartItem,
} from "@/infra/db/schema";
import { checkRateLimit } from "@/infra/security/rate-limit";
import { formatCents } from "@/lib/utils";

import { sendTextMessage } from "./client";
import { priceCart } from "./order-flow";
import { verifyWhatsAppToken } from "./session-token";
import { getTenantId } from "./shared";
import { getCustomerContext } from "./tools";
import { errorSummary } from "./log";

const bodySchema = z.object({
  token: z.string().min(10).max(2000),
  items: z
    .array(cartItemInputSchema.extend({ notes: z.string().trim().max(140).nullish() }))
    .min(1, "Sacola vazia.")
    .max(30),
});

export type QuickCartResult = { status: number; body: Record<string, unknown> };

/** Marca de uso único do link: vira o `wamid` (unique) da ação do cliente no histórico. */
export function quickMenuClaimKey(token: string): string {
  return `qm:${createHash("sha256").update(token).digest("hex")}`;
}

/** Número do WhatsApp do negócio (só dígitos) para o wa.me. */
export function businessWhatsAppNumber(): string | null {
  const n = (process.env.WHATSAPP_BUSINESS_NUMBER || process.env.STORE_WHATSAPP || "").replace(/\D/g, "");
  return n || null;
}

function describeItems(
  lines: { quantity: number; productName: string; addons: { name: string; quantity: number }[] }[],
  notes: (string | null | undefined)[],
): string {
  return lines
    .map((l, i) => {
      const addons = l.addons.length
        ? ` (+ ${l.addons.map((a) => `${a.quantity > 1 ? `${a.quantity}x ` : ""}${a.name}`).join(", ")})`
        : "";
      const note = notes[i] ? ` — obs: ${notes[i]}` : "";
      return `• ${l.quantity}x ${l.productName}${addons}${note}`;
    })
    .join("\n");
}

export async function submitQuickCart(raw: unknown): Promise<QuickCartResult> {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 400, body: { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." } };
  }
  const { token, items: rawItems } = parsed.data;

  const claims = verifyWhatsAppToken(token);
  if (!claims || claims.purpose !== "QUICK_MENU") {
    return { status: 401, body: { ok: false, error: "Link inválido ou expirado. Peça um novo no WhatsApp." } };
  }
  const phone = claims.phone;

  const limit = await checkRateLimit({ identifier: phone, route: "quick-cart", limit: 10, windowSeconds: 600 });
  if (!limit.allowed) {
    return { status: 429, body: { ok: false, error: "Muitas tentativas. Aguarde alguns minutos." } };
  }

  const tenantId = await getTenantId();
  if (!tenantId) return { status: 500, body: { ok: false, error: "Loja não encontrada." } };

  /* Preço, adicionais e disponibilidade vêm 100% do banco; o cliente só diz "o quê" e "quantos". */
  const items: WhatsAppDraftCartItem[] = rawItems.map((i) => ({
    productId: i.productId,
    quantity: i.quantity,
    notes: i.notes ?? null,
    addons: i.addons.map((a) => ({ addonId: a.addonId, quantity: a.quantity })),
  }));
  const priced = await priceCart(tenantId, items, "PICKUP", null, null);
  if (!priced.ok) return { status: 422, body: { ok: false, error: priced.error } };
  const { calc } = priced;

  /* Uso único: o claim é um insert com wamid unique; só depois de validar, para erros não queimarem o link. */
  const claimKey = quickMenuClaimKey(token);
  const itemsText = describeItems(calc.lines, items.map((i) => i.notes));
  const claimed = await db
    .insert(whatsappMessages)
    .values({
      wamid: claimKey,
      phone,
      role: "user",
      content: `[Cliente montou o pedido no Cardápio Rápido]\n${itemsText}\nSubtotal: ${formatCents(calc.subtotalCents)}`,
      mediaType: "interactive",
    })
    .onConflictDoNothing({ target: whatsappMessages.wamid })
    .returning({ id: whatsappMessages.id });
  if (claimed.length === 0) {
    return { status: 409, body: { ok: false, error: "Esse link já foi usado. Peça um novo no WhatsApp." } };
  }

  let paused = false;
  try {
    const [session] = await db
      .insert(whatsappSessions)
      .values({ phone, state: "CONFIRMING_ORDER", draftCart: items })
      .onConflictDoUpdate({
        target: whatsappSessions.phone,
        set: {
          state: "CONFIRMING_ORDER",
          draftCart: items,
          lastInteractionAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning({ botPausedUntil: whatsappSessions.botPausedUntil });
    paused = !!session?.botPausedUntil && session.botPausedUntil.getTime() > Date.now();
  } catch (error) {
    await db.delete(whatsappMessages).where(eq(whatsappMessages.wamid, claimKey)).catch(() => undefined);
    console.error("[quick-menu] falha ao salvar rascunho:", errorSummary(error));
    return { status: 500, body: { ok: false, error: "Não foi possível salvar seus itens. Tente de novo." } };
  }

  /* Mensagem ativa no WhatsApp (best-effort: o rascunho já está salvo). Atendimento humano pausou o bot => silêncio. */
  if (!paused) {
    try {
      const ctx = await getCustomerContext(phone);
      const summary = `Anotei seus itens!

${itemsText}

Subtotal: *${formatCents(calc.subtotalCents)}* (+ taxa, se for entrega)`;
      const next = ctx.isRegistered
        ? ctx.defaultAddress
          ? `Entrego em *${ctx.defaultAddress.street}, ${ctx.defaultAddress.number}* ou você vai retirar?`
          : "É para entrega ou você vai retirar?"
        : "Me diz seu nome e se é entrega (com rua e número) ou retirada.";
      // Duas mensagens curtas em vez de um textão.
      for (const text of [summary, next]) {
        await sendTextMessage(phone, text);
        await db
          .insert(whatsappMessages)
          .values({ phone, role: "assistant", content: text, mediaType: "text" })
          .catch(() => undefined);
      }
    } catch (error) {
      console.error("[quick-menu] falha ao enviar confirmação:", errorSummary(error));
    }
  }

  const number = businessWhatsAppNumber();
  return {
    status: 200,
    body: { ok: true, redirectUrl: number ? `https://wa.me/${number}` : "https://wa.me/" },
  };
}
