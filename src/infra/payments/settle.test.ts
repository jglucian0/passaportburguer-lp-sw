import { beforeEach, describe, expect, it, vi } from "vitest";
import { after } from "next/server";

import { fake, type Query } from "@/test/fake-db";

vi.mock("@/infra/db", async () => (await import("@/test/fake-db")).makeDbModule());
vi.mock("@/infra/db/store-settings", () => ({ loadStoreSettings: async () => ({ autoAcceptOrders: false }) }));
vi.mock("@/lib/saipos", () => ({ sendOrderToSaipos: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));

import { sendOrderToSaipos } from "@/lib/saipos";

import { settlePayment } from "./settle";

const opts = { paymentId: "p1", orderId: "o1", tenantId: "t1", paidCents: 4590, status: "CONFIRMED" as const };

beforeEach(() => {
  fake.reset();
  vi.mocked(sendOrderToSaipos).mockClear();
  // `after` real agenda para depois da resposta; aqui executa na hora para contar os envios.
  vi.mocked(after).mockReset();
  vi.mocked(after).mockImplementation(((fn: () => unknown) => void fn()) as never);
});

describe("disparo único para a Saipos", () => {
  it("libera via UPDATE condicional dentro do lote atômico", async () => {
    fake.handler = (q: Query) => (q.kind === "update" && q.table === "orders" ? [{ id: "o1" }] : []);
    await settlePayment(opts);
    const ord = fake.batches[0].find((q) => q.table === "orders")!;
    expect(ord.set).toMatchObject({ status: "RECEIVED" });
  });

  it("resposta síncrona + PAYMENT_CONFIRMED + PAYMENT_RECEIVED: Saipos é chamada uma única vez", async () => {
    // O banco só deixa UM UPDATE casar em AWAITING_PAYMENT; os seguintes retornam 0 linhas.
    let awaiting = true;
    fake.handler = (q: Query) => {
      if (q.kind === "update" && q.table === "orders") {
        if (!awaiting) return [];
        awaiting = false;
        return [{ id: "o1" }];
      }
      return [];
    };
    const a = await settlePayment(opts);
    const b = await settlePayment(opts);
    const c = await settlePayment({ ...opts, status: "RECEIVED" });
    expect([a.released, b.released, c.released]).toEqual([true, false, false]);
    expect(sendOrderToSaipos).toHaveBeenCalledTimes(1);
    expect(sendOrderToSaipos).toHaveBeenCalledWith("o1");
  });

  it("chamadas concorrentes: só a que vence a condição dispara", async () => {
    let awaiting = true;
    fake.handler = (q: Query) => {
      if (q.kind === "update" && q.table === "orders") {
        const won = awaiting;
        awaiting = false;
        return won ? [{ id: "o1" }] : [];
      }
      return [];
    };
    const results = await Promise.all(Array.from({ length: 5 }, () => settlePayment(opts)));
    expect(results.filter((r) => r.released)).toHaveLength(1);
    expect(sendOrderToSaipos).toHaveBeenCalledTimes(1);
  });
});
