import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infra/payments/expire-orders", () => ({ expireAbandonedOrders: vi.fn(async () => 2) }));
vi.mock("@/infra/miles/reminders", () => ({ runMilesExpiryReminders: vi.fn(async () => ({ sent: 0, skipped: 0 })) }));
vi.mock("@/infra/miles/benefits", () => ({ issueMonthlyTierBenefits: vi.fn(async () => ({ issued: 0 })) }));

import { expireAbandonedOrders } from "@/infra/payments/expire-orders";

import { GET } from "./route";

const call = (headers: Record<string, string> = {}) =>
  GET(new Request("http://localhost/api/cron/expire-orders", { headers }) as never);

beforeEach(() => {
  vi.mocked(expireAbandonedOrders).mockClear();
  process.env.CRON_SECRET = "s3cret-s3cret-s3cret";
});

describe("GET /api/cron/expire-orders: autenticação", () => {
  it("401 sem Authorization", async () => {
    expect((await call()).status).toBe(401);
    expect(expireAbandonedOrders).not.toHaveBeenCalled();
  });

  it("401 com Bearer errado, sem esquema Bearer e com headers forjados", async () => {
    expect((await call({ authorization: "Bearer errado" })).status).toBe(401);
    expect((await call({ authorization: "s3cret-s3cret-s3cret" })).status).toBe(401);
    expect(
      (await call({ "x-vercel-cron": "1", "x-forwarded-for": "127.0.0.1", "x-real-ip": "127.0.0.1" })).status,
    ).toBe(401);
    expect(expireAbandonedOrders).not.toHaveBeenCalled();
  });

  it("401 quando CRON_SECRET não está configurado (rota desligada)", async () => {
    delete process.env.CRON_SECRET;
    expect((await call({ authorization: "Bearer " })).status).toBe(401);
    expect((await call({ authorization: "Bearer undefined" })).status).toBe(401);
  });

  it("200 com o Bearer correto", async () => {
    const res = await call({ authorization: "Bearer s3cret-s3cret-s3cret" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, expired: 2 });
  });
});
