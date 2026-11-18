import { beforeEach, describe, expect, it, vi } from "vitest";

import { fake, type Query } from "@/test/fake-db";

let session: { customerId: string; tenantId: string } | null = { customerId: "attacker", tenantId: "t1" };

vi.mock("@/infra/db", async () => (await import("@/test/fake-db")).makeDbModule());
vi.mock("@/infra/auth/customer-session", () => ({
  getAuthSession: async () => session,
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
  createPixCharge: vi.fn(),
  createCreditCardCharge: vi.fn(),
}));

import { createCreditCardCharge, createPixCharge } from "@/infra/payments/asaas";

import { GET, POST } from "./route";

const VICTIM_ORDER = "7b0f6e0a-6a56-4d52-9a39-0c7a2b6a1f11";
const ctx = (orderId: string) => ({ params: Promise.resolve({ orderId }) });

beforeEach(() => {
  fake.reset();
  session = { customerId: "attacker", tenantId: "t1" };
  vi.mocked(createPixCharge).mockClear();
  vi.mocked(createCreditCardCharge).mockClear();
  // O WHERE exige o dono do pedido: para o atacante o banco não devolve nenhuma linha.
  fake.handler = (_q: Query) => [];
});

describe("IDOR em /api/orders/[orderId]/payment", () => {
  it("GET com UUID de pedido de outro cliente => 404, sem vazar status", async () => {
    const res = await GET(new Request("http://x/") as never, ctx(VICTIM_ORDER));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Pedido não encontrado." });
  });

  it("POST em pedido alheio => 404 e NENHUMA cobrança é criada", async () => {
    for (const body of [{ mode: "pix" }, { mode: "hosted" }]) {
      const res = await POST(
        new Request("http://x/", { method: "POST", body: JSON.stringify(body) }) as never,
        ctx(VICTIM_ORDER),
      );
      expect(res.status).toBe(404);
    }
    expect(createPixCharge).not.toHaveBeenCalled();
    expect(createCreditCardCharge).not.toHaveBeenCalled();
  });

  it("UUID malformado => 404 sem tocar no banco", async () => {
    const res = await GET(new Request("http://x/") as never, ctx("1' OR '1'='1"));
    expect(res.status).toBe(404);
    expect(fake.queries.length).toBe(0);
  });

  it("sem sessão => 401 em GET e POST", async () => {
    session = null;
    expect((await GET(new Request("http://x/") as never, ctx(VICTIM_ORDER))).status).toBe(401);
    const post = await POST(new Request("http://x/", { method: "POST", body: "{}" }) as never, ctx(VICTIM_ORDER));
    expect(post.status).toBe(401);
  });
});
