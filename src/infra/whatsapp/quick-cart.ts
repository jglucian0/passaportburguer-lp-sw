import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { cartItemInputSchema } from "@/core/schemas/cart";
import { db } from "@/infra/db";
import { whatsappMessages, whatsappSessions, type WhatsAppDraftCartItem } from "@/infra/db/schema";
import { checkRateLimit } from "@/infra/security/rate-limit";
import { formatCents } from "@/lib/utils";

import { finalizeOrderAndCheckout, priceCart } from "./order-flow";
import { checkoutInputSchema, prepareCheckout, saveCheckoutSession } from "./quick-checkout";
import { verifyWhatsAppToken } from "./session-token";
import { getTenantId, type ToolContext } from "./shared";
import { errorSummary } from "./log";

const bodySchema = z.object({
  token: z.string().min(10).max(2000),
  /** Atalho "Repetir pedido" (QUICK_CHECKOUT): sem itens, usa o rascunho já salvo na sessão. */
  items: z
    .array(cartItemInputSchema.extend({ notes: z.string().trim().max(140).nullish() }))
    .max(30)
    .optional(),
  checkout: checkoutInputSchema,
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

/**
 * Fim do Cardápio Rápido: valida itens e dados do cliente, cria a conta (se nova), fecha o pedido AGORA no servidor
 * e devolve o link da página de pagamento. A confirmação do pedido é a própria página de pagamento; o bot não escreve nada.
 */
export async function submitQuickCart(raw: unknown): Promise<QuickCartResult> {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 400, body: { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." } };
  }
  const { token, items: rawItems, checkout } = parsed.data;

  const claims = verifyWhatsAppToken(token);
  if (!claims || (claims.purpose !== "QUICK_MENU" && claims.purpose !== "QUICK_CHECKOUT")) {
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
  let items: WhatsAppDraftCartItem[];
  if (claims.purpose === "QUICK_CHECKOUT") {
    const [session] = await db.select().from(whatsappSessions).where(eq(whatsappSessions.phone, phone)).limit(1);
    items = session?.draftCart ?? [];
    if (items.length === 0) {
      return { status: 422, body: { ok: false, error: "Seu pedido não está mais salvo. Peça um novo no WhatsApp." } };
    }
  } else {
    if (!rawItems || rawItems.length === 0) return { status: 400, body: { ok: false, error: "Sacola vazia." } };
    items = rawItems.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      notes: i.notes ?? null,
      addons: i.addons.map((a) => ({ addonId: a.addonId, quantity: a.quantity })),
    }));
  }

  const itemsPriced = await priceCart(tenantId, items, "PICKUP", null, null);
  if (!itemsPriced.ok) return { status: 422, body: { ok: false, error: itemsPriced.error } };

  /* Conta, endereço, loja aberta, área e mínimo: tudo validado ANTES de gravar qualquer coisa. */
  const prepared = await prepareCheckout(tenantId, phone, items, checkout);
  if (!prepared.ok) return { status: prepared.status, body: { ok: false, error: prepared.error } };

  /* Uso único: o claim é um insert com wamid unique; só depois de validar, para erros não queimarem o link. */
  const claimKey = quickMenuClaimKey(token);
  const itemsText = describeItems(itemsPriced.calc.lines, items.map((i) => i.notes));
  const claimed = await db
    .insert(whatsappMessages)
    .values({
      wamid: claimKey,
      phone,
      role: "user",
      content: `[Cliente montou o pedido no Cardápio Rápido e foi para o pagamento]
${itemsText}
Subtotal: ${formatCents(itemsPriced.calc.subtotalCents)}`,
      mediaType: "interactive",
    })
    .onConflictDoNothing({ target: whatsappMessages.wamid })
    .returning({ id: whatsappMessages.id });
  if (claimed.length === 0) {
    return { status: 409, body: { ok: false, error: "Esse link já foi usado. Peça um novo no WhatsApp." } };
  }
  const release = () => db.delete(whatsappMessages).where(eq(whatsappMessages.wamid, claimKey)).catch(() => undefined);

  try {
    const saved = await saveCheckoutSession(tenantId, phone, items, prepared);
    if (!saved.ok) {
      await release();
      return { status: saved.status, body: { ok: false, error: saved.error } };
    }
    const ctx: ToolContext = { phone, afterReply: [], cta: null };
    const order = await finalizeOrderAndCheckout(ctx, {
      ...(checkout.paymentMethod ? { paymentMethod: checkout.paymentMethod } : {}),
      allowOffline: true,
      ...(checkout.changeForCents ? { changeForCents: checkout.changeForCents } : {}),
      extraNotes:
        [
          checkout.dineIn ? "CONSUMIR NO LOCAL (salão)." : "",
          checkout.paymentMethod === "CARD_ON_DELIVERY"
            ? `Pagamento: cartão de ${checkout.onsiteCard === "DEBIT" ? "DÉBITO" : "CRÉDITO"} na máquina.`
            : "",
          checkout.notes ?? "",
        ]
          .filter(Boolean)
          .join("\n") || undefined,
    });
    if (order.ok && order.offline) {
      const number = businessWhatsAppNumber();
      return {
        status: 200,
        body: { ok: true, offline: true, orderNumber: order.orderNumber, whatsappUrl: number ? `https://wa.me/${number}` : null },
      };
    }
    if (!order.ok || !order.checkoutUrl) {
      await release();
      return { status: 422, body: { ok: false, error: order.ok ? "Não foi possível abrir o pagamento." : order.error } };
    }
    return { status: 200, body: { ok: true, redirectUrl: order.checkoutUrl, orderNumber: order.orderNumber } };
  } catch (error) {
    await release();
    console.error("[quick-menu] falha ao fechar o pedido:", errorSummary(error));
    return { status: 500, body: { ok: false, error: "Não foi possível fechar seu pedido. Tente de novo." } };
  }
}
