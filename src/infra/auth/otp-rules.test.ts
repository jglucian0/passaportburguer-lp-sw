import { describe, expect, it } from "vitest";

import {
  isLockedAfterWrong,
  isOtpExpired,
  normalizeBrPhone,
  OTP_MAX_SENDS_PER_HOUR,
  OTP_MAX_WRONG_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_MS,
} from "./otp";

describe("regras do OTP", () => {
  it("o código vale 5 minutos (300 s)", () => {
    expect(OTP_TTL_MS).toBe(300_000);
  });

  it("limites oficiais: 5 erros, cooldown de 60 s, 3 envios por hora", () => {
    expect(OTP_MAX_WRONG_ATTEMPTS).toBe(5);
    expect(OTP_RESEND_COOLDOWN_SECONDS).toBe(60);
    expect(OTP_MAX_SENDS_PER_HOUR).toBe(3);
  });

  it("expira exatamente no instante de vencimento", () => {
    const expiresAt = new Date("2026-01-01T12:05:00Z");
    expect(isOtpExpired(expiresAt, new Date("2026-01-01T12:04:59Z"))).toBe(false);
    expect(isOtpExpired(expiresAt, new Date("2026-01-01T12:05:00Z"))).toBe(true);
    expect(isOtpExpired(expiresAt, new Date("2026-01-01T12:05:01Z"))).toBe(true);
  });

  it("trava na 5ª tentativa errada (e não antes)", () => {
    expect(isLockedAfterWrong(4)).toBe(false);
    expect(isLockedAfterWrong(5)).toBe(true);
    expect(isLockedAfterWrong(6)).toBe(true);
  });
});

describe("sanitização do telefone (só dígitos com DDI 55)", () => {
  it("remove máscara e acrescenta o 55", () => {
    expect(normalizeBrPhone("(44) 99999-8888")).toBe("5544999998888");
    expect(normalizeBrPhone("44 9999-8888")).toBe("554499998888");
  });

  it("mantém o 55 quando já existe e ignora símbolos", () => {
    expect(normalizeBrPhone("+55 (44) 99999-8888")).toBe("5544999998888");
  });

  it("recusa números fora do padrão", () => {
    expect(normalizeBrPhone("123")).toBeNull();
    expect(normalizeBrPhone("+1 202 555 0143")).toBeNull();
    expect(normalizeBrPhone("")).toBeNull();
  });
});
