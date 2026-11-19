import {
  GeminiHttpError,
  normalizeContents,
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
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-2.0-flash",
] as const;

export function modelChain(): string[] {
  const override = (process.env.GEMINI_MODEL ?? "").trim();
  const chain = override ? [override, ...DEFAULT_MODEL_CHAIN.slice(1)] : [...DEFAULT_MODEL_CHAIN];
  return [...new Set(chain.map(normalizeModel))];
}

/**
 * Reserva GRATUITA: se existir GEMINI_API_KEY_FALLBACK (chave de OUTRO projeto do Google AI Studio, sem faturamento),
 * ela só é usada quando a chave principal falhou em todos os modelos. Só modelos estáveis, para nunca cobrar nem usar preview.
 */
export const FALLBACK_MODEL_CHAIN = ["gemini-2.5-flash-lite", "gemini-2.5-flash"] as const;

/** Erros transitórios: vale repetir no mesmo modelo e, esgotado, trocar de modelo. */
export const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
/** Backoff entre as repetições no mesmo modelo (1ª chamada + 2 repetições). */
export const BACKOFF_MS = [800, 2000] as const;

/** Um modelo lento não pode comer o orçamento dos próximos: 12 s por tentativa. */
const ATTEMPT_TIMEOUT_MS = 12_000;
/** Orçamento total de uma chamada (todos os modelos): o after() do webhook tem teto de 60s. */
const TOTAL_BUDGET_MS = 40_000;
const MIN_ATTEMPT_MS = 3_000;
/** Modelo que respondeu 404 (desativado para a conta) não é tentado de novo por um tempo. */
const DEAD_MODEL_TTL_MS = 30 * 60_000;

const deadModels = new Map<string, number>();
/**
 * Degradação por modelo após 400: 0 = pedido completo; 1 = sem thinkingConfig; 2 = sem thinkingConfig e sem toolConfig.
 * (Modelos "preview" costumam recusar só a configuração, não o conteúdo.)
 */
const degradeLevel = new Map<string, number>();
export function resetDeadModels(): void {
  deadModels.clear();
  degradeLevel.clear();
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
  const now = deps.now ?? Date.now;
  const deadline = now() + TOTAL_BUDGET_MS;
  try {
    return await generateWithKey(req, key, modelChain(), "main", deadline, deps);
  } catch (error) {
    const fallbackKey = (process.env.GEMINI_API_KEY_FALLBACK ?? "").trim();
    if (!fallbackKey || fallbackKey === key) throw error;
    console.error("[whatsapp-bot] chave principal falhou; usando a reserva gratuita:", error instanceof Error ? error.message.slice(0, 200) : "erro");
    try {
      return await generateWithKey(req, fallbackKey, [...FALLBACK_MODEL_CHAIN], "fallback", deadline, deps);
    } catch {
      throw error; // o erro que importa é o da chave principal
    }
  }
}

async function generateWithKey(
  req: GeminiRequest,
  key: string,
  chain: string[],
  scope: string,
  deadline: number,
  deps: GenerateDeps,
): Promise<GeminiContent | null> {
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  const stateKey = (m: string) => `${scope}:${m}`;

  // Corpo montado uma vez por variante (com/sem thinkingConfig): o payload multimodal é idêntico em todos os modelos.
  const buildBody = (level: number) =>
    JSON.stringify({
      systemInstruction: { parts: [{ text: req.systemInstruction }] },
      contents: normalizeContents(req.contents),
      tools: [{ functionDeclarations: req.functionDeclarations }],
      ...(level >= 2 ? {} : { toolConfig: { functionCallingConfig: { mode: "AUTO" } } }),
      generationConfig:
        level === 0 ? { ...GENERATION_CONFIG, thinkingConfig: { thinkingBudget: 0 } } : GENERATION_CONFIG,
    });
  const bodies = [buildBody(0), buildBody(1), buildBody(2)];

  const log: string[] = [];
  /** 400 de um modelo não encerra o turno: outro modelo pode aceitar. Só falha se TODOS recusarem. */
  let lastBadRequest: GeminiHttpError | null = null;
  const alive = chain.filter((m) => (deadModels.get(stateKey(m)) ?? 0) <= now());
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
          body: bodies[degradeLevel.get(stateKey(model)) ?? 0],
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
        deadModels.set(stateKey(model), now() + DEAD_MODEL_TTL_MS);
        log.push(`${model}: 404 ${errorBody.slice(0, 120)}`);
        break; // modelo indisponível para a conta: próximo
      }
      if (res.status === 400) {
        const level = degradeLevel.get(stateKey(model)) ?? 0;
        if (level < 2) {
          // Pode ser só a configuração: repete o MESMO modelo com um pedido mais simples (sem gastar backoff).
          degradeLevel.set(stateKey(model), level + 1);
          log.push(`${model}: 400, repetindo com pedido simplificado (nível ${level + 1})`);
          attempt--;
          continue;
        }
        lastBadRequest = httpError;
        log.push(`${model}: 400 ${errorBody.slice(0, 120)}`);
        console.error("[whatsapp-bot] gemini 400:", model, errorBody.slice(0, 200), describeShape(req));
        break; // este modelo recusou o pedido: tenta o próximo
      }
      if (!TRANSIENT_STATUSES.has(res.status)) {
        throw httpError; // 401/403/...: chave/permissão, trocar de modelo não ajuda
      }

      log.push(`${model}: ${res.status}`);
      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      // Esgotou as repetições neste modelo: segue para o próximo.
    }
  }

  if (lastBadRequest) throw lastBadRequest;
  throw new GeminiUnavailableError(log);
}

/** Forma do pedido (papéis e tipos de parte, sem conteúdo): ajuda a achar a causa de um 400 sem vazar a conversa. */
function describeShape(req: GeminiRequest): string {
  const shape = req.contents.map((c) => `${c.role[0]}:${(c.parts ?? []).map((p) => (p.text !== undefined ? "t" : p.inlineData ? "i" : p.functionCall ? "fc" : p.functionResponse ? "fr" : "?")).join("")}`);
  return shape.join(" ");
}
