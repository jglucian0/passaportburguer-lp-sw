import { describe, expect, it } from "vitest";

import { classifyCustomer, pickFavorite } from "./segments";

const now = new Date("2026-11-18T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe("classifyCustomer", () => {
  it("nunca pediu", () => {
    expect(classifyCustomer({ orderCount: 0, firstOrderAt: null, lastOrderAt: null, recentOrderCount: 0 }, now).segment).toBe(
      "NEVER_ORDERED",
    );
  });

  it("1 pedido recente é NEW; 1 pedido há 25 dias é AT_RISK", () => {
    const base = { orderCount: 1, recentOrderCount: 1 };
    expect(classifyCustomer({ ...base, firstOrderAt: daysAgo(3), lastOrderAt: daysAgo(3) }, now).segment).toBe("NEW");
    expect(classifyCustomer({ ...base, firstOrderAt: daysAgo(25), lastOrderAt: daysAgo(25) }, now).segment).toBe("AT_RISK");
  });

  it("usa o intervalo habitual do cliente (pede a cada ~5 dias; 10 dias sem pedir = em risco)", () => {
    const stats = { orderCount: 5, firstOrderAt: daysAgo(30), lastOrderAt: daysAgo(10), recentOrderCount: 5 };
    const r = classifyCustomer(stats, now);
    expect(r.avgIntervalDays).toBeCloseTo(5);
    expect(r.segment).toBe("AT_RISK");
    expect(r.isFan).toBe(true); // fã sumido continua marcado como fã
  });

  it("ativo e fã: 4 pedidos em 60 dias e pedido recente", () => {
    const stats = { orderCount: 4, firstOrderAt: daysAgo(40), lastOrderAt: daysAgo(2), recentOrderCount: 4 };
    expect(classifyCustomer(stats, now)).toMatchObject({ segment: "ACTIVE", isFan: true });
  });

  it("perdido após 60+ dias", () => {
    const stats = { orderCount: 2, firstOrderAt: daysAgo(100), lastOrderAt: daysAgo(95), recentOrderCount: 0 };
    expect(classifyCustomer(stats, now)).toMatchObject({ segment: "LOST", isFan: false });
  });
});

describe("pickFavorite", () => {
  it("maior quantidade; empate fica com o mais recente", () => {
    const f = pickFavorite([
      { productId: "a", name: "Nova York", quantity: 3, lastOrderedAt: daysAgo(10) },
      { productId: "b", name: "Cidade do México", quantity: 3, lastOrderedAt: daysAgo(2) },
      { productId: "c", name: "Batata", quantity: 1, lastOrderedAt: daysAgo(1) },
    ]);
    expect(f?.name).toBe("Cidade do México");
  });
  it("sem itens => null", () => expect(pickFavorite([])).toBeNull());
});
