import { describe, expect, it } from "vitest";

import { getBrazilianPhoneVariants } from "./phone";

describe("getBrazilianPhoneVariants", () => {
  it("wa_id com 9º dígito: devolve as 4 variações (DDI/sem DDI x com/sem 9º dígito)", () => {
    expect([...getBrazilianPhoneVariants("5543996098333")].sort()).toEqual(
      ["5543996098333", "554396098333", "43996098333", "4396098333"].sort(),
    );
  });

  it("wa_id SEM 9º dígito (como a Meta entrega) também chega ao número com 9º dígito", () => {
    const v = getBrazilianPhoneVariants("554396098333");
    expect(v).toContain("5543996098333");
    expect(v).toContain("43996098333");
    expect(v).toContain("4396098333");
    expect(v).toContain("554396098333");
  });

  it("aceita número local formatado e ignora pontuação", () => {
    const v = getBrazilianPhoneVariants("+55 (43) 99609-8333");
    expect(v).toContain("554396098333");
    expect(v).toContain("43996098333");
    expect(getBrazilianPhoneVariants("(43) 99609-8333")).toContain("4396098333");
  });

  it("sem duplicatas", () => {
    const v = getBrazilianPhoneVariants("5543996098333");
    expect(new Set(v).size).toBe(v.length);
  });

  it("fixo (8 dígitos começando em 2-5) não ganha 9º dígito", () => {
    expect(getBrazilianPhoneVariants("554432221111").sort()).toEqual(["554432221111", "4432221111"].sort());
  });

  it("número não brasileiro ou vazio não inventa variações", () => {
    expect(getBrazilianPhoneVariants("447911123456")).toEqual(["447911123456"]);
    expect(getBrazilianPhoneVariants("")).toEqual([]);
    expect(getBrazilianPhoneVariants("abc")).toEqual([]);
  });
});
