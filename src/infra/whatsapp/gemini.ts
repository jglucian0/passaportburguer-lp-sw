export const GEMINI_MODEL = "gemini-2.5-flash";

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

/** Chamada à REST API do Gemini (sem SDK). Retorna o conteúdo do 1º candidato, ou null se vazio/bloqueado. */
export async function generateContent(req: GeminiRequest): Promise<GeminiContent | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY não definida.");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.systemInstruction }] },
        contents: req.contents,
        tools: [{ functionDeclarations: req.functionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig: { temperature: 0.5, maxOutputTokens: 1024 },
      }),
      signal: AbortSignal.timeout(45_000),
    },
  );
  // LGPD: o corpo da requisição tem dados do cliente; no erro só o status.
  if (!res.ok) throw new Error(`Gemini respondeu ${res.status}.`);
  const json = (await res.json()) as { candidates?: { content?: GeminiContent }[] };
  return json.candidates?.[0]?.content ?? null;
}
