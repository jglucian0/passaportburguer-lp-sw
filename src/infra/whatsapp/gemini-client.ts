import {
  GeminiHttpError,
  GeminiUnavailableError,
  geminiUrl,
  normalizeModel,
  sanitizeErrorBody,
  type GeminiContent,
  type GeminiRequest,
} from "./gemini";

/**
 * Cadeia de modelos, em ordem. GEMINI_MODEL substitui o PRIMEIRO.
 * Os três últimos são os "estáveis" pedidos originalmente; nesta conta eles já respondem 404
 * ("no longer available"), por isso os 3.x vêm na frente e um 404 só pula para o próximo modelo.
 */
export const DEFAULT_MODEL_CHAIN = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
] as const;

export function modelChain(): string[] {
  const override = (process.env.GEMINI_MODEL ?? "").trim();
  const chain = override ? [override, ...DEFAULT_MODEL_CHAIN.slice(1)] : [...DEFAULT_MODEL_CHAIN];
  return [...new Set(chain.map(normalizeModel))];
}

/** Erros transitórios: vale repetir no mesmo modelo e, esgotado, trocar de modelo. */
export const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
/** Backoff entre as repetições no mesmo modelo (1ª chamada + 2 repetições). */
export const BACKOFF_MS = [800, 2000] as const;

const ATTEMPT_TIMEOUT_MS = 25_000;
/** Orçamento total de uma chamada (todos os modelos): o after() do webhook tem teto de 60s. */
const TOTAL_BUDGET_MS = 40_000;
const MIN_ATTEMPT_MS = 3_000;
/** Modelo que respondeu 404 (desativado para a conta) não é tentado de novo por um tempo. */
const DEAD_MODEL_TTL_MS = 30 * 60_000;

const deadModels = new Map<string, number>();
/** Modelos que recusaram `thinkingConfig` (400): passam a ser chamados sem ele. */
const noThinkingConfig = new Set<string>();
export function resetDeadModels(): void {
  deadModels.clear();
  noThinkingConfig.clear();
}

/** Sem "pensar" (thinkingBudget 0) a resposta sai em ~1 s; temperatura baixa para o tom ficar consistente. */
const GENERATION_CONFIG = { temperature: 0.35, maxOutputTokens: 1024 };

export type GenerateDeps = {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/**
 * Chamada ao Gemini com resiliência:
 *  - 429/500/502/503/504: até 2 repetições no mesmo modelo (800 ms, 2000 ms) e então o PRÓXIMO modelo,
 *    com o mesmo corpo (texto, áudio/imagem inline e tools intactos);
 *  - 404 (modelo desativado) e timeout: próximo modelo na hora, sem repetir;
 *  - 400/401/403 e demais 4xx: falha imediata, sem repetição e sem trocar de modelo.
 */
export async function generateContent(req: GeminiRequest, deps: GenerateDeps = {}): Promise<GeminiContent | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY não definida.");
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  const deadline = now() + TOTAL_BUDGET_MS;

  // Corpo montado uma vez por variante (com/sem thinkingConfig): o payload multimodal é idêntico em todos os modelos.
  const buildBody = (withThinking: boolean) =>
    JSON.stringify({
      systemInstruction: { parts: [{ text: req.systemInstruction }] },
      contents: req.contents,
      tools: [{ functionDeclarations: req.functionDeclarations }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      generationConfig: withThinking
        ? { ...GENERATION_CONFIG, thinkingConfig: { thinkingBudget: 0 } }
        : GENERATION_CONFIG,
    });
  const bodyWithThinking = buildBody(true);
  const bodyWithoutThinking = buildBody(false);

  const log: string[] = [];
  const chain = modelChain();
  const alive = chain.filter((m) => (deadModels.get(m) ?? 0) <= now());
  const candidates = alive.length > 0 ? alive : chain; // tudo "morto": tenta mesmo assim

  for (const model of candidates) {
    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
      const remaining = deadline - now();
      if (remaining < MIN_ATTEMPT_MS) {
        log.push(`${model}: orçamento de tempo esgotado`);
        throw new GeminiUnavailableError(log);
      }

      let res: Response;
      try {
        res = await fetch(geminiUrl(model), {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: noThinkingConfig.has(model) ? bodyWithoutThinking : bodyWithThinking,
          signal: AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, remaining)),
        });
      } catch (error) {
        if (isTimeout(error)) {
          log.push(`${model}: timeout`);
          break; // já esperou bastante: próximo modelo
        }
        log.push(`${model}: erro de rede`);
        if (attempt < BACKOFF_MS.length) {
          await sleep(BACKOFF_MS[attempt]);
          continue;
        }
        break;
      }

      if (res.ok) {
        const json = (await res.json()) as { candidates?: { content?: GeminiContent }[] };
        return json.candidates?.[0]?.content ?? null;
      }

      const errorBody = sanitizeErrorBody(await res.text().catch(() => ""), key);
      const httpError = new GeminiHttpError(res.status, errorBody, model);

      if (res.status === 404) {
        deadModels.set(model, now() + DEAD_MODEL_TTL_MS);
        log.push(`${model}: 404 ${errorBody.slice(0, 120)}`);
        break; // modelo indisponível para a conta: próximo
      }
      // Modelo que não aceita desligar o thinking: repete UMA vez, sem thinkingConfig (não é erro do pedido).
      if (res.status === 400 && /thinking/i.test(errorBody) && !noThinkingConfig.has(model)) {
        noThinkingConfig.add(model);
        log.push(`${model}: 400 thinkingConfig recusado, repetindo sem ele`);
        attempt--; // não consome uma repetição do backoff
        continue;
      }
      if (!TRANSIENT_STATUSES.has(res.status)) {
        throw httpError; // 400/401/403/...: definitivo, não gasta retries nem modelos
      }

      log.push(`${model}: ${res.status}`);
      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      // Esgotou as repetições neste modelo: segue para o próximo.
    }
  }

  throw new GeminiUnavailableError(log);
}
