/**
 * Modelo padrão (troque com GEMINI_MODEL, sem mexer no código).
 * O gemini-2.5-flash (e o 2.5-flash-lite) respondem 404 "no longer available to new users" em contas novas.
 * Validado com function calling + thoughtSignature; os flash 3.7/3.8 estavam com 503 (alta demanda) nos testes.
 */
export const GEMINI_MODEL = "gemini-3.1-flash-lite";

export type GeminiPart = {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  /** Devolvido pelo Gemini 2.5 em chamadas de função; precisa voltar intacto no histórico. */
  thoughtSignature?: string;
};

export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export type GeminiFunctionDeclaration = {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
};

export type GeminiRequest = {
  systemInstruction: string;
  contents: GeminiContent[];
  functionDeclarations: GeminiFunctionDeclaration[];
};

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const RETRYABLE = new Set([429, 500, 503]);
const ATTEMPTS = 2;
const TIMEOUT_MS = 25_000;

/** Modelo em uso: GEMINI_MODEL (aceita "models/x" ou "x") ou o padrão. */
export function geminiModel(): string {
  const raw = (process.env.GEMINI_MODEL ?? "").trim() || GEMINI_MODEL;
  return raw.replace(/^models\//, "");
}

/** URL final da chamada. A chave NUNCA vai aqui (vai no header x-goog-api-key). */
export function geminiUrl(model: string = geminiModel()): string {
  return `${ENDPOINT}/${model.replace(/^models\//, "")}:generateContent`;
}

/**
 * Corpo do erro para diagnóstico: a mensagem do Google em uma linha, truncada e sem a chave.
 * (Respostas de erro do Gemini descrevem o problema; não ecoam o conteúdo da conversa.)
 */
export function sanitizeErrorBody(body: string, key: string): string {
  let text = body;
  try {
    const j = JSON.parse(body) as { error?: { status?: string; message?: string } };
    if (j.error?.message) text = `${j.error.status ?? "ERROR"}: ${j.error.message}`;
  } catch {
    /* corpo não é JSON: usa o texto */
  }
  return text.split(key).join("<redacted>").replace(/\s+/g, " ").trim().slice(0, 500);
}

export class GeminiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly errorBody: string,
    readonly model: string,
  ) {
    super(`Gemini respondeu ${status} (modelo ${model}): ${errorBody}`);
    this.name = "GeminiHttpError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Chamada à REST API do Gemini (sem SDK). Retorna o conteúdo do 1º candidato, ou null se vazio/bloqueado. */
export async function generateContent(req: GeminiRequest): Promise<GeminiContent | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY não definida.");
  const model = geminiModel();

  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.systemInstruction }] },
      contents: req.contents,
      tools: [{ functionDeclarations: req.functionDeclarations }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      generationConfig: { temperature: 0.5, maxOutputTokens: 1024 },
    }),
  };

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(geminiUrl(model), { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) {
      const json = (await res.json()) as { candidates?: { content?: GeminiContent }[] };
      return json.candidates?.[0]?.content ?? null;
    }
    const errorBody = sanitizeErrorBody(await res.text().catch(() => ""), key);
    if (RETRYABLE.has(res.status) && attempt < ATTEMPTS) {
      await sleep(1000 * attempt); // pico de demanda costuma ser passageiro
      continue;
    }
    throw new GeminiHttpError(res.status, errorBody, model);
  }
}
