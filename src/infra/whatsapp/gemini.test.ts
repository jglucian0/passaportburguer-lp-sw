import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  generateContent,
  GEMINI_MODEL,
  GeminiHttpError,
  geminiModel,
  geminiUrl,
  sanitizeErrorBody,
} from "./gemini";
import { errorSummary } from "./log";

const KEY = "AQ.chave-super-secreta-123";
const req = {
  systemInstruction: "sys",
  contents: [{ role: "user" as const, parts: [{ text: "oi" }] }],
  functionDeclarations: [{ name: "getCustomerContext", description: "x" }],
};
const ok = () =>
  new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "olá" }] } }] }), { status: 200 });
const err = (status: number, message = "boom", statusName = "NOT_FOUND") =>
  new Response(JSON.stringify({ error: { code: status, message, status: statusName } }), { status });

describe("URL e modelo do Gemini", () => {
  beforeEach(() => vi.stubEnv("GEMINI_MODEL", ""));
  afterEach(() => vi.unstubAllEnvs());

  it("usa o endpoint oficial v1beta com :generateContent", () => {
    expect(geminiUrl("gemini-3.1-flash-lite")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
    );
    expect(geminiUrl()).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`);
  });

  it('normaliza "models/x": nunca gera models/models/ na URL', () => {
    expect(geminiUrl("models/gemini-2.5-flash")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.8-flash");
    expect(geminiModel()).toBe("gemini-3.8-flash");
    expect(geminiUrl()).not.toContain("models/models");
  });

  it("GEMINI_MODEL vazio/espaços cai no padrão", () => {
    vi.stubEnv("GEMINI_MODEL", "   ");
    expect(geminiModel()).toBe(GEMINI_MODEL);
  });

  it("o modelo padrão não é o 2.5 (que dá 404 em contas novas)", () => {
    expect(GEMINI_MODEL).not.toMatch(/2\.5/);
  });
});

describe("generateContent", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GEMINI_API_KEY", KEY);
    vi.stubEnv("GEMINI_MODEL", "");
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("chama a URL final correta e envia a chave SÓ no header x-goog-api-key", async () => {
    fetchMock.mockResolvedValue(ok());
    const out = await generateContent(req);
    expect(out?.parts[0].text).toBe("olá");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`);
    expect(String(url)).not.toContain(KEY);
    expect(String(url)).not.toContain("key=");
    expect(init.headers["x-goog-api-key"]).toBe(KEY);
  });

  it("404: o erro traz status, modelo e o corpo do Google, sem a chave", async () => {
    fetchMock.mockResolvedValue(
      err(404, `This model models/gemini-2.5-flash is no longer available to new users. key=${KEY}`),
    );
    const e = await generateContent(req).catch((x) => x);
    expect(e).toBeInstanceOf(GeminiHttpError);
    expect(e.status).toBe(404);
    expect(e.message).toContain("404");
    expect(e.message).toContain("no longer available to new users");
    expect(e.message).not.toContain(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 404 não é repetido
    // e é isso que vai para o console.error do turno:
    expect(errorSummary(e)).toContain("no longer available to new users");
  });

  it("503 (alta demanda): tenta de novo e recupera", async () => {
    fetchMock.mockResolvedValueOnce(err(503, "high demand", "UNAVAILABLE")).mockResolvedValueOnce(ok());
    const out = await generateContent(req);
    expect(out?.parts[0].text).toBe("olá");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("503 persistente: desiste após 2 tentativas com GeminiHttpError", async () => {
    fetchMock.mockResolvedValue(err(503, "high demand", "UNAVAILABLE"));
    const e = await generateContent(req).catch((x) => x);
    expect(e).toBeInstanceOf(GeminiHttpError);
    expect(e.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sem GEMINI_API_KEY falha sem chamar a rede", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(generateContent(req)).rejects.toThrow(/GEMINI_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sanitizeErrorBody", () => {
  it("extrai a mensagem do JSON, uma linha, truncada e sem a chave", () => {
    const body = JSON.stringify({ error: { status: "NOT_FOUND", message: `linha1\nlinha2 ${KEY} ${"x".repeat(900)}` } });
    const out = sanitizeErrorBody(body, KEY);
    expect(out.startsWith("NOT_FOUND: linha1 linha2 <redacted>")).toBe(true);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain("\n");
    expect(out.length).toBeLessThanOrEqual(500);
  });

  it("corpo que não é JSON também é redigido", () => {
    expect(sanitizeErrorBody(`<html>erro ${KEY}</html>`, KEY)).toBe("<html>erro <redacted></html>");
  });
});
