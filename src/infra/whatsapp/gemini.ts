/** Tipos e utilitários da REST API do Gemini. A chamada resiliente (retry + fallback) fica em gemini-client.ts. */

export type GeminiPart = {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  /** Devolvido pelo Gemini em chamadas de função; precisa voltar intacto no histórico. */
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

/** Aceita "models/x" ou "x" e devolve "x" (evita models/models/ na URL). */
export function normalizeModel(model: string): string {
  return model.trim().replace(/^models\//, "");
}

/** URL final da chamada. A chave NUNCA vai aqui (vai no header x-goog-api-key). */
export function geminiUrl(model: string): string {
  return `${ENDPOINT}/${normalizeModel(model)}:generateContent`;
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

/** Todos os modelos/tentativas falharam por erro transitório ou indisponibilidade. */
export class GeminiUnavailableError extends Error {
  constructor(readonly attempts: string[]) {
    super(`Gemini indisponível após fallback: ${attempts.join(" | ")}`);
    this.name = "GeminiUnavailableError";
  }
}
