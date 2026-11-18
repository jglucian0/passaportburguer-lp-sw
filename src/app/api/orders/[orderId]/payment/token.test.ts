import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fake, type Query } from "@/test/fake-db";

/* Aba anônima / WebView do WhatsApp: SEM cookie de sessão. */
vi.mock("@/infra/db", async () => (await import("@/test/fake-db")).makeDbModule());
vi.mock("@/infra/auth/customer-session", () => ({
  getAuthSession: async () => null,
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));
vi.mock("@/infra/security/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 }),
  getClientIp: () => "203.0.113.9",
  tooManyRequests: () => new Response(null, { status: 429 }),
}));
vi.mock("@/infra/payments/expire-orders", () => ({ expireAbandonedOrders: vi.fn() }));
vi.mock("@/infra/payments/asaas", () => ({
  AsaasError: class extends Error {},
  PaymentConflictError: class extends Error {},
  createPixCharge: vi.fn(async () => ({ pixPayload: "PAYLOAD", pixQrCodeBase64: "IMG", pixExpirationDate: null })),
  createCreditCardCharge: vi.fn(async () => ({ status: "PENDING", released: false })),
}));

import { createCreditCardCharge, createPixCharge } from "@/infra/payments/asaas";
import { signWhatsAppToken } from "@/infra/whatsapp/session-token";

import { GET, POST } from "./route";

const ORDER_ID = "7b0f6e0a-6a56-4d52-9a39-0c7a2b6a1f11";
const OTHER_ORDER = "11111111-1111-4111-8111-111111111111";
const PHONE = "5544999998888";
const url = (token?: string) => `http://localhost/api/orders/${ORDER_ID}/payment${token ? `?token=${encodeURIComponent(token)}` : ""}`;
const ctx = { params: Promise.resolve({ orderId: ORDER_ID }) };
const tokenFor = (over: { orderId?: string; phone?: string; purpose?: "ORDER_PAYMENT" | "QUICK_MENU" } = {}, minutes = 120) =>
  signWhatsAppToken(
    { orderId: over.orderId ?? ORDER_ID, phone: over.phone ?? PHONE, purpose: over.purpose ?? "ORDER_PAYMENT" },
    minutes,
  );
const get = (token?: string, headers: Record<string, string> = {}) => GET(new Request(url(token), { headers }) as never, ctx);
const post = (body: unknown, token?: string) =>
  POST(new Request(url(token), { method: "POST", body: JSON.stringify(body) }) as never, ctx);

const card = {
  holderName: "MARIA S SILVA",
  number: "4111111111111111",
  expiryMonth: "12",
  expiryYear: String(new Date().getFullYear() + 3),
  ccv: "123",
  holderCpfCnpj: "52998224725",
  postalCode: "87020025",
  addressNumber: "100",
  email: "m@x.com",
};

beforeEach(() => {
  process.env.WHATSAPP_SESSION_SECRET = "test-secret-with-enough-length";
  fake.reset();
  vi.mocked(createPixCharge).mockClear();
  vi.mocked(createCreditCardCharge).mockClear();
  fake.handler = (q: Query) => {
    if (q.kind === "select" && q.table === "orders")
      return [
        {
          id: ORDER_ID,
          tenantId: "t1",
          customerId: "c1",
          status: "AWAITING_PAYMENT",
          paymentMethod: "CREDIT_CARD",
          totalCents: 4590,
          documentNumber: "52998224725",
          deliveryType: "DELIVERY",
          addressSnapshot: { street: "Rua das Flores", number: "123", neighborhood: "Zona 07", complement: "ap 4" },
        },
      ];
    if (q.kind === "select" && q.table === "customers")
      return [{ id: "c1", name: "Maria da Silva", phone: "44999998888", email: "maria@x.com", documentNumber: "52998224725" }];
    if (q.kind === "select" && q.table === "order_items") return [{ productNameSnapshot: "Nova York", quantity: 2 }];
    if (q.kind === "select" && q.table === "payments") return [];
    if (q.kind === "update" && q.table === "orders") return [{ id: ORDER_ID }];
    return [];
  };
});
afterEach(() => vi.useRealTimers());

describe("pagamento por token assinado (sem sessão)", () => {
  it("GET com token ORDER_PAYMENT válido do próprio pedido => 200", async () => {
    const res = await get(tokenFor());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ orderStatus: "AWAITING_PAYMENT" });
  });

  it("o token também vale no header x-order-token", async () => {
    const res = await get(undefined, { "x-order-token": tokenFor() });
    expect(res.status).toBe(200);
  });

  it("POST Pix e POST cartão com token válido funcionam sem cookie", async () => {
    expect((await post({ mode: "pix" }, tokenFor())).status).toBe(200);
    expect(createPixCharge).toHaveBeenCalledTimes(1);
    expect((await post({ mode: "card", card }, tokenFor())).status).toBe(202);
    expect(createCreditCardCharge).toHaveBeenCalledTimes(1);
  });

  it("sem sessão e sem token => 401", async () => {
    expect((await get()).status).toBe(401);
    expect((await post({ mode: "pix" })).status).toBe(401);
    expect(createPixCharge).not.toHaveBeenCalled();
  });

  it("token expirado => 403 e nenhuma cobrança", async () => {
    vi.useFakeTimers();
    const token = tokenFor({}, 120);
    vi.advanceTimersByTime(121 * 60_000);
    expect((await get(token)).status).toBe(403);
    expect((await post({ mode: "card", card }, token)).status).toBe(403);
    expect(createCreditCardCharge).not.toHaveBeenCalled();
  });

  it("o token vale 2 horas: ainda funciona aos 119 min", async () => {
    vi.useFakeTimers();
    const token = tokenFor({}, 120);
    vi.advanceTimersByTime(119 * 60_000);
    expect((await get(token)).status).toBe(200);
  });

  it("token de OUTRO pedido => 403 (sem cobrança)", async () => {
    const stolen = tokenFor({ orderId: OTHER_ORDER });
    expect((await get(stolen)).status).toBe(403);
    expect((await post({ mode: "pix" }, stolen)).status).toBe(403);
    expect(createPixCharge).not.toHaveBeenCalled();
  });

  it("token com outro propósito (Cardápio Rápido) ou lixo => 403", async () => {
    expect((await get(tokenFor({ purpose: "QUICK_MENU" }))).status).toBe(403);
    expect((await get("lixo.lixo")).status).toBe(403);
    expect((await get(`${tokenFor()}x`)).status).toBe(403);
  });

  it("token de telefone que não é o dono do pedido => 403", async () => {
    expect((await get(tokenFor({ phone: "5544911112222" }))).status).toBe(403);
    expect(createPixCharge).not.toHaveBeenCalled();
  });

  it("pedido inexistente com token válido => 404", async () => {
    fake.handler = () => [];
    expect((await get(tokenFor())).status).toBe(404);
  });
});

describe("LGPD: via token a resposta é mascarada", () => {
  it("GET devolve só primeiro nome, itens, total e endereço resumido, sem CPF/e-mail/telefone/número", async () => {
    const res = await get(tokenFor());
    const body = await res.json();
    expect(body.summary).toEqual({
      firstName: "Maria",
      items: [{ name: "Nova York", quantity: 2 }],
      totalCents: 4590,
      addressSummary: "Rua das Flores - Zona 07",
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain("52998224725");
    expect(text).not.toContain("maria@x.com");
    expect(text).not.toContain("44999998888");
    expect(text).not.toContain("Silva");
    expect(text).not.toContain("123");
    expect(text).not.toContain("ap 4");
  });

  it("POST (Pix) também não devolve dados pessoais", async () => {
    const text = JSON.stringify(await (await post({ mode: "pix" }, tokenFor())).json());
    expect(text).not.toContain("52998224725");
    expect(text).not.toContain("maria@x.com");
  });
});
