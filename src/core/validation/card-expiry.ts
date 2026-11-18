/** Anos à frente aceitos como validade de cartão. */
export const MAX_EXPIRY_YEARS_AHEAD = 20;

export type CardExpiryResult =
  | { valid: true; month: string; year: string }
  | { valid: false; reason: "INCOMPLETE" | "INVALID_MONTH" | "EXPIRED" | "TOO_FAR"; message: string };

const MESSAGES = {
  INCOMPLETE: "Informe a validade completa (MM/AA).",
  INVALID_MONTH: "Mês inválido (use 01 a 12).",
  EXPIRED: "Cartão vencido.",
  TOO_FAR: "Ano de validade inválido.",
} as const;

const fail = (reason: keyof typeof MESSAGES): CardExpiryResult => ({
  valid: false,
  reason,
  message: MESSAGES[reason],
});

/**
 * Valida "MM/AA" (também aceita "MMAA"). O mês corrente ainda é válido.
 * `now` é injetável para testes. Retorna mês/ano (YYYY) normalizados quando válido.
 */
export function validateCardExpiry(value: string, now: Date = new Date()): CardExpiryResult {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 4) return fail("INCOMPLETE");

  const month = Number(digits.slice(0, 2));
  const year = 2000 + Number(digits.slice(2));
  if (month < 1 || month > 12) return fail("INVALID_MONTH");

  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (year < currentYear || (year === currentYear && month < currentMonth)) return fail("EXPIRED");
  if (year > currentYear + MAX_EXPIRY_YEARS_AHEAD) return fail("TOO_FAR");

  return { valid: true, month: digits.slice(0, 2), year: String(year) };
}
