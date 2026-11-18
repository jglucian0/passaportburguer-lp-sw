import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BACKOFF_MS, DEFAULT_MODEL_CHAIN, generateContent, modelChain, resetDeadModels } from "./gemini-client";
import {
  GeminiHttpError,
  GeminiUnavailableError,
  geminiUrl,
  normalizeModel,
  sanitizeErrorBody,
  type GeminiRequest,
} from "./gemini";
import { errorSummary } from "./log";

const KEY = "AQ.chave-super-secreta-123";
const [M1, M2, M3] = DEFAULT_MODEL_CHAIN;

// Payload multimodal + tools, para provar que viaja idêntico a cada tentativa/modelo.
const req: GeminiRequest = {
  systemInstruction: "sys",
  contents: [
    {
      role: "user",
      parts: [
        { text: "[Áudio do cliente]" },
        { inlineData: { mimeType: "audio/ogg", data: "T0dH" } },
        { inlineData: { mimeType: "image/jpeg", data: "SU1H" } },
      ],
    },
  ],
  functionDeclarations: [{ name: "getCustomerContext", description: "x" }],
};

const okRes = () =>
  new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "olá" }] } }] }), { status: 200 });
const errRes = (status: number, message = "boom", name = "ERR") =>
  new Response(JSON.stringify({ error: { code: status, message, status: name } }), { status });

const urlOf = (i: number) => String(fetchMock.mock.calls[i][0]);
const bodyOf = (i: number) => String(fetchMock.mock.calls[i][1].body);

const fetchMock = vi.fn();
const sleep = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  fetchMock.mockReset();
  sleep.mockClear();
  resetDeadModels();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GEMINI_API_KEY", KEY);
  vi.stubEnv("GEMINI_MODEL", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("URL e cadeia de modelos", () => {
  it("endpoint oficial v1beta :generateContent e normaliza models/x", () => {
    expect(geminiUrl("gemini-3.1-flash-lite")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
    );
    expect(geminiUrl("models/gemini-2.5-flash")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect(normalizeModel("  models/x  ")).toBe("x");
  });

  it("a cadeia mantém os 3 modelos 2.x pedidos e GEMINI_MODEL substitui só o primeiro", () => {
    expect(modelChain()).toEqual([...DEFAULT_MODEL_CHAIN]);
    for (const m of ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"]) expect(modelChain()).toContain(m);

    vi.stubEnv("GEMINI_MODEL", "models/gemini-3.8-flash");
    const chain = modelChain();
    expect(chain[0]).toBe("gemini-3.8-flash");
    expect(chain).toHaveLength(new Set(chain).size); // sem duplicata
    expect(chain.some((m) => m.startsWith("models/"))).toBe(false);
  });
});

describe("generateContent — resiliência", () => {
  it("chama a URL certa com a chave só no header", async () => {
    fetchMock.mockResolvedValue(okRes());
    await generateContent(req, { sleep });
    expect(urlOf(0)).toBe(geminiUrl(M1));
    expect(urlOf(0)).not.toContain(KEY);
    expect(fetchMock.mock.calls[0][1].headers["x-goog-api-key"]).toBe(KEY);
  });

  it("1) 1º modelo com 503 -> backoff 800/2000 -> próximo modelo responde 200, com payload e tools intactos", async () => {
    fetchMock
      .mockResolvedValueOnce(errRes(503, "high demand", "UNAVAILABLE"))
      .mockResolvedValueOnce(errRes(503, "high demand", "UNAVAILABLE"))
      .mockResolvedValueOnce(errRes(503, "high demand", "UNAVAILABLE"))
      .mockResolvedValueOnce(okRes());

    const out = await generateContent(req, { sleep });
    expect(out?.parts[0].text).toBe("olá");

    // 1ª chamada + 2 repetições no mesmo modelo, depois o 2º modelo da lista.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect([0, 1, 2].map(urlOf)).toEqual([geminiUrl(M1), geminiUrl(M1), geminiUrl(M1)]);
    expect(urlOf(3)).toBe(geminiUrl(M2));
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([...BACKOFF_MS]); // [800, 2000]
    expect(BACKOFF_MS).toEqual([800, 2000]);

    // Mesmo corpo em todas as tentativas e modelos (áudio, imagem e tools).
    const first = bodyOf(0);
    expect([1, 2, 3].every((i) => bodyOf(i) === first)).toBe(true);
    expect(first).toContain('"mimeType":"audio/ogg"');
    expect(first).toContain('"mimeType":"image/jpeg"');
    expect(first).toContain("getCustomerContext");
  });

  it.each([429, 500, 502, 504])("%i também é transitório (repete e depois troca de modelo)", async (status) => {
    fetchMock.mockResolvedValueOnce(errRes(status)).mockResolvedValueOnce(okRes());
    await generateContent(req, { sleep });
    expect(urlOf(1)).toBe(geminiUrl(M1)); // repetiu no mesmo modelo
    expect(sleep).toHaveBeenCalledWith(800);
  });

  it("transitório que se resolve na repetição não troca de modelo", async () => {
    fetchMock.mockResolvedValueOnce(errRes(503)).mockResolvedValueOnce(okRes());
    await generateContent(req, { sleep });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urlOf(1)).toBe(geminiUrl(M1));
  });

  it.each([400, 401, 403])("3) %i falha na hora: sem retry, sem backoff e sem trocar de modelo", async (status) => {
    fetchMock.mockResolvedValue(errRes(status, `erro ${status} key=${KEY}`, "INVALID_ARGUMENT"));
    const e = await generateContent(req, { sleep }).catch((x) => x);
    expect(e).toBeInstanceOf(GeminiHttpError);
    expect(e.status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(e.message).not.toContain(KEY);
  });

  it("404 (modelo desativado): pula direto ao próximo, sem retry, e lembra que está morto", async () => {
    fetchMock.mockResolvedValueOnce(errRes(404, "no longer available to new users", "NOT_FOUND")).mockResolvedValueOnce(okRes());
    await generateContent(req, { sleep });
    expect(urlOf(1)).toBe(geminiUrl(M2));
    expect(sleep).not.toHaveBeenCalled();

    // Na chamada seguinte o modelo morto nem é tentado.
    fetchMock.mockReset().mockResolvedValue(okRes());
    await generateContent(req, { sleep });
    expect(urlOf(0)).toBe(geminiUrl(M2));
  });

  it("timeout em um modelo: próximo modelo na hora", async () => {
    fetchMock
      .mockRejectedValueOnce(Object.assign(new Error("t"), { name: "TimeoutError" }))
      .mockResolvedValueOnce(okRes());
    await generateContent(req, { sleep });
    expect(urlOf(1)).toBe(geminiUrl(M2));
    expect(sleep).not.toHaveBeenCalled();
  });

  it("falha total: GeminiUnavailableError com o resumo de cada modelo (sem a chave)", async () => {
    fetchMock.mockResolvedValue(errRes(503, `demanda key=${KEY}`, "UNAVAILABLE"));
    const e = await generateContent(req, { sleep }).catch((x) => x);
    expect(e).toBeInstanceOf(GeminiUnavailableError);
    expect(e.message).toContain(M1);
    expect(e.message).toContain(M3);
    expect(e.message).not.toContain(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(modelChain().length * 3);
  });

  it("orçamento de tempo esgotado interrompe a cadeia", async () => {
    let t = 0;
    fetchMock.mockImplementation(async () => {
      t += 20_000; // cada tentativa "gasta" 20s
      return errRes(503);
    });
    const e = await generateContent(req, { sleep, now: () => t }).catch((x) => x);
    expect(e).toBeInstanceOf(GeminiUnavailableError);
    expect(e.message).toContain("orçamento de tempo");
    expect(fetchMock.mock.calls.length).toBeLessThan(modelChain().length * 3);
  });

  it("sem GEMINI_API_KEY não chama a rede", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(generateContent(req, { sleep })).rejects.toThrow(/GEMINI_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("o log do turno traz o status e o corpo do erro, sem chave", async () => {
    fetchMock.mockResolvedValue(errRes(400, `argumento inválido key=${KEY}`, "INVALID_ARGUMENT"));
    const e = await generateContent(req, { sleep }).catch((x) => x);
    const line = errorSummary(e);
    expect(line).toContain("400");
    expect(line).toContain("INVALID_ARGUMENT");
    expect(line).toContain("argumento inválido");
    expect(line).not.toContain(KEY);
  });
});

describe("sanitizeErrorBody", () => {
  it("uma linha, truncado e sem a chave", () => {
    const body = JSON.stringify({ error: { status: "NOT_FOUND", message: `l1\nl2 ${KEY} ${"x".repeat(900)}` } });
    const out = sanitizeErrorBody(body, KEY);
    expect(out.startsWith("NOT_FOUND: l1 l2 <redacted>")).toBe(true);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain("\n");
    expect(out.length).toBeLessThanOrEqual(500);
  });
  it("corpo que não é JSON também é redigido", () => {
    expect(sanitizeErrorBody(`<html>${KEY}</html>`, KEY)).toBe("<html><redacted></html>");
  });
});
