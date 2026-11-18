import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  buffer: vi.fn(),
  process: vi.fn(),
  afterCbs: [] as Array<() => unknown>,
}));

vi.mock("next/server", () => ({ after: (cb: () => unknown) => m.afterCbs.push(cb) }));
vi.mock("@/infra/db", () => ({ db: {} }));
vi.mock("@/infra/whatsapp/inbox", () => ({
  bufferInbound: m.buffer,
  processAfterDebounce: m.process,
}));

import { GET, POST } from "./route";

const SECRET = "app-secret";
const req = (payload: unknown) => {
  const raw = JSON.stringify(payload);
  return new Request("http://localhost/x", {
    method: "POST",
    body: raw,
    headers: { "x-hub-signature-256": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex") },
  });
};
const wrap = (messages: unknown[]) => ({ entry: [{ changes: [{ value: { messages } }] }] });
const text = (id: string, body: string) => ({ id, from: "5543999999999", type: "text", text: { body } });

describe("webhook WhatsApp — bot", () => {
  beforeEach(() => {
    m.buffer.mockReset().mockImplementation(async (x) => x);
    m.process.mockReset().mockResolvedValue(undefined);
    m.afterCbs.length = 0;
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "vt");
  });

  it("agenda 1 processamento por telefone, ancorado na última mensagem", async () => {
    const res = await POST(req(wrap([text("w1", "oi"), text("w2", "quero um burger")])));
    expect(res.status).toBe(200);
    expect(m.afterCbs).toHaveLength(1);
    await m.afterCbs[0]();
    expect(m.process).toHaveBeenCalledWith("5543999999999", "w2");
  });

  it("não agenda nada quando tudo é reentrega (dedupe)", async () => {
    m.buffer.mockResolvedValue([]);
    await POST(req(wrap([text("w1", "oi")])));
    expect(m.afterCbs).toHaveLength(0);
  });

  it("mensagens com código PASS-XXXX não vão para o bot", async () => {
    await POST(req(wrap([text("w1", "PASS-AB23")])).clone());
    expect(m.buffer).not.toHaveBeenCalled();
  });

  it("401 sem assinatura, com assinatura inválida, de outro segredo ou com corpo adulterado: nada é processado", async () => {
    const payload = JSON.stringify(wrap([text("w1", "oi")]));
    const sig = (body: string, secret: string) =>
      "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    const post = (headers: Record<string, string>, body = payload) =>
      POST(new Request("http://localhost/x", { method: "POST", body, headers }));

    expect((await post({})).status).toBe(401);
    expect((await post({ "x-hub-signature-256": "sha256=" + "0".repeat(64) })).status).toBe(401);
    expect((await post({ "x-hub-signature-256": sig(payload, "outro-segredo") })).status).toBe(401);
    expect((await post({ "x-hub-signature-256": sig(payload, SECRET) }, payload.replace("oi", "tchau"))).status).toBe(401);
    expect((await post({ "x-hub-signature-256": sig(payload, SECRET).slice(7) })).status).toBe(401); // sem prefixo sha256=

    vi.stubEnv("WHATSAPP_APP_SECRET", ""); // sem segredo configurado: falha fechada
    expect((await post({ "x-hub-signature-256": sig(payload, "") })).status).toBe(401);

    expect(m.buffer).not.toHaveBeenCalled();
    expect(m.afterCbs).toHaveLength(0);
  });

  it("GET: challenge com token correto; 403 com errado", async () => {
    const ok = await GET(new Request("http://x/?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=123"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("123");
    const bad = await GET(new Request("http://x/?hub.mode=subscribe&hub.verify_token=no&hub.challenge=123"));
    expect(bad.status).toBe(403);
  });
});
