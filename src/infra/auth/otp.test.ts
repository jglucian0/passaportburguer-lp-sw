import { describe, expect, it } from "vitest";

import { phoneVariants } from "./otp";

describe("phoneVariants", () => {
  it("sem o 9 gera também a forma com 9", () => {
    expect(phoneVariants("4396142131")).toEqual(["4396142131", "43996142131"]);
  });
  it("com o 9 gera também a forma sem 9", () => {
    expect(phoneVariants("43996142131")).toEqual(["43996142131", "4396142131"]);
  });
  it("fixo (10 dígitos começando em 2-5) não ganha 9", () => {
    expect(phoneVariants("4333221100")).toEqual(["4333221100"]);
  });
});
