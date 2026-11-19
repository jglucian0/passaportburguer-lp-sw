import { beforeEach, describe, expect, it, vi } from "vitest";

/* ---------- Banco falso: cada tabela devolve as linhas programadas ---------- */
const h = vi.hoisted(() => ({
  rows: new Map<unknown, unknown[]>(),
  writes: [] as { op: string; table: unknown; values?: unknown; set?: unknown }[],
}));

vi.mock("@/infra/db", () => {
  const chain = (op: string, table?: unknown) => {
    const entry: { op: string; table: unknown; values?: unknown; set?: unknown } = { op, table };
    const api: Record<string, unknown> = {};
    for (const m of ["where", "orderBy", "limit", "onConflictDoNothing", "onConflictDoUpdate", "returning"]) {
      api[m] = () => api;
    }
    api.from = (t: unknown) => {
      entry.table = t;
      return api;
    };
    api.values = (v: unknown) => {
      entry.values = v;
      return api;
    };
    api.set = (v: unknown) => {
      entry.set = v;
      return api;
    };
    api.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      if (op !== "select") h.writes.push(entry);
      return Promise.resolve(h.rows.get(entry.table) ?? []).then(resolve, reject);
    };
    // Os query builders do drizzle são promises completas (inclui .catch).
    api.catch = (reject: (e: unknown) => unknown) => (api.then as (a: unknown, b: unknown) => Promise<unknown>)(undefined, reject);
    return api;
  };
  return {
    db: {
      select: () => chain("select"),
      insert: (t: unknown) => chain("insert", t),
      update: (t: unknown) => chain("update", t),
      batch: async () => [],
    },
  };
});

const catalog = vi.hoisted(() => ({ value: [] as unknown[] }));
const catalogLoads = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/infra/db/queries", () => ({
  loadCatalog: async () => {
    catalogLoads.n++;
    return catalog.value;
  },
  loadDeliveryZones: async () => [
    { id: "z1", neighborhood: "Demais bairros de Maringá", feeCents: 0, estimatedMinutes: 40, isActive: true },
  ],
}));
vi.mock("@/infra/db/store-settings", () => ({
  loadStoreSettings: async () => ({
    isOpenOverride: true,
    autoAcceptOrders: false,
    estimatedDeliveryMinutes: 40,
    openingHours: {},
    address: null,
    deliveryRules: {},
  }),
}));
vi.mock("@/infra/db/timeline", () => ({ recordTimelineEvent: async () => undefined }));
vi.mock("@/lib/saipos", () => ({ sendOrderToSaipos: vi.fn().mockResolvedValue(undefined) }));
const pix = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/infra/payments/asaas", () => ({ createPixCharge: pix.fn }));
vi.mock("./geocode", () => ({
  // Perto da loja (Zona 07) => faixa 1 do frete.
  geocodeAddress: async () => ({ lat: -23.42, lon: -51.94, city: "Maringá", neighborhood: "Zona 07", postalCode: null }),
}));
const wa = vi.hoisted(() => ({ cta: vi.fn().mockResolvedValue({}), text: vi.fn().mockResolvedValue({}) }));
vi.mock("./client", () => ({
  sendTemplateMessage: vi.fn(),
  sendInteractiveButtons: vi.fn(),
  sendCtaUrlButton: wa.cta,
  sendTextMessage: wa.text,
  downloadMedia: vi.fn(),
}));

import { customers, orderItems, orders, tenants, whatsappMessages, whatsappSessions } from "@/infra/db/schema";

import { buildUserParts, runBotTurn, type AgentDeps } from "./agent";
import { finalizeOrderAndCheckout } from "./order-flow";
import { verifyWhatsAppToken } from "./session-token";
import type { GeminiContent, GeminiRequest } from "./gemini";
import type { ToolContext } from "./shared";
import { executeTool, getAvailableMenu, getCustomerContext, resetMenuCache, TOOL_DECLARATIONS } from "./tools";
import { checkoutUrl } from "./shared";
import type { InboundMessage } from "./webhook";

const PHONE = "5543999999999";
const BURGER = "11111111-1111-4111-8111-111111111111";
const BACON = "22222222-2222-4222-8222-222222222222";

const msg = (over: Partial<InboundMessage> = {}): InboundMessage => ({
  wamid: "w1",
  phone: PHONE,
  mediaType: "text",
  content: "oi",
  raw: {},
  ...over,
});

const ctx = (): ToolContext => ({ phone: PHONE, afterReply: [], cta: null });

beforeEach(() => {
  process.env.WHATSAPP_SESSION_SECRET = "test-secret-with-enough-length";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
  h.rows.clear();
  h.writes.length = 0;
  wa.cta.mockClear();
  resetMenuCache();
  catalogLoads.n = 0;
  wa.text.mockReset().mockResolvedValue({});
  pix.fn.mockReset();
  h.rows.set(tenants, [{ id: "t1", minOrderCents: 0 }]);
  catalog.value = [
    {
      id: "c1",
      name: "Burgers",
      products: [
        {
          id: BURGER,
          name: "Nova York",
          description: null,
          priceCents: 3500,
          isAvailable: true,
          addonGroups: [
            {
              id: "g1",
              name: "Extras",
              minSelections: 0,
              maxSelections: 2,
              addons: [{ id: BACON, name: "Bacon", priceCents: 500, maxQuantity: 2, isAvailable: true }],
            },
          ],
        },
      ],
    },
  ];
});

/* ---------------------------------------------------------------------- */

describe("tools: Cliente Novo vs Cadastrado", () => {
  it("novo: { isRegistered: false }", async () => {
    h.rows.set(customers, []);
    expect(await getCustomerContext(PHONE)).toEqual({ isRegistered: false });
  });

  it("cadastrado: nome, endereço e resumo do último pedido concluído", async () => {
    h.rows.set(customers, [{ id: "c1", name: "João da Silva", phone: "43999999999" }]);
    h.rows.set(orders, [
      {
        id: "o1",
        addressSnapshot: { street: "Rua A", number: "10", complement: null, reference: null, neighborhood: "Zona 07", district: "Zona 07" },
      },
    ]);
    h.rows.set(orderItems, [
      { productId: BURGER, productNameSnapshot: "Nova York", quantity: 1, addonsSnapshot: [] },
      { productId: null, productNameSnapshot: "Batata", quantity: 1, addonsSnapshot: [] },
    ]);
    const out = await getCustomerContext(PHONE);
    expect(out).toMatchObject({
      isRegistered: true,
      firstName: "João",
      lastOrderSummary: "1x Nova York + 1x Batata",
      defaultAddress: { street: "Rua A", number: "10", neighborhood: "Zona 07" },
    });
  });

  it("cliente com CPF: o contexto marca hasDocument (sem expor o CPF)", async () => {
    h.rows.set(customers, [{ id: "c1", name: "João", phone: "43996098333", documentNumber: "52998224725" }]);
    const out = await getCustomerContext("554396098333");
    expect(out).toMatchObject({ isRegistered: true, hasDocument: true });
    expect(JSON.stringify(out)).not.toContain("52998224725");
  });

  it("getCustomerContext e getAvailableMenu NÃO são mais tools (vão no systemInstruction)", async () => {
    const names = TOOL_DECLARATIONS.map((t) => t.name);
    expect(names).not.toContain("getCustomerContext");
    expect(names).not.toContain("getAvailableMenu");
    expect(await executeTool(ctx(), "getCustomerContext")).toMatchObject({ error: expect.stringContaining("desconhecida") });
  });

  it("menu: só disponíveis, com ids e centavos exatos", async () => {
    const out = await getAvailableMenu();
    expect(out.categories[0].products[0].priceCents).toBe(3500);
  });

  it("menu em cache por 5 minutos (não relê o catálogo a cada mensagem)", async () => {
    await getAvailableMenu();
    await getAvailableMenu();
    expect(catalogLoads.n).toBe(1);
    await getAvailableMenu(Date.now() + 5 * 60_000 + 1000);
    expect(catalogLoads.n).toBe(2);
  });

  it("link do Cardápio Rápido: token assinado, sem telefone puro; o texto do botão vem da IA (messageText) sem URL", async () => {
    const c = ctx();
    const out = (await executeTool(c, "sendQuickMenu", {
      messageText: "Claro, João! Abre aqui pra escolher 👇 [cardápio](https://x.com/y) www.site.com",
    })) as { sent: boolean };
    expect(out.sent).toBe(true);
    expect(JSON.stringify(out)).not.toContain("http"); // o modelo nunca vê a URL
    expect(c.afterReply).toHaveLength(0); // nada de mensagem extra depois
    expect(c.cta?.buttonText).toBe("Cardápio Rápido");
    expect(c.cta?.bodyText).toBe("Claro, João! Abre aqui pra escolher 👇 cardápio");
    expect(c.cta?.bodyText).not.toMatch(/https?:|www\.|\]\(/);
    expect(c.cta?.url).toMatch(/^https:\/\/app\.test\/cardapio-rapido\?token=/);
    expect(c.cta?.url).not.toContain(PHONE);
  });

  it("sendQuickMenu sem messageText (ou só com link) é recusado: sem botão e sem texto fixo", async () => {
    for (const args of [{}, { messageText: "   " }, { messageText: "https://app.menu-rapido.com/abc" }]) {
      const c = ctx();
      const out = (await executeTool(c, "sendQuickMenu", args)) as { sent: boolean; error?: string };
      expect(out.sent).toBe(false);
      expect(out.error).toMatch(/messageText/);
      expect(c.cta).toBeNull();
    }
  });

  it("declaração do tool: messageText obrigatório; só para quem pede cardápio/opções", () => {
    const decl = TOOL_DECLARATIONS.find((t) => t.name === "sendQuickMenu")!;
    expect(decl.parameters?.required).toEqual(["messageText"]);
    expect(decl.description).toMatch(/ÚNICO jeito de pedir/i);
  });
});

describe("updateCart (carrinho validado no servidor)", () => {
  const cartArgs = (over: Record<string, unknown> = {}) => ({
    items: [{ productId: BURGER, quantity: 2, addons: [{ addonId: BACON, quantity: 1 }], notes: "sem cebola" }],
    ...over,
  });

  it("calcula o subtotal em centavos no servidor (ignora preços enviados) e sobrescreve o draftCart", async () => {
    const out = (await executeTool(ctx(), "updateCart", { ...cartArgs(), subtotalCents: 1, totalCents: 1 })) as Record<string, unknown>;
    expect(out).toMatchObject({ ok: true, subtotalCents: 8000, nextStep: "DELIVERY" }); // 2 x (3500 + 500)
    const saved = h.writes.find((w) => w.table === whatsappSessions);
    expect((saved?.values as { draftCart: unknown[] }).draftCart).toEqual([
      { productId: BURGER, quantity: 2, notes: "sem cebola", addons: [{ addonId: BACON, quantity: 1 }] },
    ]);
  });

  it("rejeita produto e adicional inexistentes (nunca inventa item)", async () => {
    const bad = "33333333-3333-4333-8333-333333333333";
    const a = (await executeTool(ctx(), "updateCart", { items: [{ productId: bad, quantity: 1 }] })) as { ok: boolean };
    const b = (await executeTool(
      ctx(),
      "updateCart",
      { items: [{ productId: BURGER, quantity: 1, addons: [{ addonId: bad, quantity: 1 }] }] },
    )) as { ok: boolean };
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(h.writes.find((w) => w.table === whatsappSessions)).toBeUndefined();
  });

  it("observação geral vale para os itens sem observação própria", async () => {
    await executeTool(ctx(), "updateCart", {
      items: [
        { productId: BURGER, quantity: 1 },
        { productId: BURGER, quantity: 1, notes: "ao ponto" },
      ],
      notes: "troco para 50",
    });
    const saved = h.writes.find((w) => w.table === whatsappSessions);
    expect((saved?.values as { draftCart: { notes: string }[] }).draftCart.map((i) => i.notes)).toEqual(["troco para 50", "ao ponto"]);
  });

  it("carrinho vazio é recusado", async () => {
    expect(await executeTool(ctx(), "updateCart", { items: [] })).toMatchObject({ ok: false });
  });
});

describe("setDeliveryAndPayment (estado explícito na sessão)", () => {
  const savedWrite = () => h.writes.find((w) => w.op === "insert" && w.table === whatsappSessions);
  const cartRow = (over: Record<string, unknown> = {}) => ({
    phone: PHONE,
    customerId: "cu1",
    draftCart: [{ productId: BURGER, quantity: 1, addons: [] }],
    deliveryAddress: null,
    addressConfirmed: false,
    paymentMethod: null,
    ...over,
  });

  it("endereço novo confirmado + pagamento: grava endereço, addressConfirmed e paymentMethod e devolve o total oficial", async () => {
    h.rows.set(customers, [{ id: "cu1", name: "Maria", phone: "43999999999" }]);
    h.rows.set(whatsappSessions, [cartRow()]);
    const out = (await executeTool(ctx(), "setDeliveryAndPayment", {
      deliveryType: "DELIVERY",
      address: { street: "Rua A", number: "10" },
      addressConfirmed: true,
      paymentMethod: "PIX",
    })) as { ok: boolean; nextStep: string; pricing: { subtotalCents: number; totalFormatted: string } };
    expect(out).toMatchObject({ ok: true, nextStep: "CHECKOUT", pricing: { subtotalCents: 3500 } });
    expect(savedWrite()?.values).toMatchObject({ addressConfirmed: true, paymentMethod: "PIX" });
    expect((savedWrite()?.values as { deliveryAddress: { street: string } }).deliveryAddress.street).toBe("Rua A");
  });

  it("cliente cadastrado confirma o endereço salvo: usa customer.defaultAddress sem o modelo informar o endereço", async () => {
    h.rows.set(customers, [{ id: "cu1", name: "João", phone: "43999999999" }]);
    h.rows.set(orders, [
      { id: "o1", addressSnapshot: { street: "Rua Salva", number: "77", complement: null, reference: null, neighborhood: "Zona 07", district: "Zona 07" } },
    ]);
    h.rows.set(whatsappSessions, [cartRow()]);
    const out = await executeTool(ctx(), "setDeliveryAndPayment", { deliveryType: "DELIVERY", addressConfirmed: true });
    expect(out).toMatchObject({ ok: true, nextStep: "PAYMENT" });
    expect((savedWrite()?.values as { deliveryAddress: { street: string; number: string } }).deliveryAddress).toMatchObject({
      street: "Rua Salva",
      number: "77",
    });
  });

  it("retirada: sem endereço, já resolvida (addressConfirmed true)", async () => {
    h.rows.set(customers, [{ id: "cu1", name: "Maria", phone: "43999999999" }]);
    h.rows.set(whatsappSessions, [cartRow()]);
    const out = await executeTool(ctx(), "setDeliveryAndPayment", { deliveryType: "PICKUP", addressConfirmed: false, paymentMethod: "CASH" });
    expect(out).toMatchObject({ ok: true, deliveryType: "PICKUP", addressConfirmed: true, nextStep: "CHECKOUT" });
    expect(savedWrite()?.values).toMatchObject({ deliveryAddress: null, addressConfirmed: true, paymentMethod: "CASH" });
  });

  it("entrega sem endereço (e sem endereço salvo) é recusada", async () => {
    h.rows.set(customers, [{ id: "cu1", name: "Maria", phone: "43999999999" }]);
    h.rows.set(whatsappSessions, [cartRow()]);
    const out = await executeTool(ctx(), "setDeliveryAndPayment", { deliveryType: "DELIVERY", addressConfirmed: true });
    expect(out).toMatchObject({ ok: false });
    expect(savedWrite()).toBeUndefined();
  });

  it("cliente novo sem nome: pede o nome e não grava nada", async () => {
    h.rows.set(customers, []);
    const out = (await executeTool(ctx(), "setDeliveryAndPayment", { deliveryType: "PICKUP", addressConfirmed: true })) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/nome/i);
  });

  it("CPF informado é validado e salvo no cadastro", async () => {
    h.rows.set(customers, [{ id: "cu1", name: "Maria", phone: "43999999999" }]);
    h.rows.set(whatsappSessions, [cartRow()]);
    const bad = await executeTool(ctx(), "setDeliveryAndPayment", { deliveryType: "PICKUP", addressConfirmed: true, documentNumber: "111" });
    expect(bad).toMatchObject({ ok: false });
    await executeTool(ctx(), "setDeliveryAndPayment", { deliveryType: "PICKUP", addressConfirmed: true, documentNumber: "529.982.247-25" });
    expect(h.writes.find((w) => w.op === "update" && w.table === customers)?.set).toMatchObject({ documentNumber: "52998224725" });
  });
});

describe("finalizeOrderAndCheckout (disparado só pelo backend)", () => {
  it("o fechamento NÃO é tool do modelo", () => {
    const names = TOOL_DECLARATIONS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["updateCart", "setDeliveryAndPayment", "sendQuickMenu"]));
    expect(names).not.toContain("finalizeOrderAndCheckout");
    expect(names).not.toContain("saveDraftOrder");
  });

  const sessionWithDraft = (over: Record<string, unknown> = {}) => {
    h.rows.set(whatsappSessions, [
      {
        phone: PHONE,
        customerId: "cu1",
        draftCart: [{ productId: BURGER, quantity: 1, addons: [] }],
        deliveryAddress: null, // retirada
        addressConfirmed: true,
        paymentMethod: null,
        ...over,
      },
    ]);
    h.rows.set(customers, [{ id: "cu1", name: "Maria", phone: "43999999999", email: null, asaasCustomerId: null }]);
  };

  it("Pix: SEM botão e SEM link de pagamento; só o código Pix, sozinho, na 2ª mensagem", async () => {
    sessionWithDraft();
    pix.fn.mockResolvedValue({ pixPayload: "00020126PIXCODE" });
    const c = ctx();
    const out = await finalizeOrderAndCheckout(c, { paymentMethod: "PIX", documentNumber: "52998224725" });
    expect(out).toMatchObject({ ok: true, paymentMethod: "PIX", deliveryType: "PICKUP" });
    expect(JSON.stringify(out)).not.toMatch(/https?:|pagamento/);
    expect(c.cta).toBeNull(); // nenhum botão ("Abrir pagamento"/"Abrir link de pagamento") nem URL
    expect(c.afterReply).toHaveLength(1);
    await c.afterReply[0]();
    expect(wa.text).toHaveBeenCalledWith(PHONE, "00020126PIXCODE");
  });

  it("ao finalizar, isola a sessão: sessionStartedAt novo, carrinho vazio, endereço/pagamento limpos, IDLE", async () => {
    sessionWithDraft();
    pix.fn.mockResolvedValue({ pixPayload: "PIX" });
    const before = Date.now();
    await finalizeOrderAndCheckout(ctx(), { paymentMethod: "PIX", documentNumber: "52998224725" });
    const claim = h.writes.find((w) => w.op === "update" && w.table === whatsappSessions && "draftCart" in (w.set as object));
    expect(claim?.set).toMatchObject({ draftCart: [], addressConfirmed: false, paymentMethod: null, state: "IDLE" });
    expect((claim?.set as { sessionStartedAt: Date }).sessionStartedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("usa o paymentMethod gravado na sessão quando não vem argumento", async () => {
    sessionWithDraft({ paymentMethod: "CASH" });
    const out = await finalizeOrderAndCheckout(ctx(), {});
    expect(out).toMatchObject({ ok: true, paymentMethod: "CASH" });
  });

  it("sem forma de pagamento não cria pedido", async () => {
    sessionWithDraft();
    expect(await finalizeOrderAndCheckout(ctx(), {})).toMatchObject({ ok: false });
  });

  it("Pix sem CPF (cliente sem Asaas) pede o documento e não cria pedido", async () => {
    sessionWithDraft();
    const out = await finalizeOrderAndCheckout(ctx(), { paymentMethod: "PIX" });
    expect(out).toMatchObject({ ok: false, needsDocument: true });
    expect(pix.fn).not.toHaveBeenCalled();
  });

  it("Cartão: botão 'Pagar com Cartão' para /pedido/{id}/pagamento?token=... (token ORDER_PAYMENT de 2 h)", async () => {
    sessionWithDraft();
    const c = ctx();
    const out = await finalizeOrderAndCheckout(c, { paymentMethod: "CREDIT_CARD", documentNumber: "52998224725" });
    expect(out).toMatchObject({ ok: true });
    expect(c.cta?.buttonText).toBe("Pagar com Cartão");
    const m = c.cta?.url.match(/^https:\/\/app\.test\/pedido\/([0-9a-f-]{36})\/pagamento\?token=([^&]+)$/);
    expect(m).not.toBeNull();
    expect(verifyWhatsAppToken(decodeURIComponent(m![2]))).toEqual({ phone: PHONE, purpose: "ORDER_PAYMENT", orderId: m![1] });
    expect(c.cta?.appendUrlToBody).toBeFalsy();
  });

  it("URL de checkout: sem NEXT_PUBLIC_APP_URL usa o domínio canônico; barra final e esquema ausente são normalizados; sempre com token", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const want = `https://www.passaporteburguer.com.br/pedido/${id}/pagamento?token=`;
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(checkoutUrl(id, PHONE).startsWith(want)).toBe(true);
    process.env.NEXT_PUBLIC_APP_URL = "https://www.passaporteburguer.com.br/";
    expect(checkoutUrl(id, PHONE).startsWith(want)).toBe(true);
    process.env.NEXT_PUBLIC_APP_URL = "www.passaporteburguer.com.br";
    expect(checkoutUrl(id, PHONE).startsWith(want)).toBe(true);
    expect(checkoutUrl(id, PHONE)).not.toContain("undefined");
  });

  it("cliente já cadastrado com CPF: Pix usa o CPF salvo, sem pedir documento", async () => {
    sessionWithDraft();
    h.rows.set(customers, [
      { id: "cu1", name: "Maria", phone: "43996098333", email: null, asaasCustomerId: null, documentNumber: "52998224725" },
    ]);
    pix.fn.mockResolvedValue({ pixPayload: "PIX" });
    const out = await finalizeOrderAndCheckout(ctx(), { paymentMethod: "PIX" });
    expect(out).toMatchObject({ ok: true });
    expect(pix.fn.mock.calls[0][0].customer.cpfCnpj).toBe("52998224725");
  });

  it("sem rascunho não cria pedido", async () => {
    h.rows.set(whatsappSessions, [{ phone: PHONE, draftCart: [], customerId: null }]);
    expect(await finalizeOrderAndCheckout(ctx(), { paymentMethod: "CASH" })).toMatchObject({ ok: false });
  });
});

describe("requestHumanHandoff", () => {
  it("pausa o bot por 30 min e registra o HANDOFF (sem mandar WhatsApp)", async () => {
    const before = Date.now();
    const out = (await executeTool(ctx(), "requestHumanHandoff", { reason: "reclamação" })) as { pausedUntil: string };
    const delta = new Date(out.pausedUntil).getTime() - before;
    expect(delta).toBeGreaterThan(29 * 60_000);
    expect(delta).toBeLessThan(31 * 60_000);
    expect(wa.text).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------------- */

describe("multimodal: buildUserParts", () => {
  it("texto e interactive viram texto; áudio vira inlineData audio/ogg", async () => {
    const download = vi.fn().mockResolvedValue({ buffer: Buffer.from("OGG"), mimeType: "audio/ogg; codecs=opus" });
    const parts = await buildUserParts(
      [
        msg({ content: "quero um burger" }),
        msg({ wamid: "w2", mediaType: "interactive", content: "Sim" }),
        msg({ wamid: "w4", mediaType: "audio", content: "[áudio]", mediaId: "m1" }),
      ],
      download,
    );
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith("m1");
    expect(parts.map((p) => p.text).filter(Boolean)).toEqual(expect.arrayContaining(["quero um burger", "Sim"]));
    expect(parts.at(-1)?.inlineData).toEqual({ mimeType: "audio/ogg", data: Buffer.from("OGG").toString("base64") });
  });

  it("figurinha: baixa o webp e envia como imagem multimodal (sem texto fixo de 'reação positiva')", async () => {
    const download = vi.fn().mockResolvedValue({ buffer: Buffer.from("WEBP"), mimeType: "image/webp" });
    const parts = await buildUserParts(
      [msg({ mediaType: "sticker", content: "[Cliente enviou uma figurinha]", mediaId: "st1" })],
      download,
    );
    expect(download).toHaveBeenCalledWith("st1");
    expect(parts).toEqual([
      { text: "[Figurinha do cliente]" },
      { inlineData: { mimeType: "image/webp", data: Buffer.from("WEBP").toString("base64") } },
    ]);
    expect(JSON.stringify(parts)).not.toMatch(/positiva/);
  });

  it("figurinha com falha no download: texto neutro, sem derrubar nem presumir sentimento", async () => {
    const parts = await buildUserParts(
      [msg({ mediaType: "sticker", content: "[Cliente enviou uma figurinha]", mediaId: "st1" })],
      vi.fn().mockRejectedValue(new Error("x")),
    );
    expect(parts).toEqual([{ text: "[Cliente enviou uma figurinha]" }]);
  });

  it("reação (sem mídia) vai como texto, sem download", async () => {
    const download = vi.fn();
    const parts = await buildUserParts([msg({ mediaType: "sticker", content: "[Cliente reagiu com 👍]" })], download);
    expect(download).not.toHaveBeenCalled();
    expect(parts).toEqual([{ text: "[Cliente reagiu com 👍]" }]);
  });

  it("imagem vai inline; falha no download vira pedido de reenvio, sem derrubar", async () => {
    const ok = await buildUserParts(
      [msg({ mediaType: "image", content: "[imagem]", mediaId: "i1" })],
      vi.fn().mockResolvedValue({ buffer: Buffer.from("x"), mimeType: "image/jpeg" }),
    );
    expect(ok.at(-1)?.inlineData?.mimeType).toBe("image/jpeg");
    const fail = await buildUserParts(
      [msg({ mediaType: "audio", content: "[áudio]", mediaId: "m1" })],
      vi.fn().mockRejectedValue(new Error("x")),
    );
    expect(fail[0].text).toMatch(/reenviar/);
  });
});

describe("runBotTurn (Gemini mockado)", () => {
  const modelCall = (name: string, args: Record<string, unknown> = {}): GeminiContent => ({
    role: "model",
    parts: [{ functionCall: { name, args } }],
  });
  const modelText = (text: string): GeminiContent => ({ role: "model", parts: [{ text }] });
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  function deps(script: GeminiContent[]) {
    const requests: GeminiRequest[] = [];
    const sent: string[] = [];
    const ctas: { body: string; button: string; url: string }[] = [];
    const d: AgentDeps = {
      generate: async (req) => {
        requests.push(JSON.parse(JSON.stringify(req)));
        return script.shift() ?? null;
      },
      runTool: executeTool,
      sendText: async (_to, t) => {
        sent.push(t);
      },
      sendCta: async (_to, body, button, url) => {
        ctas.push({ body, button, url });
      },
      download: vi.fn().mockResolvedValue({ buffer: Buffer.from("a"), mimeType: "audio/ogg" }),
    };
    return { d, requests, sent, ctas };
  }

  it("escalateToHuman: nada é enviado ao cliente, o bot pausa até o fim do dia e deixa o HANDOFF para o painel", async () => {
    const { d, sent, ctas } = deps([modelCall("escalateToHuman", { reason: "insiste em pedir pelo chat" })]);
    expect(await runBotTurn(PHONE, [msg({ content: "quero um mexico sem cebola" })], d)).toBe(true);
    expect(sent).toEqual([]);
    expect(ctas).toEqual([]);
    const pause = h.writes.find((w) => w.table === whatsappSessions && (w.values as { botPausedUntil?: Date }).botPausedUntil);
    const until = (pause?.values as { botPausedUntil: Date }).botPausedUntil;
    expect(until.getTime()).toBeGreaterThan(Date.now());
    expect(until.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);
    const handoff = h.writes.find((w) => w.table === whatsappMessages && String((w.values as { content?: string }).content).startsWith("HANDOFF"));
    expect(handoff).toBeTruthy();
  });

  it("pedido pelo chat: a IA só envia o botão do Cardápio Rápido, com o texto padrão curto", async () => {
    const { d, sent, ctas } = deps([modelCall("sendQuickMenu", { messageText: "É rapidinho pelo cardápio 👇" })]);
    await runBotTurn(PHONE, [msg({ content: "quero um mexico" })], d);
    expect(sent).toEqual([]);
    expect(ctas).toHaveLength(1);
    expect(ctas[0].button).toBe("Cardápio Rápido");
    expect(ctas[0].body.length).toBeLessThan(120);
  });

  it("não está entendendo: se a resposta repete uma das últimas, para de responder hoje e avisa o painel", async () => {
    const frase = "Não consegui entender direitinho o que você quer, pode explicar de outro jeito?";
    h.rows.set(whatsappMessages, [
      { role: "assistant", content: frase, createdAt: minutesAgo(1), wamid: null, phone: PHONE },
    ]);
    const { d, sent } = deps([modelText(frase)]);
    expect(await runBotTurn(PHONE, [msg({ content: "aaa" })], d)).toBe(true);
    expect(sent).toEqual([]);
    expect(h.writes.some((w) => w.table === whatsappMessages && String((w.values as { content?: string }).content).startsWith("HANDOFF"))).toBe(true);
  });

  it("Cliente Novo: contexto vem no systemInstruction (sem round-trip de tool) e a resposta é enviada", async () => {
    h.rows.set(customers, []);
    const { d, requests, sent } = deps([modelText("Bem-vindo ao Passaporte Burguer!")]);
    await runBotTurn(PHONE, [msg()], d);
    expect(requests).toHaveLength(1); // uma única chamada ao Gemini
    expect(requests[0].systemInstruction).toContain('"isRegistered":false');
    expect(sent).toEqual(["Bem-vindo ao Passaporte Burguer!"]);
  });

  it("Cliente Cadastrado: nome, último pedido, cardápio e sessão já vão no systemInstruction", async () => {
    h.rows.set(customers, [{ id: "c1", name: "João Pedro", phone: "43999999999", documentNumber: "52998224725" }]);
    h.rows.set(orders, [{ id: "o1", addressSnapshot: null }]);
    h.rows.set(orderItems, [{ productId: BURGER, productNameSnapshot: "Nova York", quantity: 1, addonsSnapshot: [] }]);
    h.rows.set(whatsappSessions, [
      { phone: PHONE, state: "CONFIRMING_ORDER", draftCart: null, deliveryAddress: null, addressConfirmed: true },
    ]);
    const { d, requests, sent } = deps([modelText("Fala, João!")]);
    await runBotTurn(PHONE, [msg()], d);
    expect(requests).toHaveLength(1);
    const sys = requests[0].systemInstruction;
    expect(sys).toContain('"firstName":"João"');
    expect(sys).toContain('"hasDocument":true');
    expect(sys).not.toContain("52998224725"); // CPF nunca vai ao modelo
    expect(sys).toContain("Nova York");
    expect(sys).not.toContain("sessionStartedAt");
    expect(sent).toEqual(["Fala, João!"]);
  });

  it("greetingMode no systemInstruction: FIRST_TODAY, IN_CONVERSATION e RETURNING_TODAY", async () => {
    // Sem mensagens anteriores: primeira do dia (cumprimento pelo horário de Brasília).
    const first = deps([modelText("Fala!")]);
    await runBotTurn(PHONE, [msg()], first.d);
    expect(first.requests[0].systemInstruction).toContain("greetingMode = FIRST_TODAY");
    expect(first.requests[0].systemInstruction).toMatch(/Bom dia|Boa tarde|Boa noite/);

    // Mensagens na sessão atual: em conversa, sem cumprimentar.
    h.rows.set(whatsappMessages, [
      { role: "assistant", content: "Fala!", createdAt: minutesAgo(10) },
      { role: "user", content: "oi", createdAt: minutesAgo(11) },
    ]);
    const next = deps([modelText("Beleza.")]);
    await runBotTurn(PHONE, [msg({ wamid: "w2" })], next.d);
    expect(next.requests[0].systemInstruction).toContain("greetingMode = IN_CONVERSATION");
    expect(next.requests[0].systemInstruction).toContain("NÃO cumprimente");

    // Última mensagem há 7 h: novo dia de atendimento.
    h.rows.set(whatsappMessages, [{ role: "assistant", content: "Fala!", createdAt: minutesAgo(7 * 60) }]);
    const later = deps([modelText("Boa noite!")]);
    await runBotTurn(PHONE, [msg({ wamid: "w3" })], later.d);
    expect(later.requests[0].systemInstruction).toContain("greetingMode = FIRST_TODAY");

    // Conversou há pouco, o atendimento foi encerrado (sessão nova, 0 mensagens nela) e o cliente volta.
    h.rows.set(whatsappMessages, [{ role: "assistant", content: "Boa refeição!", createdAt: minutesAgo(30) }]);
    h.rows.set(whatsappSessions, [
      { phone: PHONE, state: "IDLE", draftCart: [], deliveryAddress: null, addressConfirmed: false, paymentMethod: null, sessionStartedAt: minutesAgo(29) },
    ]);
    const back = deps([modelText("Show, o que vai ser?")]);
    await runBotTurn(PHONE, [msg({ wamid: "w4" })], back.d);
    expect(back.requests[0].systemInstruction).toContain("greetingMode = RETURNING_TODAY");
    expect(back.requests[0].systemInstruction).toMatch(/sem repetir Boa tarde\/Boa noite/i);
  });

  it("isolamento: pedido concluído (sessionStartedAt) não contamina o histórico do novo pedido", async () => {
    h.rows.set(whatsappSessions, [
      { phone: PHONE, state: "IDLE", draftCart: [], deliveryAddress: null, addressConfirmed: false, paymentMethod: null, sessionStartedAt: minutesAgo(30) },
    ]);
    h.rows.set(whatsappMessages, [
      { role: "user", content: "quero um combo família", createdAt: minutesAgo(125) },
      { role: "assistant", content: "Anotado: combo família", createdAt: minutesAgo(124) },
      { role: "assistant", content: "Pedido #101 confirmado", createdAt: minutesAgo(31) },
      { role: "user", content: "quero uma batata", createdAt: minutesAgo(20) },
      { role: "assistant", content: "Batata anotada", createdAt: minutesAgo(19) },
    ]);
    const { d, requests } = deps([modelText("Pra entrega ou retirada?")]);
    await runBotTurn(PHONE, [msg({ wamid: "w9", content: "mais um refri" })], d);
    const sent = JSON.stringify(requests[0].contents);
    expect(sent).not.toContain("combo família");
    expect(sent).not.toContain("Pedido #101");
    expect(sent).toContain("quero uma batata");
    expect(sent).toContain("mais um refri");
  });

  it("system prompt: identidade natural, proibições, sem link e fechamento determinístico", async () => {
    const { d, requests } = deps([modelText("Opa, bem-vindo!")]);
    await runBotTurn(PHONE, [msg()], d);
    const sys = requests[0].systemInstruction;
    expect(sys).toContain("Passaporte Burguer");
    expect(sys).not.toContain("https://app.test"); // a IA não conhece nenhuma URL
    expect(sys).toMatch(/1 a 2 frases/i);
    expect(sys).toMatch(/1 emoji/i);
    expect(sys).toMatch(/NUNCA peça/i);
    expect(sys).toMatch(/NUNCA escreva URL/i);
    expect(sys).toMatch(/PROIBIDO:[^\n]*Bora pra mais um[^\n]*Bora embarcar nessa[^\n]*Com certeza[^\n]*Fique à vontade/);
    expect(sys).toMatch(/PROIBIDO mencionar falha técnica[^\n]*deu tilt[^\n]*deu erro/);
    expect(sys).toMatch(/PROIBIDO adicionar itens, combos/);
    expect(sys).toContain("greetingMode");
    expect(sys).toContain("addressConfirmed");
  });

  it("system prompt: persona humana e regras do Cardápio Rápido (só quando pedem; saudação é só conversa)", async () => {
    const { d, requests } = deps([modelText("Opa, bem-vindo!")]);
    await runBotTurn(PHONE, [msg()], d);
    const sys = requests[0].systemInstruction;
    expect(sys).toMatch(/Você é a Bia, atendente do Passaporte Burguer/);
    expect(sys).toContain("DADOS OPERACIONAIS AGORA");
    expect(sys).toMatch(/Status da loja: /);
    // Saudação / pergunta aberta: nada de botão.
    expect(sys).toMatch(/Oi[^\n]*Bom dia[^\n]*Tudo bem\?[^\n]*Estão abertos\?/);
    expect(sys).toMatch(/NÃO chame sendQuickMenu/);
    // Quando chamar.
    expect(sys).toMatch(/manda o cardápio[^\n]*quais lanches tem\?[^\n]*quero escolher[^\n]*me vê as opções/);
    expect(sys).toMatch(/messageText/);
    // Cliente cadastrado e novo.
    // Tom: sem robô, sem bullets em pergunta simples, sem empurrar link.
    expect(sys).toMatch(/Como posso ajudar\?[^\n]*Para prosseguir[^\n]*Selecione uma opção/);
    expect(sys).toMatch(/bullet/i);
    expect(sys).toMatch(/Bom dia, tudo bem\?[^\n]*tudo ótimo/i);
    expect(sys).not.toContain("Escolhe teu lanche por aqui");
  });

  it("a resposta da IA nunca leva link: Markdown e URLs alucinadas são removidos antes do envio", async () => {
    const { d, sent } = deps([modelText("Escolhe no [Cardápio](https://app.menu-rapido.com/x) ou em www.site.com/menu, tá?")]);
    await runBotTurn(PHONE, [msg()], d);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe("Escolhe no Cardápio ou em, tá?");
    expect(sent[0]).not.toMatch(/https?:|www\.|\]\(/);
  });

  it("RETURNING_TODAY: não corta a resposta do modelo (ele já foi instruído a não repetir o Boa tarde/noite)", async () => {
    h.rows.set(whatsappMessages, [{ role: "assistant", content: "Boa refeição!", createdAt: minutesAgo(30) }]);
    h.rows.set(whatsappSessions, [
      { phone: PHONE, state: "IDLE", draftCart: [], deliveryAddress: null, addressConfirmed: false, paymentMethod: null, sessionStartedAt: minutesAgo(29) },
    ]);
    const { d, sent } = deps([modelText("Opa, bora de novo! O que vai ser?")]);
    await runBotTurn(PHONE, [msg()], d);
    expect(sent).toEqual(["Opa, bora de novo! O que vai ser?"]);
  });

  it("IN_CONVERSATION: só 'Bom dia/Boa tarde/Boa noite' repetido é cortado; expressões naturais ficam", async () => {
    h.rows.set(whatsappMessages, [{ role: "assistant", content: "Anotado!", createdAt: minutesAgo(5) }]);
    const a = deps([modelText("Boa noite, Joao! Qual o endereço?")]);
    await runBotTurn(PHONE, [msg()], a.d);
    expect(a.sent).toEqual(["Qual o endereço?"]);

    for (const text of ["Show! Qual o endereço?", "Fechado! Qual o endereço?", "Perfeito! Qual o endereço?", "Beleza! Qual o endereço?"]) {
      const b = deps([modelText(text)]);
      await runBotTurn(PHONE, [msg({ wamid: "w2" })], b.d);
      expect(b.sent).toEqual([text]);
    }
  });

  it("FIRST_TODAY: a saudação é mantida", async () => {
    const { d, sent } = deps([modelText("Boa noite, Joao! Qual lanche vai ser?")]);
    await runBotTurn(PHONE, [msg()], d);
    expect(sent).toEqual(["Boa noite, Joao! Qual lanche vai ser?"]);
  });

  it("áudio chega ao Gemini como inlineData audio/ogg", async () => {
    const { d, requests } = deps([modelText("Anotado!")]);
    await runBotTurn(PHONE, [msg({ mediaType: "audio", content: "[áudio]", mediaId: "m1" })], d);
    const parts = requests[0].contents.at(-1)!.parts;
    expect(parts.some((p) => p.inlineData?.mimeType === "audio/ogg")).toBe(true);
  });

  it("figurinha chega ao Gemini como imagem webp para a IA ler o sentimento", async () => {
    const { d, requests } = deps([modelText("Tudo certo, o que faltou?")]);
    d.download = vi.fn().mockResolvedValue({ buffer: Buffer.from("W"), mimeType: "image/webp" });
    await runBotTurn(PHONE, [msg({ mediaType: "sticker", content: "[Cliente enviou uma figurinha]", mediaId: "st1" })], d);
    const parts = requests[0].contents.at(-1)!.parts;
    expect(parts.some((p) => p.inlineData?.mimeType === "image/webp")).toBe(true);
  });

  describe("checkout automático (determinístico no backend)", () => {
    const savedAddress = {
      street: "Rua Salva",
      number: "77",
      complement: null,
      reference: null,
      neighborhood: "Zona 07",
      district: "Zona 07",
      deliveryZoneId: "z1",
      latitude: -23.42,
      longitude: -51.94,
      city: "Maringá",
      postalCode: null,
    };
    const cart = [{ productId: BURGER, quantity: 1, addons: [] }];
    const base = { phone: PHONE, customerId: "cu1", state: "CONFIRMING_ORDER", draftCart: cart, sessionStartedAt: new Date(0) };

    function arrange() {
      h.rows.set(customers, [{ id: "cu1", name: "João", phone: "43999999999", email: null, asaasCustomerId: "cus_1" }]);
      h.rows.set(orders, [{ id: "o1", addressSnapshot: savedAddress }]);
      h.rows.set(whatsappSessions, [{ ...base, deliveryAddress: null, addressConfirmed: false, paymentMethod: null }]);
    }
    const ready = () =>
      h.rows.set(whatsappSessions, [{ ...base, deliveryAddress: savedAddress, addressConfirmed: true, paymentMethod: "PIX" }]);
    const orderWrites = () => h.writes.filter((w) => w.table === orders);

    it('"Sim no mesmo endereço" + "E vou pagar no Pix" no mesmo turno: o backend fecha o pedido sem nova confirmação', async () => {
      arrange();
      pix.fn.mockResolvedValue({ pixPayload: "PIXCOPIAECOLA" });
      const order: string[] = [];
      const { d, ctas, sent, requests } = deps([
        modelCall("setDeliveryAndPayment", { deliveryType: "DELIVERY", addressConfirmed: true, paymentMethod: "PIX" }),
        modelText("Fechado, só confirmo o pedido aqui, ok?"), // texto da IA é descartado: o fechamento é do backend
      ]);
      d.runTool = async (c, name, args) => {
        const out = await executeTool(c, name, args);
        ready(); // a sessão agora tem carrinho + endereço confirmado + Pix
        return out;
      };
      d.sendCta = async (_t, body, button, url) => {
        order.push("cta");
        ctas.push({ body, button, url });
      };
      d.sendText = async (_t, text) => {
        order.push(`text:${text}`);
        sent.push(text);
      };
      wa.text.mockImplementation(async (_t: string, text: string) => {
        order.push(`text:${text}`);
      });
      const ok = await runBotTurn(PHONE, [msg({ content: "Sim no mesmo endereço" }), msg({ wamid: "w2", content: "E vou pagar no Pix" })], d);
      expect(ok).toBe(true);
      expect(requests).toHaveLength(2); // sem 3ª rodada pedindo confirmação
      expect(pix.fn).toHaveBeenCalledTimes(1);
      // Pix = EXATAMENTE 2 mensagens de texto: confirmação (sem URL, sem botão) e o código sozinho.
      expect(ctas).toHaveLength(0);
      expect(order).toHaveLength(2);
      expect(order[1]).toBe("text:PIXCOPIAECOLA");
      expect(sent[0]).toMatch(/^Pedido #\d+ confirmado! Total R\$\s?41,99\./); // 35,00 + frete
      expect(sent[0]).not.toContain("só confirmo");
      expect(sent[0]).not.toMatch(/https?:|\/pedido\/|token=|Abrir/i);
      expect(sent[0]).not.toContain("PIXCOPIAECOLA");
      expect(JSON.stringify({ order, ctas })).not.toMatch(/Abrir link de pagamento|Abrir pagamento/);
      // Sessão isolada para o próximo pedido.
      const claim = h.writes.find((w) => w.op === "update" && w.table === whatsappSessions && "draftCart" in (w.set as object));
      expect(claim?.set).toMatchObject({ draftCart: [], addressConfirmed: false, paymentMethod: null, state: "IDLE" });
    });

    it("faltando o pagamento, nada é fechado", async () => {
      arrange(); // paymentMethod null
      const { d, sent } = deps([modelText("Como vai pagar: Pix, cartão ou na entrega?")]);
      await runBotTurn(PHONE, [msg({ content: "sim no mesmo endereço" })], d);
      expect(orderWrites()).toHaveLength(0);
      expect(pix.fn).not.toHaveBeenCalled();
      expect(sent).toEqual(["Como vai pagar: Pix, cartão ou na entrega?"]);
    });

    it("fechamento recusado (falta CPF): a IA recebe o motivo e explica, sem criar pedido", async () => {
      ready();
      h.rows.set(customers, [{ id: "cu1", name: "João", phone: "43999999999", email: null, asaasCustomerId: null }]);
      const { d, sent, requests } = deps([modelText("Fechado!"), modelText("Pra gerar o Pix preciso do seu CPF.")]);
      await runBotTurn(PHONE, [msg({ content: "pix" })], d);
      expect(requests).toHaveLength(2);
      expect(JSON.stringify(requests[1].contents.at(-1))).toMatch(/\[SISTEMA\][^]*CPF/);
      expect(orderWrites()).toHaveLength(0);
      expect(sent).toEqual(["Pra gerar o Pix preciso do seu CPF."]);
    });

    it("pagamento na entrega: mensagem determinística sem botão nem código", async () => {
      h.rows.set(customers, [{ id: "cu1", name: "João", phone: "43999999999", email: null, asaasCustomerId: null }]);
      h.rows.set(whatsappSessions, [{ ...base, deliveryAddress: null, addressConfirmed: true, paymentMethod: "CASH" }]);
      const { d, sent, ctas } = deps([modelText("ok")]);
      await runBotTurn(PHONE, [msg({ content: "dinheiro" })], d);
      expect(ctas).toHaveLength(0);
      expect(sent[0]).toMatch(/Pedido #\d+ confirmado!.*Já foi pra chapa! Você paga na retirada\./);
    });
  });

  describe("encerramento do papo", () => {
    it('"Já chegou" / "Valeu" sem pedido em andamento abre uma nova sessão (sessionStartedAt = agora)', async () => {
      const before = Date.now();
      const { d, sent } = deps([modelText("Boa refeição!")]);
      await runBotTurn(PHONE, [msg({ content: "Já chegou, valeu!" })], d);
      expect(sent).toEqual(["Boa refeição!"]);
      const reset = h.writes.find((w) => w.op === "update" && w.table === whatsappSessions);
      expect(reset?.set).toMatchObject({ draftCart: [], addressConfirmed: false, paymentMethod: null, state: "IDLE" });
      expect((reset?.set as { sessionStartedAt: Date }).sessionStartedAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it("com pedido em montagem não zera a sessão", async () => {
      h.rows.set(whatsappSessions, [
        { phone: PHONE, state: "CONFIRMING_ORDER", draftCart: [{ productId: BURGER, quantity: 1 }], deliveryAddress: null, addressConfirmed: false, paymentMethod: null },
      ]);
      const { d } = deps([modelText("Beleza, falta o endereço.")]);
      await runBotTurn(PHONE, [msg({ content: "valeu" })], d);
      expect(h.writes.find((w) => w.op === "update" && w.table === whatsappSessions)).toBeUndefined();
    });
  });

  it("botão (Cardápio Rápido): o messageText da IA é o corpo do botão, sem mensagem de texto duplicada", async () => {
    const { d, sent, ctas } = deps([
      modelCall("sendQuickMenu", { messageText: "Claro, João! Abre aqui pra escolher seus lanches e adicionais 👇" }),
      modelText("Aqui está o cardápio! Escolha o que quiser."), // 2ª mensagem redundante: NÃO pode sair
    ]);
    expect(await runBotTurn(PHONE, [msg({ content: "manda o cardápio" })], d)).toBe(true);
    expect(sent).toEqual([]);
    expect(ctas).toHaveLength(1);
    expect(ctas[0].body).toBe("Claro, João! Abre aqui pra escolher seus lanches e adicionais 👇");
    expect(ctas[0].button).toBe("Cardápio Rápido");
    expect(ctas[0].url).toMatch(/^https:\/\/app\.test\/cardapio-rapido\?token=/);
    // O que o cliente recebeu é o que fica no histórico.
    const saved = h.writes.find((w) => w.op === "insert" && w.table === whatsappMessages);
    expect(saved?.values).toMatchObject({ role: "assistant", content: ctas[0].body });
  });

  it("botão: funciona mesmo se a IA não escrever nenhum texto depois do tool", async () => {
    const { d, sent, ctas } = deps([
      modelCall("sendQuickMenu", { messageText: "Te mando as opções aqui 👇" }),
      { role: "model", parts: [{ text: "" }] },
    ]);
    expect(await runBotTurn(PHONE, [msg({ content: "quais lanches tem?" })], d)).toBe(true);
    expect(sent).toEqual([]);
    expect(ctas.map((c) => c.body)).toEqual(["Te mando as opções aqui 👇"]);
  });

  it("botão: messageText com link/Markdown nunca chega ao cliente", async () => {
    const { d, ctas } = deps([
      modelCall("sendQuickMenu", { messageText: "Abre o [cardápio](https://app.menu-rapido.com/abc) 👇" }),
      modelText("ok"),
    ]);
    await runBotTurn(PHONE, [msg({ content: "me vê as opções" })], d);
    expect(ctas[0].body).toBe("Abre o cardápio 👇");
  });

  it("botão sem messageText válido: nada de texto fixo; a IA recebe o erro e responde em texto", async () => {
    const { d, sent, ctas, requests } = deps([
      modelCall("sendQuickMenu", {}),
      modelText("Já te mando as opções, um instante."),
    ]);
    await runBotTurn(PHONE, [msg({ content: "manda o cardápio" })], d);
    expect(ctas).toHaveLength(0);
    expect(sent).toEqual(["Já te mando as opções, um instante."]);
    expect(JSON.stringify(requests)).not.toContain("Escolhe teu lanche por aqui");
  });

  it("botão recusado pela Meta: cai para texto com o link (a resposta não se perde)", async () => {
    const { d, sent } = deps([modelCall("sendQuickMenu", { messageText: "Escolhe aqui 👇" }), modelText("ok")]);
    d.sendCta = async () => {
      throw new Error("meta recusou");
    };
    expect(await runBotTurn(PHONE, [msg({ content: "quero escolher" })], d)).toBe(true);
    expect(sent[0]).toContain("Escolhe aqui 👇");
    expect(sent[0]).toMatch(/cardapio-rapido/);
  });

  it.each(["Oi", "Bom dia, tudo bem?", "Estão abertos?"])(
    "saudação/pergunta aberta (%s): resposta só em texto, sem botão do cardápio",
    async (text) => {
      h.rows.set(customers, [{ id: "c1", name: "João Pedro", phone: "43999999999" }]);
      const { d, sent, ctas } = deps([modelText("Bom dia, João! Tudo ótimo por aqui, e contigo? Já sabe o que vai pedir hoje?")]);
      await runBotTurn(PHONE, [msg({ content: text })], d);
      expect(ctas).toHaveLength(0);
      expect(sent).toHaveLength(1);
    },
  );

  it("a resposta é persistida em whatsapp_messages antes de o turno terminar", async () => {
    const { d } = deps([modelText("Anotado.")]);
    await runBotTurn(PHONE, [msg()], d);
    const saved = h.writes.find((w) => w.op === "insert" && w.table === whatsappMessages);
    expect(saved?.values).toMatchObject({ phone: PHONE, role: "assistant", content: "Anotado." });
  });

  it("2) falha total do Gemini: retorna false e NÃO escreve nada ao cliente (o inbox tenta de novo)", async () => {
    const { d, sent } = deps([]);
    d.generate = async () => {
      throw new Error("todos os modelos falharam");
    };
    expect(await runBotTurn(PHONE, [msg()], d)).toBe(false);
    expect(sent).toEqual([]);
  });

  it("resposta vazia do modelo (bloqueio) também é falha silenciosa", async () => {
    const { d, sent } = deps([]); // generate devolve null
    expect(await runBotTurn(PHONE, [msg()], d)).toBe(false);
    expect(sent).toEqual([]);
  });

  it("cliente escreveu de novo durante o turno: nada é enviado e o turno devolve 'superseded'", async () => {
    const { d, sent } = deps([modelText("Anotado!")]);
    d.hasNewer = async () => true;
    expect(await runBotTurn(PHONE, [msg()], d)).toBe("superseded");
    expect(sent).toEqual([]);
  });

  it("sucesso devolve true e não manda contingência", async () => {
    const { d, sent } = deps([modelText("Anotado!")]);
    expect(await runBotTurn(PHONE, [msg()], d)).toBe(true);
    expect(sent).toEqual(["Anotado!"]);
  });

  it("falha no envio pela Meta: retorna false sem tentar outra mensagem (o lote volta à fila)", async () => {
    const { d } = deps([modelText("Anotado!")]);
    const calls: string[] = [];
    d.sendText = async (_t, text) => {
      calls.push(text);
      throw new Error("meta fora");
    };
    expect(await runBotTurn(PHONE, [msg()], d)).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
