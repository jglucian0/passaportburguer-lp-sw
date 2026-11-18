import { eq } from "drizzle-orm";

import { normalizeBrPhone, phoneVariants, toLocalPhone } from "@/infra/auth/otp";
import { db } from "@/infra/db";
import { tenants } from "@/infra/db/schema";
import { SITE_URL } from "@/lib/site";

/** Contexto de uma execução do agente. O telefone vem da conversa, nunca do modelo. */
export type ToolContext = {
  /** E-164 só com dígitos (chave de whatsapp_sessions). */
  phone: string;
  /** Envios que só podem sair DEPOIS da resposta de texto do modelo (ex.: código Pix, botões). */
  afterReply: Array<() => Promise<unknown>>;
};

/** URL pública com esquema (NEXT_PUBLIC_APP_URL tem prioridade; senão o domínio canônico). */
export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || SITE_URL).replace(/\/+$/, "");
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
