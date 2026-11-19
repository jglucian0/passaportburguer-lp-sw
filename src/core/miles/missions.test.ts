import { describe, expect, it } from "vitest";

import { missionProgress, periodRange } from "./missions";

describe("periodRange", () => {
  it("mês civil em horário de Brasília", () => {
    const r = periodRange("MONTH", new Date("2026-11-18T12:00:00Z"));
    expect(r.start.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-12-01T03:00:00.000Z");
    expect(r.key).toBe("2026-11");
  });

  it("virada de mês: 01h de 1º de dezembro em Brasília já é dezembro, 23h de 30/11 ainda é novembro", () => {
    expect(periodRange("MONTH", new Date("2026-12-01T04:00:00Z")).key).toBe("2026-12");
    expect(periodRange("MONTH", new Date("2026-12-01T02:30:00Z")).key).toBe("2026-11");
  });

  it("semana vai de segunda a domingo", () => {
    // 18/11/2026 é quarta-feira.
    const r = periodRange("WEEK", new Date("2026-11-18T12:00:00Z"));
    expect(r.start.toISOString()).toBe("2026-11-16T03:00:00.000Z"); // segunda 16/11 00h BRT
    expect(r.end.toISOString()).toBe("2026-11-23T03:00:00.000Z");
    // domingo à noite ainda é a mesma semana
    expect(periodRange("WEEK", new Date("2026-11-23T01:00:00Z")).key).toBe(r.key);
    expect(periodRange("WEEK", new Date("2026-11-23T04:00:00Z")).key).not.toBe(r.key);
  });
});

describe("missionProgress", () => {
  const now = new Date("2026-11-18T12:00:00Z");
  const rule = { period: "MONTH" as const, targetOrders: 3, minOrderCents: 5490 };

  it("conta só pedidos do período e acima do mínimo", () => {
    const p = missionProgress(
      rule,
      [
        { createdAt: new Date("2026-11-03T20:00:00Z"), itemsAfterDiscountCents: 6000 },
        { createdAt: new Date("2026-11-10T20:00:00Z"), itemsAfterDiscountCents: 5000 }, // abaixo do mínimo
        { createdAt: new Date("2026-10-30T20:00:00Z"), itemsAfterDiscountCents: 9000 }, // mês anterior
        { createdAt: new Date("2026-11-15T20:00:00Z"), itemsAfterDiscountCents: 5490 },
      ],
      now,
    );
    expect(p).toMatchObject({ done: 2, target: 3, completed: false });
  });

  it("cumprida ao bater a meta (e o progresso não passa da meta)", () => {
    const orders = [1, 2, 3, 4].map((d) => ({ createdAt: new Date(`2026-11-0${d}T20:00:00Z`), itemsAfterDiscountCents: 7000 }));
    expect(missionProgress(rule, orders, now)).toMatchObject({ done: 3, completed: true });
  });
});
