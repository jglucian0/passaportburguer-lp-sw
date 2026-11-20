import { z } from "zod";

import { documentError } from "@/core/validation/document";

/** Remove caracteres de controle/invisíveis e normaliza espaços. */
export const cleanText = (value: string) =>
  value
    // Cc: controle, Cf: invisíveis (zero-width, BOM, bidi), Zl/Zp: separadores de linha/parágrafo
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/** Telefone BR (com ou sem 55/máscara) → apenas dígitos no formato local (DDD + número). */
export const phoneInput = z
  .string()
  .max(24)
  .transform((v, ctx) => {
    let digits = v.replace(/\D/g, "");
    if (digits.length === 12 || digits.length === 13) {
      if (!digits.startsWith("55")) {
        ctx.addIssue({ code: "custom", message: "Informe um WhatsApp válido com DDD." });
        return z.NEVER;
      }
      digits = digits.slice(2);
    }
    if (digits.length !== 10 && digits.length !== 11) {
      ctx.addIssue({ code: "custom", message: "Informe um WhatsApp válido com DDD." });
      return z.NEVER;
    }
    return digits;
  });

/** CPF (só dígitos na saída), com dígitos verificadores válidos. */
export const cpfInput = z
  .string()
  .max(18)
  .transform((v, ctx) => {
    const digits = v.replace(/\D/g, "");
    const error = documentError(digits);
    if (error || digits.length !== 11) {
      ctx.addIssue({ code: "custom", message: error ?? "Informe um CPF válido." });
      return z.NEVER;
    }
    return digits;
  });

export const nameInput = z
  .string()
  .max(120)
  .transform(cleanText)
  .pipe(z.string().min(2, "Informe como podemos te chamar.").max(80, "Nome muito longo."));

export const checkAccountBody = z.object({ phone: phoneInput }).strict();
/** Cadastro do cliente: nome e, quando informado, CPF (o WhatsApp já foi validado pelo código). O CPF só é exigido no pagamento online. */
export const registerBody = z.object({ name: nameInput, document: cpfInput.optional() }).strict();
export const whatsappInitBody = z
  .object({
    phone: phoneInput,
    /** Token do Cloudflare Turnstile (obrigatório quando as chaves estão configuradas). */
    turnstileToken: z.string().max(2048).optional(),
    /** Pede um código novo mesmo havendo um ativo (botão "Reenviar", após o cooldown). */
    resend: z.boolean().optional(),
  })
  .strict();
export const whatsappCheckBody = z
  .object({
    phone: phoneInput,
    code: z.string().max(12).transform((v) => v.trim().toUpperCase()).pipe(z.string().regex(/^(PASS-[A-Z0-9]{4}|\d{6})$/)),
    confirm: z.boolean().optional(),
  })
  .strict();

/* Query strings das rotas de endereço */
export const addressSearchQuery = z.object({ q: z.string().max(100).default("") }).strict();
export const addressGeocodeQuery = z
  .object({ street: z.string().max(120).default(""), number: z.string().max(20).default("") })
  .strict();
export const addressReverseQuery = z
  .object({
    lat: z.coerce.number().finite().min(-90).max(90),
    lon: z.coerce.number().finite().min(-180).max(180),
  })
  .strict();
