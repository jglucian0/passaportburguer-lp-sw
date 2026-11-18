import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  otp: null as { id: string; phone: string } | null,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/infra/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (state.otp ? [state.otp] : []) }) }) }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          state.updates.push(values);
        },
      }),
    }),
  },
}));

import { POST } from "./route";

function webhook(from: string, body = "Olá! Meu código de embarque é: PASS-AB23") {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "999" },
              messages: [{ from, type: "text", text: { body } }],
            },
          },
        ],
      },
    ],
  };
  return new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", body: JSON.stringify(payload) });
}

describe("POST /api/webhooks/whatsapp", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    state.otp = null;
    state.updates = [];
    fetchMock.mockReset().mockResolvedValue(new Response('{"messages":[{"id":"x"}]}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("WHATSAPP_APP_SECRET", "");
    vi.stubEnv("WHATSAPP_AUTH_MODE", "sandbox");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "tok");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ["com 9º dígito (OTP com 9, Meta com 9)", "5543996142131", "5543996142131"],
    ["sem 9º dígito (OTP sem 9, Meta sem 9)", "554396142131", "554396142131"],
    ["cliente digitou sem 9, Meta entrega com 9", "554396142131", "5543996142131"],
    ["cliente digitou com 9, Meta entrega sem 9", "5543996142131", "554396142131"],
  ])("verifica o OTP e responde: %s", async (_name, stored, from) => {
    state.otp = { id: "1", phone: stored };
    const res = await POST(webhook(from));

    expect(res.status).toBe(200);
    expect(state.updates).toEqual([{ verified: true }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v21.0/999/messages");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toMatchObject({ messaging_product: "whatsapp", to: from, type: "text" });
    expect(console.log).toHaveBeenCalledWith("[WhatsApp Reply]", 200, expect.any(String));
  });

  it("usa o phone_number_id de fallback quando o payload não traz metadata", async () => {
    state.otp = { id: "1", phone: "5543996142131" };
    const req = new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({
        entry: [{ changes: [{ value: { messages: [{ from: "5543996142131", text: { body: "PASS-AB23" } }] } }] }],
      }),
    });
    await POST(req);
    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.facebook.com/v21.0/1466936689833496/messages");
  });

  it("não verifica nem responde para outro telefone", async () => {
    state.otp = { id: "1", phone: "5511999998888" };
    const res = await POST(webhook("5543996142131"));
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifica e retorna 200 mesmo sem token (apenas avisa)", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
    state.otp = { id: "1", phone: "5543996142131" };
    const res = await POST(webhook("5543996142131"));
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([{ verified: true }]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("retorna 200 e mantém verified quando a Graph API falha", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    state.otp = { id: "1", phone: "5543996142131" };
    const res = await POST(webhook("5543996142131"));
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([{ verified: true }]);
  });
});
