import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  order: null as null | { tenantId: string; status: string; paymentMethod: string; totalCents: number },
  batches: 0,
}));

vi.mock("@/infra/db", () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    select: self, from: self, where: self, set: self, values: self, returning: self,
    onConflictDoNothing: self,
    update: self, insert: self,
    limit: async () => (state.order ? [state.order] : []),
  });
  return {
    db: Object.assign(chain, {
      batch: async () => {
        state.batches++;
        return [[{ id: "o" }], []];
      },
    }),
  };
});
vi.mock("@/infra/db/store-settings", () => ({ loadStoreSettings: async () => ({ autoAcceptOrders: false }) }));
vi.mock("@/lib/saipos", () => ({ sendOrderToSaipos: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));

import { POST } from "./route";

const SECRET = "pix-secret";
const ORDER_ID = "7b0f6e0a-6a56-4d52-9a39-0c7a2b6a1f11";

function req(payload: object, signature?: string) {
  const raw = JSON.stringify(payload);
  const sig = signature ?? `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;
  return new Request("http://localhost/api/webhooks/pix", {
    method: "POST",
    body: raw,
    headers: { "x-signature": sig },
  }) as never;
}

const evt = { eventId: "e1", orderId: ORDER_ID, amountCents: 5000, status: "PAID" };

describe("POST /api/webhooks/pix", () => {
  beforeEach(() => {
    state.order = { tenantId: "t", status: "AWAITING_PAYMENT", paymentMethod: "PIX", totalCents: 5000 };
    state.batches = 0;
    vi.stubEnv("PIX_WEBHOOK_SECRET", SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("401 com assinatura inválida", async () => {
    expect((await POST(req(evt, "sha256=" + "0".repeat(64)))).status).toBe(401);
    expect(state.batches).toBe(0);
  });

  it("503 sem segredo configurado", async () => {
    vi.stubEnv("PIX_WEBHOOK_SECRET", "");
    expect((await POST(req(evt))).status).toBe(503);
  });

  it("422 quando o valor diverge do pedido", async () => {
    expect((await POST(req({ ...evt, amountCents: 1 }))).status).toBe(422);
    expect(state.batches).toBe(0);
  });

  it("não reprocessa pedido que não está aguardando pagamento", async () => {
    state.order!.status = "RECEIVED";
    const res = await POST(req(evt));
    expect(await res.json()).toMatchObject({ updated: 0 });
    expect(state.batches).toBe(0);
  });

  it("confirma o pagamento válido", async () => {
    const res = await POST(req(evt));
    expect(await res.json()).toMatchObject({ ok: true, updated: 1 });
    expect(state.batches).toBe(1);
  });
});
