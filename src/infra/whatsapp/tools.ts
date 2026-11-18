import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/infra/db";
import { loadCatalog } from "@/infra/db/queries";
import {
  customerAddresses,
  customers,
  orderItems,
  orders,
  whatsappMessages,
  whatsappSessions,
} from "@/infra/db/schema";
import { formatCents } from "@/lib/utils";

import { sendTextMessage } from "./client";
import type { GeminiFunctionDeclaration } from "./gemini";
import { finalizeOrderAndCheckout, saveDraftOrder } from "./order-flow";
import { signWhatsAppToken } from "./session-token";
import { getBrazilianPhoneVariants } from "./phone";
import { appUrl, getTenantId, type ToolContext } from "./shared";
import { errorSummary } from "./log";

export const HANDOFF_MINUTES = 30;

/* ------------------------------------------------------------------ */
/* 1. Contexto do cliente (pré-carregado no systemInstruction)           */
/* ------------------------------------------------------------------ */

export type CustomerContext =
  | { isRegistered: false }
  | {
      isRegistered: true;
      name: string;
      firstName: string;
      /** Já tem CPF/CNPJ no cadastro: nunca pedir o documento no chat. (O número não vai ao modelo.) */
      hasDocument: boolean;
      defaultAddress: {
        street: string;
        number: string;
        complement: string | null;
        reference: string | null;
        neighborhood: string | null;
      } | null;
      /** Ex.: "1x Nova York + 1x Batata". Nulo se nunca concluiu um pedido. */
      lastOrderSummary: string | null;
      /** Itens do último pedido (ids reais) para repetir via saveDraftOrder. */
      lastOrderItems: { productId: string | null; name: string; quantity: number; addonIds: string[] }[];
    };

export async function getCustomerContext(phone: string): Promise<CustomerContext> {
  const tenantId = await getTenantId();
  const variants = getBrazilianPhoneVariants(phone);
  if (!tenantId || variants.length === 0) return { isRegistered: false };

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), inArray(customers.phone, variants)))
    .limit(1);
  if (!customer) return { isRegistered: false };

  /* Vincula a sessão ao cliente (best-effort). */
  await db
    .update(whatsappSessions)
    .set({ customerId: customer.id })
    .where(eq(whatsappSessions.phone, phone))
    .catch(() => undefined);

  const [last] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.customerId, customer.id), eq(orders.status, "DELIVERED")))
    .orderBy(desc(orders.createdAt))
    .limit(1);

  let lastOrderItems: Extract<CustomerContext, { isRegistered: true }>["lastOrderItems"] = [];
  if (last) {
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, last.id));
    lastOrderItems = items.map((i) => ({
      productId: i.productId,
      name: i.productNameSnapshot,
      quantity: i.quantity,
      addonIds: (i.addonsSnapshot ?? []).map((a) => a.addon_id).filter((id): id is string => !!id),
    }));
  }

  let defaultAddress: Extract<CustomerContext, { isRegistered: true }>["defaultAddress"] = null;
  const snap = last?.addressSnapshot;
  if (snap) {
    defaultAddress = {
      street: snap.street,
      number: snap.number,
      complement: snap.complement,
      reference: snap.reference,
      neighborhood: snap.district ?? snap.neighborhood,
    };
  } else {
    const [addr] = await db
      .select()
      .from(customerAddresses)
      .where(eq(customerAddresses.customerId, customer.id))
      .limit(1);
    if (addr) {
      defaultAddress = {
        street: addr.street,
        number: addr.number,
        complement: addr.complement,
        reference: addr.reference,
        neighborhood: null,
      };
    }
  }

  return {
    isRegistered: true,
    name: customer.name,
    firstName: customer.name.trim().split(/\s+/)[0] ?? customer.name,
    hasDocument: !!customer.documentNumber,
    defaultAddress,
    lastOrderSummary:
      lastOrderItems.length > 0 ? lastOrderItems.map((i) => `${i.quantity}x ${i.name}`).join(" + ") : null,
    lastOrderItems,
  };
}

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

export function generateQuickMenuLink(phone: string): { url: string } {
  const token = signWhatsAppToken({ phone, purpose: "QUICK_MENU" }, 30);
  return { url: `${appUrl()}/cardapio-rapido?token=${encodeURIComponent(token)}` };
}

/* ------------------------------------------------------------------ */
/* 6. requestHumanHandoff                                              */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Declarações para o Gemini + despacho                                */
/* ------------------------------------------------------------------ */

const itemsSchema = {
  type: "array",
  description: "Itens do pedido. Use SOMENTE ids do CARDÁPIO ATUAL do prompt (ou de getDraftCart).",
  items: {
    type: "object",
    properties: {
      productId: { type: "string", description: "UUID do produto." },
      quantity: { type: "integer" },
      addons: {
        type: "array",
        items: {
          type: "object",
          properties: { addonId: { type: "string" }, quantity: { type: "integer" } },
          required: ["addonId", "quantity"],
        },
      },
      notes: { type: "string", description: 'Observação do item, ex.: "sem cebola", "ponto da carne: ao ponto".' },
    },
    required: ["productId", "quantity"],
  },
};

/** O telefone NUNCA é parâmetro exposto ao modelo: vem da conversa (evita consultar dados de terceiros). */
export const TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  {
    name: "getDraftCart",
    description:
      "Itens que o cliente já escolheu (por exemplo, pelo Cardápio Rápido), com ids reais, para você usar em saveDraftOrder sem remontar o pedido.",
  },
  {
    name: "generateQuickMenuLink",
    description:
      'Gera o link do Cardápio Rápido. O botão "Cardápio Rápido" sai na MESMA mensagem da sua resposta (o texto que você escrever vira o corpo do botão).',
  },
  {
    name: "saveDraftOrder",
    description:
      "Valida e salva o rascunho do pedido. O servidor calcula subtotal, frete e total (você nunca informa preços). Devolve o resumo com os valores oficiais ou o erro a explicar ao cliente.",
    parameters: {
      type: "object",
      properties: {
        items: itemsSchema,
        deliveryType: { type: "string", enum: ["DELIVERY", "PICKUP"] },
        address: {
          type: "object",
          description: "Obrigatório se DELIVERY (Maringá-PR).",
          properties: {
            street: { type: "string" },
            number: { type: "string" },
            complement: { type: "string" },
            reference: { type: "string" },
            neighborhood: { type: "string" },
          },
          required: ["street", "number"],
        },
        customerName: { type: "string" },
        addressConfirmed: {
          type: "boolean",
          description:
            "true quando o cliente CONFIRMOU o endereço de entrega (ex.: 'sim', 'isso mesmo', 'pode mandar') ou acabou de informá-lo. Depois disso nunca pergunte o endereço de novo.",
        },
      },
      required: ["items", "deliveryType", "customerName"],
    },
  },
  {
    name: "finalizeOrderAndCheckout",
    description:
      "Cria o pedido oficial a partir do rascunho salvo e prepara o pagamento. Só chame depois do cliente confirmar o resumo e escolher a forma de pagamento. Pix e cartão: o botão de pagamento sai na mesma mensagem da sua resposta e, no Pix, o código Copia e Cola vai logo depois, sozinho.",
    parameters: {
      type: "object",
      properties: {
        paymentMethod: { type: "string", enum: ["PIX", "CREDIT_CARD", "CARD_ON_DELIVERY", "CASH"] },
        documentNumber: {
          type: "string",
          description:
            "CPF do cliente. SÓ informe se o resultado pedir (needsDocument). Cliente com hasDocument=true já tem CPF salvo: não informe.",
        },
        changeForCents: { type: "integer", description: "Só para CASH: valor da nota para troco, em centavos." },
      },
      required: ["paymentMethod"],
    },
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
 * Executa uma tool no servidor. O resultado devolvido ao modelo nunca inclui o código Pix
 * (ele é enviado por outra via, como mensagem isolada).
 */
export async function executeTool(ctx: ToolContext, name: string, args: Args = {}): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case "getDraftCart":
        return { ...(await getDraftCart(ctx.phone)) };
      case "generateQuickMenuLink": {
        const { url } = generateQuickMenuLink(ctx.phone);
        ctx.cta = { buttonText: "Cardápio Rápido", url };
        return { sent: true, note: "O botão do Cardápio Rápido sai na mesma mensagem da sua resposta: escreva só o convite curto." };
      }
      case "saveDraftOrder":
        return { ...(await saveDraftOrder(ctx, args)) };
      case "finalizeOrderAndCheckout": {
        const result = await finalizeOrderAndCheckout(ctx, args);
        if (!result.ok) return { ...result };
        const { pixPayload, checkoutUrl, ...rest } = result;
        return {
          ...rest,
          ...(pixPayload ? { pixCodeSentSeparately: true } : {}),
          ...(checkoutUrl ? { cardButtonSentSeparately: true } : {}),
        };
      }
      case "requestHumanHandoff":
        return { ...(await requestHumanHandoff(ctx.phone, String(args.reason ?? ""))) };
      default:
        return { error: `Ferramenta desconhecida: ${name}` };
    }
  } catch (error) {
    console.error("[whatsapp-bot] falha na ferramenta", name, errorSummary(error));
    return { error: "Falha interna ao executar a ferramenta. Peça desculpas e tente de novo ou chame um atendente." };
  }
}
