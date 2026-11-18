import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: new Map<unknown, unknown[]>(),
  writes: [] as { op: string; table: unknown; values?: unknown }[],
}));

vi.mock("@/infra/db", () => {
  const chain = (op: string, table?: unknown) => {
    const entry: { op: string; table: unknown; values?: unknown } = { op, table };
    const api: Record<string, unknown> = {};
    for (const m of ["where", "orderBy", "limit", "onConflictDoNothing", "onConflictDoUpdate", "returning", "set"]) {
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
const wa = vi.hoisted(() => ({ text: vi.fn().mockResolvedValue({}) }));
vi.mock("@/infra/whatsapp/client", () => ({ sendTextMessage: wa.text, sendCtaUrlButton: vi.fn(), downloadMedia: vi.fn() }));

import { customers, tenants, whatsappMessages, whatsappSessions } from "@/infra/db/schema";
import { signWhatsAppToken } from "@/infra/whatsapp/session-token";

import { POST } from "./route";

const PHONE = "5543999999999";
const BURGER = "11111111-1111-4111-8111-111111111111";
const BACON = "22222222-2222-4222-8222-222222222222";

const call = (body: unknown) =>
  POST(new Request("http://localhost/api/whatsapp/cart-submit", { method: "POST", body: JSON.stringify(body) }) as never);

const validToken = () => signWhatsAppToken({ phone: PHONE, purpose: "QUICK_MENU" });
const items = [{ productId: BURGER, quantity: 2, addons: [{ addonId: BACON, quantity: 1 }], notes: "sem cebola" }];

beforeEach(() => {
  process.env.WHATSAPP_SESSION_SECRET = "test-secret-with-enough-length";
  process.env.WHATSAPP_BUSINESS_NUMBER = "5543996098333";
  h.rows.clear();
  h.writes.length = 0;
  wa.text.mockClear();
  h.rows.set(tenants, [{ id: "t1", minOrderCents: 0 }]);
  h.rows.set(whatsappMessages, [{ id: "m1" }]); // claim ok
  h.rows.set(whatsappSessions, [{ botPausedUntil: null }]);
  h.rows.set(customers, []);
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
    const token = validToken();
    vi.advanceTimersByTime(31 * 60_000);
    const res = await call({ token, items });
    vi.useRealTimers();
    expect(res.status).toBe(401);
    expect(h.writes).toHaveLength(0);
  });

  it("401 para token adulterado, de outro propósito ou lixo", async () => {
    const [body, sig] = validToken().split(".");
    const forged = Buffer.from(JSON.stringify({ phone: "5511888888888", purpose: "QUICK_MENU", exp: 9999999999 })).toString("base64url");
    expect((await call({ token: `${forged}.${sig}`, items })).status).toBe(401);
    expect((await call({ token: `${body}.${sig.slice(0, -2)}AA`, items })).status).toBe(401);
    expect((await call({ token: signWhatsAppToken({ phone: PHONE, purpose: "COMPLETE_REGISTRATION" }), items })).status).toBe(401);
    expect((await call({ token: "lixo-lixo-lixo", items })).status).toBe(401);
    expect(h.writes).toHaveLength(0);
  });

  it("400 sem itens", async () => {
    expect((await call({ token: validToken(), items: [] })).status).toBe(400);
  });

  it("recalcula preços no servidor (ignora valores do cliente), salva o rascunho e avisa no WhatsApp", async () => {
    const res = await call({
      token: validToken(),
      items: [{ ...items[0], priceCents: 1, unitPriceCents: 1, totalCents: 1 }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, redirectUrl: "https://wa.me/5543996098333" });

    const draft = h.writes.find((w) => w.table === whatsappSessions && w.op === "insert");
    const values = draft?.values as { phone: string; draftCart: { productId: string; quantity: number; notes: string }[] };
    expect(values.phone).toBe(PHONE);
    expect(values.draftCart).toEqual([
      { productId: BURGER, quantity: 2, notes: "sem cebola", addons: [{ addonId: BACON, quantity: 1 }] },
    ]);

    // Ação do usuário registrada com a marca de uso único; subtotal oficial: 2 x (3500 + 500) = R$ 80,00.
    const claim = h.writes.find((w) => w.table === whatsappMessages && (w.values as { role: string }).role === "user");
    expect((claim?.values as { wamid: string; content: string }).wamid).toMatch(/^qm:[0-9a-f]{64}$/);
    expect((claim?.values as { content: string }).content).toMatch(/80,00/);

    expect(wa.text).toHaveBeenCalledTimes(1);
    const [to, text] = wa.text.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(text).toMatch(/2x Nova York \(\+ Bacon\) — obs: sem cebola/);
    expect(text).toMatch(/80,00/);
    expect(text).toMatch(/nome e do endereço/); // cliente novo: pede endereço
  });

  it("cliente cadastrado com endereço salvo: confirma o endereço e pergunta o pagamento", async () => {
    h.rows.set(customers, [{ id: "c1", name: "João Silva", phone: "43999999999" }]);
    h.rows.set(
      // orders (último pedido) fornece o endereço padrão
      (await import("@/infra/db/schema")).orders,
      [{ id: "o1", addressSnapshot: { street: "Rua A", number: "10", complement: null, reference: null, neighborhood: "Zona 07", district: "Zona 07" } }],
    );
    await call({ token: validToken(), items });
    const text = wa.text.mock.calls[0][1] as string;
    expect(text).toContain("João");
    expect(text).toContain("Rua A, 10");
    expect(text).toMatch(/Pix, cartão ou na entrega/);
  });

  it("409 quando o link já foi usado (claim em conflito); nada é salvo nem enviado", async () => {
    h.rows.set(whatsappMessages, []);
    const res = await call({ token: validToken(), items });
    expect(res.status).toBe(409);
    expect(h.writes.find((w) => w.table === whatsappSessions)).toBeUndefined();
    expect(wa.text).not.toHaveBeenCalled();
  });

  it("422 para produto inexistente, sem queimar o link", async () => {
    const res = await call({ token: validToken(), items: [{ productId: "33333333-3333-4333-8333-333333333333", quantity: 1 }] });
    expect(res.status).toBe(422);
    expect(h.writes.find((w) => w.table === whatsappMessages)).toBeUndefined();
  });

  it("bot pausado (atendimento humano): salva o rascunho, mas não envia mensagem automática", async () => {
    h.rows.set(whatsappSessions, [{ botPausedUntil: new Date(Date.now() + 600_000) }]);
    const res = await call({ token: validToken(), items });
    expect(res.status).toBe(200);
    expect(wa.text).not.toHaveBeenCalled();
  });

  it("falha ao enviar o WhatsApp não derruba: ok:true com redirectUrl", async () => {
    wa.text.mockRejectedValueOnce(new Error("meta fora"));
    const res = await call({ token: validToken(), items });
    expect(res.status).toBe(200);
  });
});
