import { checkRateLimit } from "@/infra/security/rate-limit";

import { OTP_MAX_SENDS_PER_HOUR, OTP_RESEND_COOLDOWN_SECONDS } from "./otp";

export type OtpGuardResult =
  | { ok: true }
  | { ok: false; reason: "cooldown" | "hourly" | "ip" | "daily"; retryAfterSeconds: number; message: string };

const HOUR = 3600;
const DAY = 86_400;
const IP_MAX_SENDS_PER_HOUR = 10;
const DEFAULT_DAILY_CAP = 300;

/** Teto global de envios por dia (disjuntor de custo contra OTP pumping). OTP_DAILY_SEND_CAP sobrescreve. */
function dailyCap(): number {
  const n = Number(process.env.OTP_DAILY_SEND_CAP);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_CAP;
}

type Limit = { route: string; identifier: string; limit: number; windowSeconds: number };

async function exceeded(l: Limit): Promise<number | null> {
  /* Falha fechada: se o banco de limites cair, NÃO envia (o custo é o risco, não a conveniência). */
  const r = await checkRateLimit({ ...l, failClosed: true });
  return r.allowed ? null : r.retryAfterSeconds;
}

/**
 * Decide se um novo código pode ser ENVIADO (cada envio custa dinheiro). Ordem: do mais barato/específico
 * ao mais geral, parando no primeiro bloqueio para não consumir os contadores seguintes.
 */
export async function guardOtpSend({ phone, ip }: { phone: string; ip: string }): Promise<OtpGuardResult> {
  const checks: Array<{ limit: Limit; reason: "cooldown" | "hourly" | "ip" | "daily"; message: string }> = [
    {
      reason: "cooldown",
      limit: { route: "otp-cooldown", identifier: phone, limit: 1, windowSeconds: OTP_RESEND_COOLDOWN_SECONDS },
      message: `Aguarde ${OTP_RESEND_COOLDOWN_SECONDS} segundos para pedir um novo código.`,
    },
    {
      reason: "hourly",
      limit: { route: "otp-hourly", identifier: phone, limit: OTP_MAX_SENDS_PER_HOUR, windowSeconds: HOUR },
      message: "Você atingiu o limite de códigos por hora. Tente novamente mais tarde.",
    },
    {
      reason: "ip",
      limit: { route: "otp-ip-hourly", identifier: ip, limit: IP_MAX_SENDS_PER_HOUR, windowSeconds: HOUR },
      message: "Muitas solicitações deste dispositivo. Tente novamente mais tarde.",
    },
    {
      reason: "daily",
      limit: { route: "otp-global-day", identifier: "all", limit: dailyCap(), windowSeconds: DAY },
      message: "Serviço de verificação temporariamente indisponível. Tente novamente mais tarde.",
    },
  ];

  for (const c of checks) {
    const retryAfterSeconds = await exceeded(c.limit);
    if (retryAfterSeconds !== null) return { ok: false, reason: c.reason, retryAfterSeconds, message: c.message };
  }
  return { ok: true };
}
