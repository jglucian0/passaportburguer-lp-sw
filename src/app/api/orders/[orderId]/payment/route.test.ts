import { beforeEach, describe, expect, it, vi } from "vitest";

import { fake, type Query } from "@/test/fake-db";

vi.mock("@/infra/db", async () => (await import("@/test/fake-db")).makeDbModule());
vi.mock("@/infra/auth/customer-session", () => ({
  getAuthSession: async () => ({ customerId: "c1", tenantId: "t1" }),
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
  createPixCharge: vi.fn(async () => ({
    pixPayload: "PAYLOAD",
    pixQrCodeBase64: "IMG",
    pixExpirationDate: null,
  })),
  createCreditCardCharge: vi.fn(async () => ({ status: "PENDING", released: false })),
}));

import { createCreditCardCharge, createPixCharge } from "@/infra/payments/asaas";

import { POST } from "./route";

const ORDER_ID = "7b0f6e0a-6a56-4d52-9a39-0c7a2b6a1f11";
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

let orderRow: Record<string, unknown>;
let history: { status: string; method: string }[];

function call(body: unknown) {
  return POST(
    new Request("http://localhost/api/orders/x/payment", { method: "POST", body: JSON.stringify(body) }) as never,
    { params: Promise.resolve({ orderId: ORDER_ID }) },
  );
}

beforeEach(() => {
  fake.reset();
  vi.mocked(createPixCharge).mockClear();
  vi.mocked(createCreditCardCharge).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  orderRow = {
    id: ORDER_ID,
    tenantId: "t1",
    customerId: "c1",
    status: "AWAITING_PAYMENT",
    paymentMethod: "CREDIT_CARD",
    totalCents: 4590,
    documentNumber: "52998224725",
  };
  history = [];
  fake.handler = (q: Query) => {
    if (q.kind === "select" && q.table === "orders") return [orderRow];
    if (q.kind === "select" && q.table === "payments") return history;
    if (q.kind === "select" && q.table === "customers") return [{ id: "c1", name: "Maria", phone: "44999998888" }];
    if (q.kind === "update" && q.table === "orders") return [{ id: ORDER_ID }];
    return [];
  };
});

describe("POST /api/orders/[id]/payment: proteções de produção", () => {
  it("409 'Este pedido já foi pago' quando há pagamento CONFIRMED/RECEIVED (sem nova cobrança)", async () => {
    for (const status of ["CONFIRMED", "RECEIVED"]) {
      history = [{ status, method: "CREDIT_CARD" }];
      orderRow.status = "RECEIVED"; // já liberado
      const res = await call({ mode: "card", card });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("Este pedido já foi pago.");
    }
    expect(createCreditCardCharge).not.toHaveBeenCalled();
    expect(createPixCharge).not.toHaveBeenCalled();
  });

  it("bloqueia o cartão com 429 após 5 tentativas FAILED e sugere Pix/WhatsApp", async () => {
    history = Array.from({ length: 5 }, () => ({ status: "FAILED", method: "CREDIT_CARD" }));
    const res = await call({ mode: "card", card });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/Pix.*WhatsApp/);
    expect(createCreditCardCharge).not.toHaveBeenCalled();
  });

  it("com 4 tentativas FAILED ainda permite a 5ª; falhas de Pix não contam", async () => {
    history = [
      ...Array.from({ length: 4 }, () => ({ status: "FAILED", method: "CREDIT_CARD" })),
      ...Array.from({ length: 3 }, () => ({ status: "FAILED", method: "PIX" })),
    ];
    const res = await call({ mode: "card", card });
    expect(res.status).toBe(202);
    expect(createCreditCardCharge).toHaveBeenCalledTimes(1);
  });

  it("depois do limite de cartão o cliente ainda consegue pagar via Pix", async () => {
    history = Array.from({ length: 5 }, () => ({ status: "FAILED", method: "CREDIT_CARD" }));
    const res = await call({ mode: "pix" });
    expect(res.status).toBe(200);
    expect(createPixCharge).toHaveBeenCalledTimes(1);
  });
});
