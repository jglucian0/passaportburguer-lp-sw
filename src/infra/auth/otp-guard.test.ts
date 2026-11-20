import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { identifier: string; route: string; limit: number; windowSeconds: number; failClosed?: boolean };
const rl = vi.hoisted(() => ({ calls: [] as Call[], deny: new Set<string>() }));

vi.mock("@/infra/security/rate-limit", () => ({
  checkRateLimit: async (o: Call) => {
    rl.calls.push(o);
    const denied = rl.deny.has(o.route);
    return { allowed: !denied, remaining: denied ? 0 : 1, retryAfterSeconds: o.windowSeconds };
  },
}));

import { guardOtpSend } from "./otp-guard";

const who = { phone: "5544999998888", ip: "1.2.3.4" };

beforeEach(() => {
  rl.calls.length = 0;
  rl.deny.clear();
  delete process.env.OTP_DAILY_SEND_CAP;
});

describe("guardOtpSend (anti OTP pumping)", () => {
  it("libera quando nenhum limite estourou e aplica os 4 limites, todos falhando fechado", async () => {
    expect((await guardOtpSend(who)).ok).toBe(true);
    const byRoute = Object.fromEntries(rl.calls.map((c) => [c.route, c]));
    expect(byRoute["otp-cooldown"]).toMatchObject({ identifier: who.phone, limit: 1, windowSeconds: 60 });
    expect(byRoute["otp-hourly"]).toMatchObject({ identifier: who.phone, limit: 3, windowSeconds: 3600 });
    expect(byRoute["otp-ip-hourly"]).toMatchObject({ identifier: who.ip, windowSeconds: 3600 });
    expect(byRoute["otp-global-day"]).toMatchObject({ windowSeconds: 86400 });
    expect(rl.calls.every((c) => c.failClosed === true)).toBe(true);
  });

  it("cooldown de 60 s por telefone: bloqueia e NÃO gasta os demais limites", async () => {
    rl.deny.add("otp-cooldown");
    expect(await guardOtpSend(who)).toMatchObject({ ok: false, reason: "cooldown", retryAfterSeconds: 60 });
    expect(rl.calls.map((c) => c.route)).toEqual(["otp-cooldown"]);
  });

  it("máximo de 3 por hora por telefone", async () => {
    rl.deny.add("otp-hourly");
    expect(await guardOtpSend(who)).toMatchObject({ ok: false, reason: "hourly" });
  });

  it("limite por IP por hora", async () => {
    rl.deny.add("otp-ip-hourly");
    expect(await guardOtpSend(who)).toMatchObject({ ok: false, reason: "ip" });
  });

  it("teto global diário (disjuntor de custo), configurável por OTP_DAILY_SEND_CAP", async () => {
    process.env.OTP_DAILY_SEND_CAP = "50";
    await guardOtpSend(who);
    expect(rl.calls.find((c) => c.route === "otp-global-day")?.limit).toBe(50);
    rl.deny.add("otp-global-day");
    expect(await guardOtpSend(who)).toMatchObject({ ok: false, reason: "daily" });
  });
});
