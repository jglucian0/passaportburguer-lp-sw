import { describe, expect, it } from "vitest";

import { computeBalance, expiryFrom, milesForOrder } from "./ledger";

const d = (iso: string) => new Date(iso);

describe("milesForOrder", () => {
  it("5 milhas por R$ 1 sobre os itens", () => {
    expect(milesForOrder(4999, 5)).toBe(249); // R$ 49,99 -> 249,95 -> 249
    expect(milesForOrder(10000, 5)).toBe(500);
  });
  it("sem valor ou sem regra, nada", () => {
    expect(milesForOrder(0, 5)).toBe(0);
    expect(milesForOrder(5000, 0)).toBe(0);
  });
});

describe("expiryFrom", () => {
  it("soma meses; 0 = sem validade", () => {
    expect(expiryFrom(d("2026-01-15T12:00:00Z"), 12)?.toISOString()).toBe("2027-01-15T12:00:00.000Z");
    expect(expiryFrom(d("2026-01-15T12:00:00Z"), 0)).toBeNull();
  });
});

describe("computeBalance", () => {
  const now = d("2026-11-18T12:00:00Z");

  it("soma créditos e débitos", () => {
    const b = computeBalance(
      [
        { miles: 500, createdAt: d("2026-10-01T00:00:00Z"), expiresAt: d("2027-10-01T00:00:00Z") },
        { miles: -200, createdAt: d("2026-10-10T00:00:00Z"), expiresAt: null },
      ],
      now,
    );
    expect(b.available).toBe(300);
  });

  it("milhas vencidas não contam", () => {
    const b = computeBalance(
      [
        { miles: 400, createdAt: d("2025-01-01T00:00:00Z"), expiresAt: d("2026-01-01T00:00:00Z") },
        { miles: 100, createdAt: d("2026-10-01T00:00:00Z"), expiresAt: d("2027-10-01T00:00:00Z") },
      ],
      now,
    );
    expect(b.available).toBe(100);
  });

  it("débito consome as milhas mais antigas primeiro (FIFO)", () => {
    const b = computeBalance(
      [
        { miles: 300, createdAt: d("2026-01-01T00:00:00Z"), expiresAt: d("2026-12-01T00:00:00Z") }, // vence em ~2 semanas
        { miles: 300, createdAt: d("2026-06-01T00:00:00Z"), expiresAt: d("2027-06-01T00:00:00Z") },
        { miles: -300, createdAt: d("2026-07-01T00:00:00Z"), expiresAt: null },
      ],
      now,
    );
    // o resgate usou o balde que venceria primeiro; sobra só o balde novo
    expect(b.available).toBe(300);
    expect(b.expiringSoon).toBe(0);
    expect(b.nextExpiry?.toISOString()).toBe("2027-06-01T00:00:00.000Z");
  });

  it("avisa o que vence nos próximos 30 dias", () => {
    const b = computeBalance(
      [{ miles: 250, createdAt: d("2025-12-01T00:00:00Z"), expiresAt: d("2026-12-01T00:00:00Z") }],
      now,
    );
    expect(b).toMatchObject({ available: 250, expiringSoon: 250 });
  });

  it("estorno maior que o saldo não deixa o saldo negativo", () => {
    const b = computeBalance(
      [
        { miles: 100, createdAt: d("2026-10-01T00:00:00Z"), expiresAt: null },
        { miles: -400, createdAt: d("2026-10-05T00:00:00Z"), expiresAt: null },
      ],
      now,
    );
    expect(b.available).toBe(0);
  });
});
