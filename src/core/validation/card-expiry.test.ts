import { describe, expect, it } from "vitest";

import { cardDataSchema } from "../schemas/payment";
import { validateCardExpiry } from "./card-expiry";

// Hoje fixo: 18/11/2026.
const NOW = new Date(2026, 10, 18);
const reasonOf = (v: string) => {
  const r = validateCardExpiry(v, NOW);
  return r.valid ? "OK" : r.reason;
};

describe("validateCardExpiry", () => {
  it("exige 4 dígitos", () => {
    expect(reasonOf("")).toBe("INCOMPLETE");
    expect(reasonOf("12/2")).toBe("INCOMPLETE");
  });

  it("rejeita mês 00, 13 e 15", () => {
    expect(reasonOf("00/30")).toBe("INVALID_MONTH");
    expect(reasonOf("13/30")).toBe("INVALID_MONTH");
    expect(reasonOf("15/34")).toBe("INVALID_MONTH");
  });

  it("rejeita mês/ano passado", () => {
    expect(reasonOf("10/26")).toBe("EXPIRED");
    expect(reasonOf("12/25")).toBe("EXPIRED");
  });

  it("aceita o mês/ano atual", () => {
    expect(reasonOf("11/26")).toBe("OK");
  });

  it("aceita mês/ano futuro e normaliza", () => {
    expect(reasonOf("12/26")).toBe("OK");
    expect(validateCardExpiry("01/30", NOW)).toEqual({ valid: true, month: "01", year: "2030" });
  });

  it("rejeita anos absurdos (> ano atual + 20)", () => {
    expect(reasonOf("12/46")).toBe("OK");
    expect(reasonOf("01/47")).toBe("TOO_FAR");
    expect(reasonOf("12/99")).toBe("TOO_FAR");
  });
});

describe("cardDataSchema (backend): validade", () => {
  const card = {
    holderName: "MARIA S SILVA",
    number: "4111111111111111",
    expiryMonth: "12",
    expiryYear: "2099",
    ccv: "123",
    holderCpfCnpj: "52998224725",
    postalCode: "87020025",
    addressNumber: "100",
    email: "m@x.com",
  };
  const ok = (over: object) => cardDataSchema.safeParse({ ...card, ...over }).success;

  it("rejeita mês 00/13, vencido e ano absurdo; aceita validade futura", () => {
    const y = new Date().getFullYear();
    expect(ok({ expiryYear: String(y + 1) })).toBe(true);
    expect(ok({ expiryMonth: "00", expiryYear: String(y + 1) })).toBe(false);
    expect(ok({ expiryMonth: "13", expiryYear: String(y + 1) })).toBe(false);
    expect(ok({ expiryMonth: "01", expiryYear: String(y - 1) })).toBe(false);
    expect(ok({ expiryMonth: "01", expiryYear: String(y + 21) })).toBe(false);
  });
});
