import { beforeEach, describe, expect, it, vi } from "vitest";

import { fake, type Query } from "@/test/fake-db";

vi.mock("@/infra/db", async () => (await import("@/test/fake-db")).makeDbModule());
vi.mock("@/infra/db/store-settings", () => ({ loadStoreSettings: async () => ({ autoAcceptOrders: false }) }));
vi.mock("@/lib/saipos", () => ({ sendOrderToSaipos: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));

import { expireAbandonedOrders } from "./expire-orders";

type Call = { method: string; url: string };
let calls: Call[];
let remoteStatus: string;

beforeEach(() => {
  fake.reset();
  calls = [];
  remoteStatus = "PENDING";
  vi.stubEnv("ASAAS_API_URL", "https://api-sandbox.asaas.com/v3");
  vi.stubEnv("ASAAS_API_KEY", "k");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const method = init.method ?? "GET";
      calls.push({ method, url });
      // Cobrança que ainda está PENDING no Asaas aceita o DELETE; a já paga recusa (400).
      if (method === "DELETE" && remoteStatus !== "PENDING") {
        return { ok: false, status: 400, json: async () => ({ errors: [{ code: "x" }] }) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "pay_1", status: remoteStatus, value: 45.9 }),
      } as Response;
    }),
  );
  fake.handler = (q: Query) => {
    if (q.kind === "select" && q.table === "orders" && q.joins.length === 0 && q.values === undefined) {
      // candidatos à expiração OU dados do pedido para o settle
      return [{ id: "o1", tenantId: "t1", totalCents: 4590 }];
    }
    if (q.kind === "select" && q.table === "payments") return [{ id: "p1", providerPaymentId: "pay_1" }];
    if (q.kind === "update" && q.table === "orders") return [{ id: "o1" }];
    return [];
  };
});

const canceledOrderUpdate = () =>
  fake.queries.find((q) => q.kind === "update" && q.table === "orders" && q.set?.status === "CANCELED");

describe("cron de expiração: cobrança é invalidada no Asaas antes de cancelar", () => {
  it("PENDING no Asaas: faz DELETE, marca o pagamento CANCELLED e só então cancela o pedido", async () => {
    const expired = await expireAbandonedOrders();
    expect(expired).toBe(1);
    const del = calls.findIndex((c) => c.method === "DELETE");
    expect(calls[del].url).toContain("/payments/pay_1");
    const paymentCancelled = fake.queries.findIndex(
      (q) => q.kind === "update" && q.table === "payments" && q.set?.status === "CANCELLED",
    );
    const orderCanceled = fake.queries.findIndex(
      (q) => q.kind === "update" && q.table === "orders" && q.set?.status === "CANCELED",
    );
    expect(paymentCancelled).toBeGreaterThan(-1);
    expect(orderCanceled).toBeGreaterThan(paymentCancelled);
    expect(canceledOrderUpdate()?.set).toMatchObject({ cancelReason: "Pagamento não confirmado em 30 minutos." });
  });

  it.each(["CONFIRMED", "RECEIVED"])(
    "já %s no Asaas (DELETE recusado): efetiva a aprovação e NÃO cancela o pedido",
    async (status) => {
      remoteStatus = status;
      const expired = await expireAbandonedOrders();
      expect(expired).toBe(0);
      expect(canceledOrderUpdate()).toBeUndefined();
      // pedido liberado e pagamento sincronizado no lote atômico
      const [payment, ord] = fake.batches[0];
      expect(payment.set).toMatchObject({ status });
      expect(ord.set).toMatchObject({ status: "RECEIVED" });
    },
  );

  it("cobrança que não pode ser verificada/invalidada: pedido não é cancelado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    remoteStatus = "PENDING";
    vi.mocked(fetch).mockImplementation((async (_url: string, init: RequestInit) => {
      void init;
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    }) as never);
    expect(await expireAbandonedOrders()).toBe(0);
    expect(canceledOrderUpdate()).toBeUndefined();
  });
});
