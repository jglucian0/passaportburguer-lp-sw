import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isTurnstileEnabled, verifyTurnstile } from "./turnstile";

const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response);

beforeEach(() => {
  process.env.TURNSTILE_SECRET_KEY = "secret-xyz";
});
afterEach(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
});

describe("Cloudflare Turnstile", () => {
  it("sem chave configurada o desafio é dispensado (dev/local)", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const fetchImpl = vi.fn();
    expect(isTurnstileEnabled()).toBe(false);
    expect(await verifyTurnstile(undefined, "1.1.1.1", fetchImpl as never)).toEqual({ ok: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("com chave, sem token: recusa sem nem chamar a Cloudflare", async () => {
    const fetchImpl = reply({ success: true });
    expect(await verifyTurnstile("", "1.1.1.1", fetchImpl)).toMatchObject({ ok: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("token válido: libera e envia secret, response e remoteip", async () => {
    const fetchImpl = reply({ success: true });
    expect(await verifyTurnstile("tok", "9.9.9.9", fetchImpl)).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("secret")).toBe("secret-xyz");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("9.9.9.9");
  });

  it("token inválido ou reutilizado: recusa", async () => {
    const r = reply({ success: false, "error-codes": ["timeout-or-duplicate"] });
    expect(await verifyTurnstile("tok", "1.1.1.1", r)).toMatchObject({ ok: false });
  });

  it("falha de rede ou resposta HTTP ruim: recusa (falha fechada)", async () => {
    const boom = vi.fn(async () => {
      throw new Error("network");
    });
    expect(await verifyTurnstile("tok", "1.1.1.1", boom as never)).toMatchObject({ ok: false });
    expect(await verifyTurnstile("tok", "1.1.1.1", reply({}, false))).toMatchObject({ ok: false });
  });
});
