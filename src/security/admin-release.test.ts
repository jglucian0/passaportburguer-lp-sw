import { beforeEach, describe, expect, it, vi } from "vitest";

import { fake, type Query } from "@/test/fake-db";

let role: "OWNER" | "KITCHEN" = "KITCHEN";
const ORDER = "7b0f6e0a-6a56-4d52-9a39-0c7a2b6a1f11";
let order: Record<string, unknown>;

vi.mock("@/infra/db", async () => (await import("@/test/fake-db")).makeDbModule());
vi.mock("@/infra/auth/active-session", () => ({
  getActiveAdminSession: async () => ({ userId: "u1", tenantId: "t1", name: "Op", role }),
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/saipos", () => ({ sendOrderToSaipos: vi.fn() }));
vi.mock("@/infra/payments/asaas", () => ({ cancelPendingCharges: vi.fn(async () => ({ blocked: null })) }));

import { advanceOrder } from "@/actions/admin";
import { sendOrderToSaipos } from "@/lib/saipos";

beforeEach(() => {
  fake.reset();
  vi.mocked(sendOrderToSaipos).mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  order = { id: ORDER, status: "AWAITING_PAYMENT", deliveryType: "PICKUP", paymentMethod: "PIX" };
  fake.handler = (q: Query) => {
    if (q.kind === "select" && q.table === "orders") return [order];
    if (q.kind === "update" && q.table === "orders") return [{ id: ORDER }];
    return [];
  };
});

const orderUpdates = () => fake.queries.filter((q) => q.kind === "update" && q.table === "orders");

describe("fraude interna: liberação manual de pedido online", () => {
  it("KITCHEN NÃO libera Pix em AWAITING_PAYMENT (sem update, sem Saipos)", async () => {
    role = "KITCHEN";
    const res = await advanceOrder({ orderId: ORDER });
    expect(res.ok).toBe(false);
    expect(orderUpdates()).toHaveLength(0);
    expect(sendOrderToSaipos).not.toHaveBeenCalled();
  });

  it("ninguém (nem OWNER) libera à mão pedido de cartão online: só o gateway", async () => {
    role = "OWNER";
    order.paymentMethod = "CREDIT_CARD";
    const res = await advanceOrder({ orderId: ORDER });
    expect(res.ok).toBe(false);
    expect(orderUpdates()).toHaveLength(0);
    expect(sendOrderToSaipos).not.toHaveBeenCalled();
  });

  it("OWNER libera Pix com trilha de auditoria durável (payment_events) e cancela a cobrança pendente", async () => {
    role = "OWNER";
    const res = await advanceOrder({ orderId: ORDER });
    expect(res.ok).toBe(true);
    const audit = fake.queries.find((q) => q.kind === "insert" && q.table === "payment_events");
    expect(audit?.values).toMatchObject({ orderId: ORDER });
    expect(String(audit?.values?.eventType)).toContain("MANUAL_RELEASE_BY_OWNER:u1");
    expect(sendOrderToSaipos).toHaveBeenCalledTimes(1);
  });

  it("pedido presencial (dinheiro) avança normalmente para KITCHEN, sem trilha de liberação", async () => {
    role = "KITCHEN";
    order = { ...order, status: "RECEIVED", paymentMethod: "CASH" };
    const res = await advanceOrder({ orderId: ORDER });
    expect(res.ok).toBe(true);
    expect(fake.queries.some((q) => q.table === "payment_events")).toBe(false);
  });
});
