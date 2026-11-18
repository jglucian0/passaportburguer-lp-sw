import { beforeEach, describe, expect, it, vi } from "vitest";

let session: { tenantId: string; role: string } | null = { tenantId: "t1", role: "KITCHEN" };
let allowed = true;

vi.mock("@/infra/auth/active-session", () => ({ getActiveAdminSession: async () => session }));
vi.mock("@/infra/db/admin-orders", () => ({ loadAdminOrders: vi.fn(async () => []) }));
vi.mock("@/infra/payments/expire-orders", () => ({ expireAbandonedOrders: vi.fn(async () => 0) }));
vi.mock("@/infra/security/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed, remaining: 0, retryAfterSeconds: 1 })),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: (fn: () => unknown) => void fn() }));

import { expireAbandonedOrders } from "@/infra/payments/expire-orders";

import { GET } from "./route";

beforeEach(() => {
  session = { tenantId: "t1", role: "KITCHEN" };
  allowed = true;
  vi.mocked(expireAbandonedOrders).mockClear();
});

describe("GET /api/admin/orders", () => {
  it("401 sem sessão e 403 para papel não operacional (nada é varrido)", async () => {
    session = null;
    expect((await GET()).status).toBe(401);
    session = { tenantId: "t1", role: "CUSTOMER" };
    expect((await GET()).status).toBe(403);
    expect(expireAbandonedOrders).not.toHaveBeenCalled();
  });

  it("o KDS aberto dispara a expiração dos pedidos abandonados da própria loja", async () => {
    expect((await GET()).status).toBe(200);
    expect(expireAbandonedOrders).toHaveBeenCalledWith({ tenantId: "t1" });
  });

  it("a varredura é limitada (throttle): sem permissão do limitador, não roda", async () => {
    allowed = false;
    expect((await GET()).status).toBe(200);
    expect(expireAbandonedOrders).not.toHaveBeenCalled();
  });
});
