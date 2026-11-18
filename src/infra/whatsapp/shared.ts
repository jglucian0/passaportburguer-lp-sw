import { eq } from "drizzle-orm";

import { normalizeBrPhone, phoneVariants, toLocalPhone } from "@/infra/auth/otp";
import { db } from "@/infra/db";
import { tenants } from "@/infra/db/schema";

import { signWhatsAppToken } from "./session-token";

/** Contexto de uma execução do agente. O telefone vem da conversa, nunca do modelo. */
export type ToolContext = {
  /** E-164 só com dígitos (chave de whatsapp_sessions). */
  phone: string;
  /** Envios que só podem sair DEPOIS da resposta de texto do modelo (ex.: código Pix). */
  afterReply: Array<() => Promise<unknown>>;
  /**
   * Botão de link (Cardápio Rápido / checkout). A resposta do modelo vira o corpo DESTE botão:
   * nunca sai uma mensagem de texto separada antes dele.
   */
  cta: CtaButton | null;
};

export type CtaButton = {
  buttonText: string;
  url: string;
  /** Repete o link https:// completo no corpo (quem prefere abrir no navegador). */
  appendUrlToBody?: boolean;
};

const CANONICAL_URL = "https://www.passaporteburguer.com.br";

/** URL pública sempre absoluta, com https:// e sem barra final (nunca relativa nem "undefined"). */
export function appUrl(): string {
  let base = (process.env.NEXT_PUBLIC_APP_URL || CANONICAL_URL).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  return base;
}

/** Validade do link de pagamento enviado pelo WhatsApp. */
export const ORDER_PAYMENT_TOKEN_MINUTES = 120;

/**
 * Página de pagamento do pedido (cartão), sempre absoluta e com token assinado (ORDER_PAYMENT, 2 h):
 * abre em aba anônima e no WebView do WhatsApp sem login. Ex.: https://.../pedido/{id}/pagamento?token=...
 */
export function checkoutUrl(orderId: string, phone: string): string {
  const token = signWhatsAppToken({ orderId, phone, purpose: "ORDER_PAYMENT" }, ORDER_PAYMENT_TOKEN_MINUTES);
  return `${appUrl()}/pedido/${encodeURIComponent(orderId)}/pagamento?token=${encodeURIComponent(token)}`;
}

/** Tenant único de hoje (o webhook não tem host de requisição). */
export async function getTenantId(): Promise<string | null> {
  const slug = process.env.DEFAULT_TENANT_SLUG ?? "passaporteburguer";
  const [row] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return row?.id ?? null;
}

/** Formatos possíveis de `customers.phone` (DDD+número, com e sem o 9º dígito) para um telefone E-164. */
export function customerPhoneVariants(phone: string): string[] {
  const intl = normalizeBrPhone(phone);
  return intl ? phoneVariants(toLocalPhone(intl)) : [];
}

/** Telefone no formato guardado em `customers.phone`. */
export function toCustomerPhone(phone: string): string | null {
  const intl = normalizeBrPhone(phone);
  return intl ? toLocalPhone(intl) : null;
}
