import { randomInt } from "node:crypto";

/** Validade do código: 5 minutos (300 s). */
export const OTP_TTL_MS = 5 * 60 * 1000;
/** Erros de digitação toleráveis antes de invalidar o código. */
export const OTP_MAX_WRONG_ATTEMPTS = 5;
/** Intervalo mínimo entre dois envios para o mesmo número. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
/** Máximo de envios por número a cada hora. */
export const OTP_MAX_SENDS_PER_HOUR = 3;

export function isOtpExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** `wrongCount` já inclui a tentativa errada que acabou de acontecer. */
export function isLockedAfterWrong(wrongCount: number): boolean {
  return wrongCount >= OTP_MAX_WRONG_ATTEMPTS;
}

/**
 * "meta" (padrão): só o Webhook oficial confirma o código.
 * "sandbox": o cliente confirma no site, sem prova — só vale fora de produção e
 * somente se WHATSAPP_AUTH_MODE="sandbox" for definido explicitamente.
 */
export function getWhatsappAuthMode(): "sandbox" | "meta" {
  if (process.env.NODE_ENV !== "production" && process.env.WHATSAPP_AUTH_MODE === "sandbox") {
    return "sandbox";
  }
  return "meta";
}

/**
 * Como o código chega ao cliente (env WHATSAPP_OTP_DELIVERY). A validação é a mesma em "window" e "template":
 * o cliente DIGITA no site o código que recebeu no WhatsApp.
 * - "window" (padrão, sem custo): o cliente abre o WhatsApp com uma mensagem qualquer (abre a janela de 24 h)
 *   e o bot responde com o código.
 * - "template": o servidor envia o código direto por template de autenticação aprovado (produção; o cliente
 *   não precisa mandar mensagem nenhuma).
 * - "inbound": fluxo antigo invertido (o cliente envia PASS-XXXX e o Webhook confirma).
 * Em sandbox (dev) vale sempre "inbound".
 */
export type OtpDelivery = "inbound" | "window" | "template";

export function getOtpDelivery(): OtpDelivery {
  if (getWhatsappAuthMode() === "sandbox") return "inbound";
  const v = (process.env.WHATSAPP_OTP_DELIVERY ?? "").trim().toLowerCase();
  return v === "template" || v === "inbound" ? v : "window";
}

/** Mensagem que o cliente envia no modo "window". O Webhook a reconhece (e o bot de atendimento a ignora). */
export const OTP_REQUEST_TEXT = "Olá Passaporte Burguer! Quero meu código de acesso 🔐";

export function isOtpRequestMessage(text: string | undefined | null): boolean {
  return typeof text === "string" && /quero meu c[oó]digo de acesso/i.test(text);
}

export function buildOtpRequestUrl(): string | null {
  const store = process.env.STORE_WHATSAPP?.replace(/\D/g, "");
  if (!store) return null;
  return `https://wa.me/${store}?text=${encodeURIComponent(OTP_REQUEST_TEXT)}`;
}

/** Texto enviado pelo bot com o código (modo "window"). */
export function otpReplyText(code: string): string {
  return `🔐 Seu código de acesso do Passaporte Burguer é *${code}*.

Digite-o no site para continuar. Vale por ${OTP_TTL_MS / 60000} minutos. Não compartilhe com ninguém.`;
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
  return isPlausibleLocalPhone(digits.slice(2)) ? digits : null;
}

/** DDD de 11 a 99; celular de 11 dígitos tem o 9 após o DDD (descarta lixo e números estrangeiros sem o 55). */
function isPlausibleLocalPhone(local: string): boolean {
  if (Number(local.slice(0, 2)) < 11) return false;
  return local.length === 11 ? local[2] === "9" : /[2-9]/.test(local[2]);
}

/** Formato guardado em `customers.phone` (DDD + número, sem o 55). */
export function toLocalPhone(intl: string): string {
  return intl.slice(2);
}

/**
 * Formas equivalentes de um telefone local (DDD + número) com e sem o 9º dígito,
 * para achar o mesmo cliente independentemente de como foi digitado.
 */
export function phoneVariants(local: string): string[] {
  const d = local.replace(/\D/g, "");
  if (d.length === 10 && /[6-9]/.test(d[2])) return [d, `${d.slice(0, 2)}9${d.slice(2)}`];
  if (d.length === 11 && d[2] === "9") return [d, `${d.slice(0, 2)}${d.slice(3)}`];
  return [d];
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

/** Código numérico de 6 dígitos (modos "window"/"template"): o formato que o template de autenticação da Meta aceita. */
export function generateOtpCode(): string {
  return String(randomInt(1_000_000)).padStart(6, "0");
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
