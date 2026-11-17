import { z } from "zod";

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

export const passwordInput = z
  .string()
  .min(6, "A senha deve ter no mínimo 6 caracteres.")
  .max(72, "A senha deve ter no máximo 72 caracteres.");

export const emailInput = z
  .string()
  .max(160)
  .transform((v) => cleanText(v).toLowerCase())
  .pipe(z.string().email("Informe um e-mail válido."));

export const nameInput = z
  .string()
  .max(120)
  .transform(cleanText)
  .pipe(z.string().min(2, "Informe como podemos te chamar.").max(80, "Nome muito longo."));

export const checkAccountBody = z.object({ phone: phoneInput }).strict();
export const loginBody = z.object({ phone: phoneInput, password: z.string().min(1).max(72) }).strict();
export const registerBody = z
  .object({ name: nameInput, email: emailInput, password: passwordInput })
  .strict();
export const recoverRequestBody = z.object({ phone: phoneInput }).strict();
export const recoverResetBody = z
  .object({ phone: phoneInput, code: z.string().regex(/^\d{6}$/), password: passwordInput })
  .strict();
export const whatsappInitBody = z.object({ phone: phoneInput }).strict();
export const whatsappCheckBody = z
  .object({
    phone: phoneInput,
    code: z.string().max(12).transform((v) => v.trim().toUpperCase()).pipe(z.string().regex(/^PASS-[A-Z0-9]{4}$/)),
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
