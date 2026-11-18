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
  sendCtaUrlButton: wa.cta,
  sendTextMessage: wa.text,
  downloadMedia: vi.fn(),
}));

import { customers, orderItems, orders, tenants, whatsappMessages, whatsappSessions } from "@/infra/db/schema";

import { buildUserParts, runBotTurn, type AgentDeps } from "./agent";
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

  it("link do Cardápio Rápido: token assinado, sem telefone puro; vira o botão da MESMA mensagem da resposta", async () => {
    const c = ctx();
    const out = (await executeTool(c, "generateQuickMenuLink")) as { sent: boolean };
    expect(out.sent).toBe(true);
    expect(c.afterReply).toHaveLength(0); // nada de mensagem extra depois
    expect(c.cta?.buttonText).toBe("Cardápio Rápido");
    expect(c.cta?.url).toMatch(/^https:\/\/app\.test\/cardapio-rapido\?token=/);
    expect(c.cta?.url).not.toContain(PHONE);
  });
});

describe("saveDraftOrder / finalizeOrderAndCheckout", () => {
  const draft = (over: Record<string, unknown> = {}) => ({
    items: [{ productId: BURGER, quantity: 2, addons: [{ addonId: BACON, quantity: 1 }], notes: "sem cebola" }],
    deliveryType: "DELIVERY",
    address: { street: "Rua A", number: "10" },
    customerName: "Maria",
    ...over,
  });

  it("calcula subtotal + frete no servidor (ignora preços enviados)", async () => {
    h.rows.set(customers, [{ id: "cu1", name: "Maria", phone: "43999999999" }]);
    const out = (await executeTool(ctx(), "saveDraftOrder", { ...draft(), subtotalCents: 1, totalCents: 1 })) as Record<string, unknown>;
    expect(out.ok).toBe(true);
    // 2 x (3500 + 500) = 8000 + frete
    expect(out.subtotalFormatted).toMatch(/80,00/);
    const saved = h.writes.find((w) => w.table === whatsappSessions);
    expect((saved?.values as { draftCart: unknown[] }).draftCart).toHaveLength(1);
  });

  it("rejeita produto e adicional inexistentes", async () => {
    h.rows.set(customers, [{ id: "cu1" }]);
    const bad = "33333333-3333-4333-8333-333333333333";
    const a = (await executeTool(ctx(), "saveDraftOrder", draft({ items: [{ productId: bad, quantity: 1 }] }))) as { ok: boolean };
    const b = (await executeTool(
      ctx(),
      "saveDraftOrder",
      draft({ items: [{ productId: BURGER, quantity: 1, addons: [{ addonId: bad, quantity: 1 }] }] }),
    )) as { ok: boolean };
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(h.writes.find((w) => w.table === whatsappSessions)).toBeUndefined();
  });

  it("entrega sem endereço é recusada", async () => {
    const out = (await executeTool(ctx(), "saveDraftOrder", draft({ address: null }))) as { ok: boolean };
    expect(out.ok).toBe(false);
  });

  const sessionWithDraft = () => {
    h.rows.set(whatsappSessions, [
      {
        phone: PHONE,
        customerId: "cu1",
        draftCart: [{ productId: BURGER, quantity: 1, addons: [] }],
        deliveryAddress: null, // retirada
      },
    ]);
    h.rows.set(customers, [{ id: "cu1", name: "Maria", phone: "43999999999", email: null, asaasCustomerId: null }]);
  };

  it("Pix: o modelo nunca vê o código; ele sai como mensagem própria", async () => {
    sessionWithDraft();
    pix.fn.mockResolvedValue({ pixPayload: "00020126PIXCODE" });
    const c = ctx();
    const out = await executeTool(c, "finalizeOrderAndCheckout", { paymentMethod: "PIX", documentNumber: "52998224725" });
    expect(out).toMatchObject({ ok: true, pixCodeSentSeparately: true });
    expect(JSON.stringify(out)).not.toContain("PIXCODE");
    // Botão de checkout (mensagem da resposta) + link completo no corpo + código sozinho depois.
    expect(c.cta).toMatchObject({ appendUrlToBody: true });
    expect(c.cta?.url).toMatch(/^https:\/\/app\.test\/pedido\/[0-9a-f-]{36}\/pagamento$/);
    expect(c.afterReply).toHaveLength(1);
    await c.afterReply[0]();
    expect(wa.text).toHaveBeenCalledWith(PHONE, "00020126PIXCODE");
    const claim = h.writes.find((w) => w.op === "update" && w.table === whatsappSessions);
    expect(claim?.set).toMatchObject({ draftCart: null });
  });

  it("Pix sem CPF (cliente sem Asaas) pede o documento e não cria pedido", async () => {
    sessionWithDraft();
    const out = await executeTool(ctx(), "finalizeOrderAndCheckout", { paymentMethod: "PIX" });
    expect(out).toMatchObject({ ok: false, needsDocument: true });
    expect(pix.fn).not.toHaveBeenCalled();
  });

  it("Cartão: botão 'Pagar com Cartão' apontando para /pedido/{id}/pagamento", async () => {
    sessionWithDraft();
    const c = ctx();
    const out = await executeTool(c, "finalizeOrderAndCheckout", { paymentMethod: "CREDIT_CARD", documentNumber: "52998224725" });
    expect(out).toMatchObject({ ok: true, cardButtonSentSeparately: true });
    expect(c.cta?.buttonText).toBe("Pagar com Cartão");
    expect(c.cta?.url).toMatch(/^https:\/\/app\.test\/pedido\/[0-9a-f-]{36}\/pagamento$/);
  });

  it("URL de checkout: sem NEXT_PUBLIC_APP_URL usa o domínio canônico; barra final e esquema ausente são normalizados", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const want = `https://www.passaporteburguer.com.br/pedido/${id}/pagamento`;
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(checkoutUrl(id)).toBe(want);
    process.env.NEXT_PUBLIC_APP_URL = "https://www.passaporteburguer.com.br/";
    expect(checkoutUrl(id)).toBe(want);
    process.env.NEXT_PUBLIC_APP_URL = "www.passaporteburguer.com.br";
    expect(checkoutUrl(id)).toBe(want);
    expect(checkoutUrl(id)).not.toContain("undefined");
  });

  it("cliente já cadastrado com CPF: Pix usa o CPF salvo, sem pedir documento", async () => {
    sessionWithDraft();
    h.rows.set(customers, [
      { id: "cu1", name: "Maria", phone: "43996098333", email: null, asaasCustomerId: null, documentNumber: "52998224725" },
    ]);
    pix.fn.mockResolvedValue({ pixPayload: "PIX" });
    const out = await executeTool(ctx(), "finalizeOrderAndCheckout", { paymentMethod: "PIX" });
    expect(out).toMatchObject({ ok: true });
    expect(pix.fn.mock.calls[0][0].customer.cpfCnpj).toBe("52998224725");
  });

  it("endereço confirmado pelo cliente é gravado na sessão (addressConfirmed)", async () => {
    h.rows.set(customers, [{ id: "cu1", name: "Maria", phone: "43999999999" }]);
    const out = await executeTool(ctx(), "saveDraftOrder", draft({ addressConfirmed: true }));
    expect(out).toMatchObject({ ok: true });
    const save = h.writes.find((w) => w.op === "insert" && w.table === whatsappSessions);
    expect(save?.values).toMatchObject({ addressConfirmed: true });
  });

  it("sem rascunho não cria pedido", async () => {
    h.rows.set(whatsappSessions, [{ phone: PHONE, draftCart: null, customerId: null }]);
    const out = await executeTool(ctx(), "finalizeOrderAndCheckout", { paymentMethod: "CASH" });
    expect(out).toMatchObject({ ok: false });
  });
});

describe("requestHumanHandoff", () => {
  it("pausa o bot por 30 min e avisa a loja", async () => {
    process.env.STORE_WHATSAPP = "5543996098333";
    const before = Date.now();
    const out = (await executeTool(ctx(), "requestHumanHandoff", { reason: "reclamação" })) as { pausedUntil: string };
    const delta = new Date(out.pausedUntil).getTime() - before;
    expect(delta).toBeGreaterThan(29 * 60_000);
    expect(delta).toBeLessThan(31 * 60_000);
    expect(wa.text).toHaveBeenCalledWith("5543996098333", expect.stringContaining("reclamação"));
  });
});

/* ---------------------------------------------------------------------- */

describe("multimodal: buildUserParts", () => {
  it("texto, interactive e figurinha viram texto; áudio vira inlineData audio/ogg", async () => {
    const download = vi.fn().mockResolvedValue({ buffer: Buffer.from("OGG"), mimeType: "audio/ogg; codecs=opus" });
    const parts = await buildUserParts(
      [
        msg({ content: "quero um burger" }),
        msg({ wamid: "w2", mediaType: "interactive", content: "Sim" }),
        msg({ wamid: "w3", mediaType: "sticker", content: "[Cliente enviou uma figurinha/reação positiva]" }),
        msg({ wamid: "w4", mediaType: "audio", content: "[áudio]", mediaId: "m1" }),
      ],
      download,
    );
    expect(download).toHaveBeenCalledWith("m1");
    expect(parts.map((p) => p.text).filter(Boolean)).toContain("[Cliente enviou uma figurinha/reação positiva]");
    expect(parts.at(-1)?.inlineData).toEqual({ mimeType: "audio/ogg", data: Buffer.from("OGG").toString("base64") });
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
    expect(sys).toContain('"addressConfirmed":true');
    expect(sent).toEqual(["Fala, João!"]);
    expect(requests[0].functionDeclarations?.map((t) => t.name)).not.toContain("getAvailableMenu");
  });

  it("saudação só com histórico vazio", async () => {
    const first = deps([modelText("oi")]);
    await runBotTurn(PHONE, [msg()], first.d);
    expect(first.requests[0].systemInstruction).toContain("HISTÓRICO VAZIO");

    h.rows.set(whatsappMessages, [
      { role: "user", content: "oi" },
      { role: "assistant", content: "Fala!" },
    ]);
    const next = deps([modelText("beleza")]);
    await runBotTurn(PHONE, [msg({ wamid: "w2" })], next.d);
    expect(next.requests[0].systemInstruction).toContain("NÃO cumprimente");
    expect(next.requests[0].systemInstruction).not.toContain("HISTÓRICO VAZIO");
  });

  it("system prompt: identidade Passaporte Burguer, tom humano e regras de botão único / CPF / endereço", async () => {
    const { d, requests } = deps([modelText("oi")]);
    await runBotTurn(PHONE, [msg()], d);
    const sys = requests[0].systemInstruction;
    expect(sys).toContain("Passaporte Burguer");
    expect(sys).toContain("https://app.test");
    expect(sys).toMatch(/Bora embarcar/);
    expect(sys).toMatch(/máximo 3 linhas/i);
    expect(sys).toMatch(/1 emoji/i);
    expect(sys).toMatch(/NUNCA peça o CPF/i);
    expect(sys).toContain("addressConfirmed");
    // Frases proibidas aparecem só como lista de proibições.
    expect(sys).toMatch(/PROIBIDO[^]*Com certeza/);
  });

  it("áudio chega ao Gemini como inlineData audio/ogg", async () => {
    const { d, requests } = deps([modelText("Anotado!")]);
    await runBotTurn(PHONE, [msg({ mediaType: "audio", content: "[áudio]", mediaId: "m1" })], d);
    const parts = requests[0].contents.at(-1)!.parts;
    expect(parts.some((p) => p.inlineData?.mimeType === "audio/ogg")).toBe(true);
  });

  it("Pix: UMA mensagem com botão (resumo + link completo no corpo), depois o código Pix sozinho", async () => {
    h.rows.set(whatsappSessions, [
      { phone: PHONE, customerId: "cu1", draftCart: [{ productId: BURGER, quantity: 1, addons: [] }], deliveryAddress: null },
    ]);
    h.rows.set(customers, [{ id: "cu1", name: "Maria", phone: "43999999999", email: null, asaasCustomerId: "cus_1" }]);
    pix.fn.mockResolvedValue({ pixPayload: "PIXCOPIAECOLA" });
    const order: string[] = [];
    const { d, ctas } = deps([
      modelCall("finalizeOrderAndCheckout", { paymentMethod: "PIX" }),
      modelText("Já mandei pra chapa! Total R$ 35,00."),
    ]);
    d.sendText = async (_t, text) => {
      order.push(`text:${text}`);
    };
    d.sendCta = async (_t, body, button, url) => {
      order.push("cta");
      ctas.push({ body, button, url });
    };
    wa.text.mockImplementation(async (_t: string, text: string) => {
      order.push(`text:${text}`);
    });
    await runBotTurn(PHONE, [msg({ content: "pix" })], d);
    // Nenhum texto solto antes do botão: o convite está DENTRO do corpo do botão.
    expect(order).toEqual(["cta", "text:PIXCOPIAECOLA"]);
    expect(ctas).toHaveLength(1);
    expect(ctas[0].body).toContain("Já mandei pra chapa!");
    expect(ctas[0].url).toMatch(/^https:\/\/app\.test\/pedido\/[0-9a-f-]{36}\/pagamento$/);
    expect(ctas[0].body).toContain(ctas[0].url); // link https:// completo também no texto
    expect(ctas[0].body).not.toContain("PIXCOPIAECOLA");
  });

  it("botão (Cardápio Rápido): o texto da resposta vira o corpo do botão, sem mensagem de texto separada", async () => {
    const { d, sent, ctas } = deps([
      modelCall("generateQuickMenuLink"),
      modelText("Escolhe teu lanche aqui no cardápio rápido 👇"),
    ]);
    expect(await runBotTurn(PHONE, [msg()], d)).toBe(true);
    expect(sent).toEqual([]);
    expect(ctas).toHaveLength(1);
    expect(ctas[0].body).toBe("Escolhe teu lanche aqui no cardápio rápido 👇");
    expect(ctas[0].button).toBe("Cardápio Rápido");
  });

  it("botão recusado pela Meta: cai para texto (a resposta não se perde)", async () => {
    const { d, sent } = deps([modelCall("generateQuickMenuLink"), modelText("Escolhe aqui 👇")]);
    d.sendCta = async () => {
      throw new Error("meta recusou");
    };
    expect(await runBotTurn(PHONE, [msg()], d)).toBe(true);
    expect(sent[0]).toContain("Escolhe aqui 👇");
    expect(sent[0]).toMatch(/cardapio-rapido/);
  });

  it("2) falha total do Gemini: mensagem de contingência ao cliente (com o link do cardápio) e retorno false", async () => {
    const { d, sent } = deps([]);
    d.generate = async () => {
      throw new Error("todos os modelos falharam");
    };
    const ok = await runBotTurn(PHONE, [msg()], d);
    expect(ok).toBe(false);
    expect(sent).toEqual([
      "Tive uma instabilidade rápida aqui no meu sistema agora. Pode me mandar novamente ou, se preferir agilizar, fazer seu pedido direto pelo nosso cardápio: https://app.test",
    ]);
  });

  it("resposta vazia do modelo (bloqueio) também é falha com contingência", async () => {
    const { d, sent } = deps([]); // generate devolve null
    expect(await runBotTurn(PHONE, [msg()], d)).toBe(false);
    expect(sent[0]).toMatch(/instabilidade/);
  });

  it("sucesso devolve true e não manda contingência", async () => {
    const { d, sent } = deps([modelText("Oi!")]);
    expect(await runBotTurn(PHONE, [msg()], d)).toBe(true);
    expect(sent).toEqual(["Oi!"]);
  });

  it("falha no envio pela Meta: tenta a contingência e retorna false (o lote volta à fila)", async () => {
    const { d } = deps([modelText("Oi!")]);
    const calls: string[] = [];
    d.sendText = async (_t, text) => {
      calls.push(text);
      throw new Error("meta fora");
    };
    expect(await runBotTurn(PHONE, [msg()], d)).toBe(false);
    expect(calls).toHaveLength(2); // resposta + contingência
  });
});
