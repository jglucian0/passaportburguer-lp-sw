import { randomInt } from "node:crypto";

/** Validade do código de embarque (fluxo invertido via wa.me). */
export const OTP_TTL_MS = 10 * 60 * 1000;

/** "sandbox": o cliente confirma no site; "meta": só o Webhook oficial confirma. */
export function getWhatsappAuthMode(): "sandbox" | "meta" {
  return process.env.WHATSAPP_AUTH_MODE === "meta" ? "meta" : "sandbox";
}

/**
 * Normaliza para o padrão internacional brasileiro (55 + DDD + número).
 * Retorna null se não tiver 12 ou 13 dígitos (ou 10/11 sem o 55).
 */
export function normalizeBrPhone(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (!digits.startsWith("55")) return null;
  if (digits.length !== 12 && digits.length !== 13) return null;
  return digits;
}

/** Formato guardado em `customers.phone` (DDD + número, sem o 55). */
export function toLocalPhone(intl: string): string {
  return intl.slice(2);
}

/**
 * Compara telefones ignorando o 9º dígito (a Meta pode entregar números
 * brasileiros antigos sem ele): DDD + últimos 8 dígitos.
 */
export function samePhone(a: string, b: string): boolean {
  const key = (p: string) => {
    const d = p.replace(/\D/g, "");
    const local = d.startsWith("55") ? d.slice(2) : d;
    return local.slice(0, 2) + local.slice(-8);
  };
  return key(a) === key(b);
}

/* Sem 0/O/1/I para evitar confusão na leitura. */
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export const CODE_REGEX = /PASS-[A-Z0-9]{4}/i;

export function generateEmbarkCode(): string {
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `PASS-${suffix}`;
}

export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase();
  return /^PASS-[A-Z0-9]{4}$/.test(code) ? code : null;
}

export function buildWaUrl(code: string): string | null {
  const store = process.env.STORE_WHATSAPP?.replace(/\D/g, "");
  if (!store) return null;
  const text = `Olá Passaporte Burguer! Meu código de embarque é: ${code}`;
  return `https://wa.me/${store}?text=${encodeURIComponent(text)}`;
}
