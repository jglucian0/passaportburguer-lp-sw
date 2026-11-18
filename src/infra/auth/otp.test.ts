import { afterEach, describe, expect, it, vi } from "vitest";

import { getWhatsappAuthMode, phoneVariants } from "./otp";

describe("getWhatsappAuthMode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("padrão é meta", () => {
    vi.stubEnv("WHATSAPP_AUTH_MODE", "");
    expect(getWhatsappAuthMode()).toBe("meta");
  });
  it("sandbox só fora de produção e quando explícito", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WHATSAPP_AUTH_MODE", "sandbox");
    expect(getWhatsappAuthMode()).toBe("sandbox");
  });
  it("em produção, sandbox é ignorado", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WHATSAPP_AUTH_MODE", "sandbox");
    expect(getWhatsappAuthMode()).toBe("meta");
  });
});

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
