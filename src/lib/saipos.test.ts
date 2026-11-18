import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fake, type Query } from "@/test/fake-db";

vi.mock("@/infra/db", async () => (await import("@/test/fake-db")).makeDbModule());
vi.mock("@/infra/db/store-settings", () => ({ loadStoreSettings: async () => null }));

import { sendOrderToSaipos } from "./saipos";

let orderStatus: string;

beforeEach(() => {
  fake.reset();
  vi.stubEnv("SAIPOS_PARTNER_ID", "p");
  vi.stubEnv("SAIPOS_SECRET", "s");
  vi.stubEnv("SAIPOS_STORE_ID", "1");
  vi.stubGlobal("fetch", vi.fn());
  fake.handler = (q: Query) =>
    q.kind === "select" ? [{ status: "PENDING", saiposOrderId: null, orderStatus }] : [];
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("trava final do Saipos", () => {
  it.each(["AWAITING_PAYMENT", "CANCELED"])("pedido %s nunca é enviado", async (status) => {
    orderStatus = status;
    const result = await sendOrderToSaipos("o1");
    expect(result).toMatchObject({ ok: false, skipped: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});
