/** Cloudflare Turnstile: desafio anti-bot validado no servidor ANTES de qualquer chamada paga (API da Meta). */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 4000;

export type TurnstileResult = { ok: true } | { ok: false; error: string };

type FetchLike = typeof fetch;

/** Sem TURNSTILE_SECRET_KEY o desafio fica desligado (desenvolvimento local). Em produção, configure. */
export function isTurnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim());
}

const FAILED = { ok: false, error: "Não foi possível confirmar que você é humano. Atualize a página e tente de novo." } as const;

export async function verifyTurnstile(
  token: string | null | undefined,
  ip: string,
  fetchImpl: FetchLike = fetch,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return { ok: true };
  if (!token) return FAILED;

  const body = new URLSearchParams({ secret, response: token });
  if (ip && ip !== "unknown") body.set("remoteip", ip);

  try {
    const res = await fetchImpl(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return FAILED;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true ? { ok: true } : FAILED;
  } catch {
    /* Cloudflare fora do ar: falha fechada (sem desafio resolvido não há envio pago). */
    return FAILED;
  }
}
