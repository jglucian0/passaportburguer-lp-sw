import { and, eq, gte, like } from "drizzle-orm";

import { db } from "@/infra/db";
import { loadCatalog } from "@/infra/db/queries";
import { whatsappMessages, whatsappSessions } from "@/infra/db/schema";
import { formatCents } from "@/lib/utils";

import type { GeminiFunctionDeclaration } from "./gemini";
import { sendTextMessage } from "./client";
import { cancelUnpaidOrderTool } from "./cancel-order";
import { setDeliveryAndPaymentTool, updateCartTool } from "./draft-flow";
import { escalateForToday, requestHumanHandoff } from "./handoff";
import { stripUrlsAndMarkdownLinks } from "./sanitizer";
import { signWhatsAppToken } from "./session-token";
import { appUrl, getTenantId, GOOGLE_REVIEW_URL, type ToolContext } from "./shared";
import { errorSummary } from "./log";

export { getCustomerContext, type CustomerContext } from "./customer-context";
export { HANDOFF_MINUTES, requestHumanHandoff } from "./handoff";

/* ------------------------------------------------------------------ */
/* 2. Cardápio (pré-carregado, em cache de 5 min)                       */
/* ------------------------------------------------------------------ */

type MenuCategory = {
  name: string;
  products: {
    id: string;
    name: string;
    description: string | null;
    priceCents: number;
    price: string;
    addonGroups: {
      name: string;
      minSelections: number;
      maxSelections: number;
      addons: { id: string; name: string; priceCents: number; price: string; maxQuantity: number }[];
    }[];
  }[];
};

export const MENU_CACHE_MS = 5 * 60_000;
type Menu = Awaited<ReturnType<typeof buildMenu>>;
let menuCache: { at: number; menu: Menu } | null = null;
export function resetMenuCache(): void {
  menuCache = null;
}

/** Cardápio ativo, cacheado em memória por 5 min (o prompt de cada mensagem o carrega). */
export async function getAvailableMenu(now: number = Date.now()): Promise<Menu> {
  if (menuCache && now - menuCache.at < MENU_CACHE_MS) return menuCache.menu;
  const menu = await buildMenu();
  // Cardápio vazio (loja não encontrada / falha) não é cacheado.
  if (menu.categories.length > 0) menuCache = { at: now, menu };
  return menu;
}

async function buildMenu() {
  const tenantId = await getTenantId();
  if (!tenantId) return { categories: [] as MenuCategory[] };
  const catalog = await loadCatalog(tenantId);
  return {
    categories: catalog
      .map((c) => ({
        name: c.name,
        products: c.products
          .filter((p) => p.isAvailable)
          .map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            priceCents: p.priceCents,
            price: formatCents(p.priceCents),
            addonGroups: p.addonGroups
              .map((g) => ({
                name: g.name,
                minSelections: g.minSelections,
                maxSelections: g.maxSelections,
                addons: g.addons
                  .filter((a) => a.isAvailable)
                  .map((a) => ({
                    id: a.id,
                    name: a.name,
                    priceCents: a.priceCents,
                    price: formatCents(a.priceCents),
                    maxQuantity: a.maxQuantity,
                  })),
              }))
              .filter((g) => g.addons.length > 0),
          })),
      }))
      .filter((c) => c.products.length > 0),
  };
}

/* Itens já escolhidos pelo cliente (ex.: no Cardápio Rápido), com nomes e ids reais. */
export async function getDraftCart(phone: string) {
  const tenantId = await getTenantId();
  const [session] = await db.select().from(whatsappSessions).where(eq(whatsappSessions.phone, phone)).limit(1);
  const draft = session?.draftCart;
  if (!tenantId || !draft || draft.length === 0) return { hasDraft: false };

  const products = new Map((await loadCatalog(tenantId)).flatMap((c) => c.products).map((p) => [p.id, p]));
  return {
    hasDraft: true,
    items: draft.map((i) => {
      const product = products.get(i.productId);
      const addonNames = new Map(product?.addonGroups.flatMap((g) => g.addons).map((a) => [a.id, a.name]) ?? []);
      return {
        productId: i.productId,
        name: product?.name ?? "Item indisponível",
        quantity: i.quantity,
        notes: i.notes ?? null,
        addons: (i.addons ?? []).map((a) => ({
          addonId: a.addonId,
          name: addonNames.get(a.addonId) ?? "Adicional",
          quantity: a.quantity,
        })),
      };
    }),
    hasDeliveryAddress: !!session?.deliveryAddress,
  };
}

/* ------------------------------------------------------------------ */
/* 3. generateQuickMenuLink                                            */
/* ------------------------------------------------------------------ */

export function generateQuickMenuLink(phone: string, validMinutes = 30): { url: string } {
  const token = signWhatsAppToken({ phone, purpose: "QUICK_MENU" }, validMinutes);
  return { url: `${appUrl()}/cardapio-rapido?token=${encodeURIComponent(token)}` };
}

/* ------------------------------------------------------------------ */
/* Declarações para o Gemini + despacho                                */
/* ------------------------------------------------------------------ */

/** O telefone NUNCA é parâmetro exposto ao modelo: vem da conversa (evita consultar dados de terceiros). */
export const TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  {
    name: "getDraftCart",
    description: "Itens que o cliente já escolheu (por exemplo, pelo Cardápio Rápido), com ids reais.",
  },
  {
    name: "sendQuickMenu",
    description:
      'Envia o botão "Cardápio Rápido". É o ÚNICO jeito de pedir: use quando o cliente quiser pedir, escolher, ver o cardápio/opções ou citar qualquer item ("quero um México", "manda o cardápio", "quais lanches tem?"). NUNCA em saudação pura. O messageText vira o texto do botão e é a única mensagem do turno.',
    parameters: {
      type: "object",
      properties: {
        messageText: {
          type: "string",
          description:
            'Frase curta, natural e contextualizada com a conversa (ex.: "Claro, João! Abre aqui pra escolher seus lanches e adicionais 👇"). Sem link nem Markdown.',
        },
      },
      required: ["messageText"],
    },
  },
  {
    name: "escalateToHuman",
    description:
      "Use quando o cliente INSISTE em pedir itens pelo chat mesmo depois de você enviar o Cardápio Rápido, ou quando você não entendeu o que ele quer. O bot para de responder esse cliente pelo resto do dia e a equipe é avisada no painel. NÃO escreva nenhum texto ao cliente neste turno.",
    parameters: { type: "object", properties: { reason: { type: "string", description: "Motivo curto para a equipe." } }, required: ["reason"] },
  },
  {
    name: "setDeliveryAndPayment",
    description:
      "Grava entrega/retirada e endereço na sessão. Chame assim que o cliente informar ou confirmar. Entrega com addressConfirmed=true e sem address usa o endereço salvo do cliente cadastrado. Não existe forma de pagamento no chat: quando carrinho + endereço (ou retirada) estiverem prontos o pedido é fechado AUTOMATICAMENTE pelo servidor, que envia o botão para a página de pagamento.",
    parameters: {
      type: "object",
      properties: {
        deliveryType: { type: "string", enum: ["DELIVERY", "PICKUP"] },
        address: {
          type: "object",
          description: "Endereço novo em Maringá-PR. Omita ao usar o endereço salvo.",
          properties: {
            street: { type: "string" },
            number: { type: "string" },
            complement: { type: "string" },
            reference: { type: "string" },
            neighborhood: { type: "string" },
          },
          required: ["street", "number"],
        },
        addressConfirmed: {
          type: "boolean",
          description: "true quando o cliente CONFIRMOU o endereço ('sim', 'no mesmo endereço') ou acabou de informá-lo. Retirada: true.",
        },
        customerName: { type: "string", description: "Só para cliente novo." },
        documentNumber: { type: "string", description: "CPF, SOMENTE se o sistema pedir. Quem tem hasDocument=true nunca informa." },
      },
      required: ["deliveryType", "addressConfirmed"],
    },
  },
  {
    name: "cancelUnpaidOrder",
    description:
      "Cancela o pedido do cliente que AINDA NÃO FOI PAGO (aguardando pagamento) e libera a sessão para um novo pedido; o bot segue ativo. Se o pedido já foi pago ou está em preparo/entrega, passa automaticamente para um atendente humano. O telefone é o da conversa.",
    parameters: {
      type: "object",
      properties: { reason: { type: "string", description: "Motivo do cancelamento, nas palavras do cliente." } },
      required: ["reason"],
    },
  },
  {
    name: "sendReviewRequest",
    description:
      "Use quando o cliente ELOGIAR ou der feedback POSITIVO sobre o hambúrguer, o lanche, a comida ou o atendimento (ex.: 'estava delicioso', 'melhor burger da cidade'). Depois da SUA resposta de agradecimento, o sistema envia sozinho outra mensagem pedindo a avaliação no Google. Escreva só o agradecimento (curto, sem link). Não use em reclamação (use requestHumanHandoff) nem em simples 'obrigado'.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "requestHumanHandoff",
    description:
      "Passa a conversa para um atendente humano (pausa o bot por 30 min). Use em reclamações, problemas com pedido já feito, pedidos fora do comum ou quando o cliente pedir uma pessoa.",
    parameters: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
];

type Args = Record<string, unknown>;

/**
 * Gera o token assinado e arma o botão nativo cta_url. O texto do botão é o `messageText` da IA,
 * higienizado (nunca URL/Markdown); a URL real nunca vai ao texto nem ao modelo.
 */
export function sendQuickMenuTool(
  ctx: ToolContext,
  input: { messageText?: unknown },
): { sent: true; note: string } | { sent: false; error: string } {
  const bodyText = typeof input.messageText === "string" ? stripUrlsAndMarkdownLinks(input.messageText) : "";
  if (!bodyText) {
    return { sent: false, error: "Informe messageText: uma frase curta e natural, sem link, para o corpo do botão." };
  }
  const { url } = generateQuickMenuLink(ctx.phone);
  ctx.cta = { buttonText: "Cardápio Rápido", url, bodyText };
  return { sent: true, note: "O botão com o seu messageText já será enviado. Não escreva outra mensagem." };
}

const REVIEW_MESSAGE = `Se puder, deixa sua avaliação pra gente? Leva só um minutinho e ajuda muito o Passaporte Burguer ✈️\n\n${GOOGLE_REVIEW_URL}`;

/**
 * Elogio do cliente: depois da resposta da IA, sai UMA segunda mensagem (texto do sistema) com o link de avaliação.
 * No máximo uma vez por cliente a cada 30 dias.
 */
export async function sendReviewRequestTool(ctx: ToolContext): Promise<{ queued: boolean; note: string }> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [already] = await db
    .select({ id: whatsappMessages.id })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.phone, ctx.phone),
        eq(whatsappMessages.role, "assistant"),
        gte(whatsappMessages.createdAt, since),
        like(whatsappMessages.content, `%${GOOGLE_REVIEW_URL}%`),
      ),
    )
    .limit(1);
  if (already) return { queued: false, note: "O pedido de avaliação já foi enviado a este cliente. Apenas agradeça." };

  ctx.afterReply.push(async () => {
    await sendTextMessage(ctx.phone, REVIEW_MESSAGE);
    await db
      .insert(whatsappMessages)
      .values({ phone: ctx.phone, role: "assistant", content: REVIEW_MESSAGE, mediaType: "text" })
      .catch(() => undefined);
  });
  return { queued: true, note: "O link de avaliação sai sozinho em outra mensagem. Responda só com o agradecimento, sem link." };
}

/** Executa uma tool no servidor. O fechamento do pedido NÃO é tool: o backend o dispara no fim do turno. */
export async function executeTool(ctx: ToolContext, name: string, args: Args = {}): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case "getDraftCart":
        return { ...(await getDraftCart(ctx.phone)) };
      case "sendQuickMenu":
        return sendQuickMenuTool(ctx, args);
      case "updateCart":
        return { ...(await updateCartTool(ctx, args)) };
      case "escalateToHuman":
        ctx.silent = true;
        await escalateForToday(ctx.phone, String(args.reason ?? ""));
        return { ok: true, note: "Um atendente humano assume. Não escreva nada ao cliente." };
      case "setDeliveryAndPayment":
        return { ...(await setDeliveryAndPaymentTool(ctx, args)) };
      case "cancelUnpaidOrder":
        return { ...(await cancelUnpaidOrderTool({ phone: ctx.phone, reason: String(args.reason ?? "") })) };
      case "sendReviewRequest":
        return { ...(await sendReviewRequestTool(ctx)) };
      case "requestHumanHandoff":
        return { ...(await requestHumanHandoff(ctx.phone, String(args.reason ?? ""))) };
      default:
        return { error: `Ferramenta desconhecida: ${name}` };
    }
  } catch (error) {
    console.error("[whatsapp-bot] falha na ferramenta", name, errorSummary(error));
    return { error: "Falha interna ao executar a ferramenta. Tente de novo ou chame um atendente." };
  }
}
