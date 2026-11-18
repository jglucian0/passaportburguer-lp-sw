import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signWhatsAppToken, verifyWhatsAppToken } from "./session-token";

describe("session-token", () => {
  beforeEach(() => {
    process.env.WHATSAPP_SESSION_SECRET = "test-secret-with-enough-length";
  });
  afterEach(() => vi.useRealTimers());

  it("assina e verifica, sem expor o telefone em texto puro", () => {
    const t = signWhatsAppToken({ phone: "5543999999999", purpose: "QUICK_MENU" });
    expect(t).not.toContain("5543999999999");
    expect(verifyWhatsAppToken(t)).toEqual({ phone: "5543999999999", purpose: "QUICK_MENU" });
  });

  it("preserva orderId", () => {
    const t = signWhatsAppToken({ phone: "5543999999999", purpose: "COMPLETE_REGISTRATION", orderId: "o1" });
    expect(verifyWhatsAppToken(t)?.orderId).toBe("o1");
  });

  it("expira", () => {
    vi.useFakeTimers();
    const t = signWhatsAppToken({ phone: "5543999999999", purpose: "QUICK_MENU" }, 30);
    vi.advanceTimersByTime(29 * 60_000);
    expect(verifyWhatsAppToken(t)).not.toBeNull();
    vi.advanceTimersByTime(2 * 60_000);
    expect(verifyWhatsAppToken(t)).toBeNull();
  });

  it("rejeita adulteração do corpo e da assinatura", () => {
    const t = signWhatsAppToken({ phone: "5543999999999", purpose: "QUICK_MENU" });
    const [body, sig] = t.split(".");
    const forged = Buffer.from(
      JSON.stringify({ phone: "5511888888888", purpose: "QUICK_MENU", exp: 9999999999 }),
    ).toString("base64url");
    expect(verifyWhatsAppToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyWhatsAppToken(`${body}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(verifyWhatsAppToken("lixo")).toBeNull();
  });

  it("rejeita token assinado com outro segredo", () => {
    const t = signWhatsAppToken({ phone: "5543999999999", purpose: "QUICK_MENU" });
    process.env.WHATSAPP_SESSION_SECRET = "another-secret-with-enough-len";
    expect(verifyWhatsAppToken(t)).toBeNull();
  });
});
