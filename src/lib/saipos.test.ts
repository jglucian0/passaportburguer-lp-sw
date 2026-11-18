import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fake, type Query } from "@/test/fake-db";

vi.mock("@/infra/db", async () => (await import("@/test/fake-db")).makeDbModule());
vi.mock("@/infra/db/store-settings", () => ({ loadStoreSettings: async () => null }));

import { cancelOrderOnSaipos, sendOrderToSaipos } from "./saipos";

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

describe("cancelOrderOnSaipos", () => {
  const reply = (cancel: Response) =>
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).endsWith("/auth") ? Response.json({ token: "tok", expires_in: 3600 }) : cancel,
    );

  it("POST /cancel-order com order_id e cod_store; { status: true } => ok", async () => {
    reply(Response.json({ status: true }));
    expect(await cancelOrderOnSaipos("sp-1")).toEqual({ ok: true });
    const call = vi.mocked(fetch).mock.calls.find(([u]) => String(u).endsWith("/cancel-order"))!;
    expect(call[1]).toMatchObject({ method: "POST", headers: expect.objectContaining({ Authorization: "tok" }) });
    expect(JSON.parse(String(call[1]!.body))).toEqual({ order_id: "sp-1", cod_store: "1" });
  });

  it("HTTP 400 ou status:false => ok:false (cai em ação manual)", async () => {
    reply(Response.json({}, { status: 400 }));
    expect(await cancelOrderOnSaipos("sp-1")).toMatchObject({ ok: false });
    reply(Response.json({ status: false }));
    expect(await cancelOrderOnSaipos("sp-1")).toMatchObject({ ok: false });
  });

  it("sem configuração do Saipos => unsupported, sem chamada de rede", async () => {
    vi.stubEnv("SAIPOS_PARTNER_ID", "");
    expect(await cancelOrderOnSaipos("sp-1")).toMatchObject({ ok: false, unsupported: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});
