import { createHmac, timingSafeEqual } from "node:crypto";

export type WhatsAppTokenPurpose = "QUICK_MENU" | "COMPLETE_REGISTRATION";

export type WhatsAppTokenPayload = {
  phone: string;
  purpose: WhatsAppTokenPurpose;
  orderId?: string;
};

type Claims = WhatsAppTokenPayload & { exp: number };

const PURPOSES: readonly string[] = ["QUICK_MENU", "COMPLETE_REGISTRATION"];

function secret(): string {
  const s = process.env.WHATSAPP_SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("WHATSAPP_SESSION_SECRET ausente ou curto demais.");
  return s;
}

function mac(body: string): Buffer {
  return createHmac("sha256", secret()).update(body).digest();
}

/**
 * Token `base64url(claims).base64url(hmac)`: o telefone viaja dentro do token assinado,
 * nunca como query string pura. O corpo é assinado, não criptografado.
 */
export function signWhatsAppToken(payload: WhatsAppTokenPayload, expiresInMinutes = 30): string {
  const claims: Claims = {
    phone: payload.phone,
    purpose: payload.purpose,
    ...(payload.orderId ? { orderId: payload.orderId } : {}),
    exp: Math.floor(Date.now() / 1000) + Math.round(expiresInMinutes * 60),
  };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

/** Retorna o payload se assinatura e validade estiverem corretas; senão `null`. */
export function verifyWhatsAppToken(token: string): WhatsAppTokenPayload | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const received = Buffer.from(sig, "base64url");
  const expected = mac(body);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  let claims: Claims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    !claims ||
    typeof claims.phone !== "string" ||
    !/^\d{10,15}$/.test(claims.phone) ||
    !PURPOSES.includes(claims.purpose) ||
    typeof claims.exp !== "number" ||
    claims.exp * 1000 <= Date.now()
  ) {
    return null;
  }
  return {
    phone: claims.phone,
    purpose: claims.purpose,
    ...(typeof claims.orderId === "string" ? { orderId: claims.orderId } : {}),
  };
}
