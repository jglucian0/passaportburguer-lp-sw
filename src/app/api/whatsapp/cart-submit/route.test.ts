import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: new Map<unknown, unknown[]>(),
  writes: [] as { op: string; table: unknown; values?: unknown }[],
}));

vi.mock("@/infra/db", () => {
  const chain = (op: string, table?: unknown) => {
    const entry: { op: string; table: unknown; values?: unknown } = { op, table };
    const api: Record<string, unknown> = {};
    for (const m of ["where", "orderBy", "limit", "onConflictDoNothing", "onConflictDoUpdate", "returning"]) {
      api[m] = () => api;
    }
    api.set = (v: unknown) => {
      entry.values = v;
      return api;
    };
    api.from = (t: unknown) => {
      entry.table = t;
      return api;
    };
    api.values = (v: unknown) => {
      entry.values = v;
      return api;
    };
    api.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      if (op !== "select") h.writes.push(entry);
      return Promise.resolve(h.rows.get(entry.table) ?? []).then(resolve, reject);
    };
    api.catch = (reject: (e: unknown) => unknown) => (api.then as (a: unknown, b: unknown) => Promise<unknown>)(undefined, reject);
    return api;
  };
  return {
    db: {
      select: () => chain("select"),
      insert: (t: unknown) => chain("insert", t),
      update: (t: unknown) => chain("update", t),
      delete: (t: unknown) => chain("delete", t),
    },
  };
});

const catalog = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock("@/infra/db/queries", () => ({ loadCatalog: async () => catalog.value, loadDeliveryZones: async () => [] }));
vi.mock("@/infra/db/store-settings", () => ({
  loadStoreSettings: async () => ({ isOpenOverride: true, autoAcceptOrders: false, openingHours: {}, deliveryRules: {} }),
}));
vi.mock("@/infra/security/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) }));

const fin = vi.hoisted(() => ({ finalize: vi.fn() }));
vi.mock("@/infra/whatsapp/order-flow", async (original) => ({
  ...(await original<typeof import("@/infra/whatsapp/order-flow")>()),
  finalizeOrderAndCheckout: fin.finalize,
}));
const snap = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock("@/infra/whatsapp/draft-flow", () => ({ buildSnapshot: snap.build }));
const wa = vi.hoisted(() => ({ text: vi.fn().mockResolvedValue({}) }));
vi.mock("@/infra/whatsapp/client", () => ({ sendTextMessage: wa.text, sendCtaUrlButton: vi.fn(), downloadMedia: vi.fn() }));

import { customers, tenants, whatsappMessages, whatsappSessions } from "@/infra/db/schema";
import { signWhatsAppToken } from "@/infra/whatsapp/session-token";

import { POST } from "./route";

const PHONE = "5543999999999";
const BURGER = "11111111-1111-4111-8111-111111111111";
const BACON = "22222222-2222-4222-8222-222222222222";
const PAY_URL = "https://www.passaporteburguer.com.br/pedido/o1/pagamento?token=t";

const call = (body: unknown) =>
  POST(new Request("http://localhost/api/whatsapp/cart-submit", { method: "POST", body: JSON.stringify(body) }) as never);

const menuToken = () => signWhatsAppToken({ phone: PHONE, purpose: "QUICK_MENU" });
const items = [{ productId: BURGER, quantity: 2, addons: [{ addonId: BACON, quantity: 1 }], notes: "sem cebola" }];
const pickup = { deliveryType: "PICKUP" as const };
const registered = { id: "c1", name: "João Silva", phone: "43999999999", passwordHash: "hash", email: "j@x.com" };

beforeEach(() => {
  process.env.WHATSAPP_SESSION_SECRET = "test-secret-with-enough-length";
  process.env.WHATSAPP_BUSINESS_NUMBER = "5543996098333";
  h.rows.clear();
  h.writes.length = 0;
  wa.text.mockClear();
  fin.finalize.mockReset();
  fin.finalize.mockResolvedValue({ ok: true, orderId: "o1", orderNumber: 101, checkoutUrl: PAY_URL });
  snap.build.mockReset();
  h.rows.set(tenants, [{ id: "t1", minOrderCents: 0 }]);
  h.rows.set(whatsappMessages, [{ id: "m1" }]); // claim ok
  h.rows.set(whatsappSessions, [{ botPausedUntil: null }]);
  h.rows.set(customers, [registered]);
  catalog.value = [
    {
      id: "c1",
      name: "Burgers",
      products: [
        {
          id: BURGER,
          name: "Nova York",
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

describe("POST /api/whatsapp/cart-submit", () => {
  it("401 para token expirado", async () => {
    vi.useFakeTimers();
    const token = menuToken();
    vi.advanceTimersByTime(31 * 60_000);
    const res = await call({ token, items, checkout: pickup });
    vi.useRealTimers();
    expect(res.status).toBe(401);
    expect(h.writes).toHaveLength(0);
  });

  it("401 para token adulterado, de outro propósito ou lixo", async () => {
    const [body, sig] = menuToken().split(".");
    const forged = Buffer.from(JSON.stringify({ phone: "5511888888888", purpose: "QUICK_MENU", exp: 9999999999 })).toString("base64url");
    expect((await call({ token: `${forged}.${sig}`, items, checkout: pickup })).status).toBe(401);
    expect((await call({ token: `${body}.${sig.slice(0, -2)}AA`, items, checkout: pickup })).status).toBe(401);
    expect((await call({ token: signWhatsAppToken({ phone: PHONE, purpose: "COMPLETE_REGISTRATION" }), items, checkout: pickup })).status).toBe(401);
    expect((await call({ token: "lixo-lixo-lixo", items, checkout: pickup })).status).toBe(401);
    expect(h.writes).toHaveLength(0);
  });

  it("400 sem itens ou sem os dados de entrega", async () => {
    expect((await call({ token: menuToken(), items: [], checkout: pickup })).status).toBe(400);
    expect((await call({ token: menuToken(), items })).status).toBe(400);
  });

  it("cliente cadastrado, retirada: fecha o pedido no servidor e manda para a página de pagamento (bot não escreve nada)", async () => {
    const res = await call({
      token: menuToken(),
      items: [{ ...items[0], priceCents: 1, unitPriceCents: 1, totalCents: 1 }], // preços do cliente são ignorados
      checkout: pickup,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, redirectUrl: PAY_URL, orderNumber: 101 });
    expect(fin.finalize).toHaveBeenCalledTimes(1);

    const session = h.writes.find((w) => w.table === whatsappSessions && w.op === "insert")?.values as {
      phone: string;
      customerId: string;
      addressConfirmed: boolean;
      deliveryAddress: unknown;
      draftCart: unknown;
    };
    expect(session).toMatchObject({ phone: PHONE, customerId: "c1", addressConfirmed: true, deliveryAddress: null });
    expect(session.draftCart).toEqual([
      { productId: BURGER, quantity: 2, notes: "sem cebola", addons: [{ addonId: BACON, quantity: 1 }] },
    ]);

    // Uso único: a ação fica registrada com a marca do link; subtotal oficial 2 x (3500 + 500) = R$ 80,00.
    const claim = h.writes.find((w) => w.table === whatsappMessages && (w.values as { role: string }).role === "user");
    expect((claim?.values as { wamid: string }).wamid).toMatch(/^qm:[0-9a-f]{64}$/);
    expect((claim?.values as { content: string }).content).toMatch(/80,00/);
    expect(wa.text).not.toHaveBeenCalled(); // a confirmação é a própria página de pagamento
  });

  it("endereço que não localiza: 422 com a mensagem e NADA é gravado (o link não queima)", async () => {
    snap.build.mockResolvedValue({ ok: false, error: "Não consegui localizar esse endereço. Confirme rua e número." });
    const res = await call({ token: menuToken(), items, checkout: { deliveryType: "DELIVERY", address: { street: "Rua Z", number: "9" } } });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/localizar/);
    expect(h.writes).toHaveLength(0);
  });

  it("entrega sem endereço: 400 e nada gravado", async () => {
    const res = await call({ token: menuToken(), items, checkout: { deliveryType: "DELIVERY" } });
    expect(res.status).toBe(400);
    expect(h.writes).toHaveLength(0);
  });

  it("cliente sem senha no site: exige nome, e-mail e senha; cria o acesso (senha em hash) e segue para o pagamento", async () => {
    h.rows.set(customers, [{ id: "c1", name: "Fulano", phone: "43999999999", passwordHash: null, email: null }]);

    const semSenha = await call({ token: menuToken(), items, checkout: { ...pickup, name: "Fulano de Tal", email: "fulano@x.com" } });
    expect(semSenha.status).toBe(400);
    expect(h.writes).toHaveLength(0);

    const res = await call({
      token: menuToken(),
      items,
      checkout: { ...pickup, name: "Fulano de Tal", email: "Fulano@X.com", password: "senha-forte-123" },
    });
    expect(res.status).toBe(200);
    const update = h.writes.find((w) => w.table === customers && w.op === "update")?.values as {
      name: string;
      email: string;
      passwordHash: string;
    };
    expect(update).toMatchObject({ name: "Fulano de Tal", email: "fulano@x.com" });
    expect(update.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt; a senha nunca é gravada em claro
    expect(JSON.stringify(h.writes.map((w) => w.values))).not.toContain("senha-forte-123");
    expect(fin.finalize).toHaveBeenCalledTimes(1);
  });

  it("409 quando o link já foi usado (claim em conflito); nada é salvo nem finalizado", async () => {
    h.rows.set(whatsappMessages, []);
    const res = await call({ token: menuToken(), items, checkout: pickup });
    expect(res.status).toBe(409);
    expect(h.writes.find((w) => w.table === whatsappSessions)).toBeUndefined();
    expect(fin.finalize).not.toHaveBeenCalled();
  });

  it("422 para produto inexistente, sem queimar o link", async () => {
    const res = await call({
      token: menuToken(),
      items: [{ productId: "33333333-3333-4333-8333-333333333333", quantity: 1 }],
      checkout: pickup,
    });
    expect(res.status).toBe(422);
    expect(h.writes.find((w) => w.table === whatsappMessages)).toBeUndefined();
  });

  it("fechamento recusado (ex.: loja fechou): 422 e o link é liberado para tentar de novo", async () => {
    fin.finalize.mockResolvedValue({ ok: false, error: "A loja está fechada no momento." });
    const res = await call({ token: menuToken(), items, checkout: pickup });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/fechada/);
    expect(h.writes.some((w) => w.table === whatsappMessages && w.op === "delete")).toBe(true);
  });

  it("atalho 'Repetir pedido' (QUICK_CHECKOUT): sem itens no corpo, usa o rascunho salvo", async () => {
    h.rows.set(whatsappSessions, [{ draftCart: [{ productId: BURGER, quantity: 1, addons: [], notes: null }] }]);
    const token = signWhatsAppToken({ phone: PHONE, purpose: "QUICK_CHECKOUT" });
    const res = await call({ token, checkout: pickup });
    expect(res.status).toBe(200);
    expect(fin.finalize).toHaveBeenCalledTimes(1);

    h.rows.set(whatsappSessions, [{ draftCart: [] }]);
    expect((await call({ token, checkout: pickup })).status).toBe(422);
  });
});
