import { describe, expect, it } from "vitest";

import {
  couponCodeFor,
  DEFAULT_MARKETING_CONFIG,
  formatCouponDeadline,
  isWithinSendHours,
  pickDiscountPercent,
  winbackMessage,
} from "./campaign";

const cfg = { ...DEFAULT_MARKETING_CONFIG, discountMinPercent: 5, discountMaxPercent: 15, fanBonusPercent: 5 };

describe("pickDiscountPercent", () => {
  it("sorteia dentro de [min, max]", () => {
    expect(pickDiscountPercent(cfg, false, () => 0)).toBe(5);
    expect(pickDiscountPercent(cfg, false, () => 0.999999)).toBe(15);
    for (let i = 0; i < 200; i++) {
      const p = pickDiscountPercent(cfg, false);
      expect(p).toBeGreaterThanOrEqual(5);
      expect(p).toBeLessThanOrEqual(15);
    }
  });
  it("fã ganha bônus, mas nunca passa do máximo", () => {
    expect(pickDiscountPercent(cfg, true, () => 0)).toBe(10);
    expect(pickDiscountPercent(cfg, true, () => 0.999999)).toBe(15);
  });
  it("min == max devolve o valor fixo", () => {
    expect(pickDiscountPercent({ ...cfg, discountMinPercent: 10, discountMaxPercent: 10, fanBonusPercent: 0 }, false)).toBe(10);
  });
});

describe("isWithinSendHours", () => {
  it("10h às 21h", () => {
    expect(isWithinSendHours(9, cfg)).toBe(false);
    expect(isWithinSendHours(10, cfg)).toBe(true);
    expect(isWithinSendHours(20, cfg)).toBe(true);
    expect(isWithinSendHours(21, cfg)).toBe(false);
  });
});

describe("couponCodeFor / textos", () => {
  it("código pessoal por perfil", () => {
    expect(couponCodeFor(false)).toMatch(/^VOLTA-[A-Z2-9]{5}$/);
    expect(couponCodeFor(true)).toMatch(/^FAMILIA-[A-Z2-9]{5}$/);
  });
  it("prazo em horário de Brasília", () => {
    expect(formatCouponDeadline(new Date("2026-11-19T00:00:00Z"))).toBe("quarta, 18/11 às 21h");
  });
  it("mensagem cita nome, desconto e prazo; fã é tratado como da família", () => {
    const base = { firstName: "Joao", favoriteName: "Nova York", percent: 12, deadline: "quinta, 19/11 às 21h" };
    for (const v of [0, 1]) {
      const normal = winbackMessage({ ...base, isFan: false }, v);
      expect(normal).toContain("Joao");
      expect(normal).toContain("12%");
      expect(normal).toContain("quinta, 19/11 às 21h");
      expect(normal).not.toContain("família");
      expect(winbackMessage({ ...base, isFan: true }, v)).toContain("família");
    }
  });
  it("sem lanche favorito não gera frase quebrada", () => {
    const text = winbackMessage({ firstName: "Ana", favoriteName: null, percent: 8, deadline: "hoje", isFan: false }, 0);
    expect(text).toContain("de um burger");
    expect(text).not.toContain("null");
  });
});
