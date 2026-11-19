import { z } from "zod";

import { validateCardExpiry } from "../validation/card-expiry";
import { documentError, onlyDigits } from "../validation/document";

/** Luhn: valida o número do cartão antes de gastar uma chamada ao gateway. */
export function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

function expiryOk(month: string, year: string, now = new Date()): boolean {
  // Mesma regra do frontend: mês 01..12, não vencido e no máximo 20 anos à frente.
  return validateCardExpiry(`${month}${year.slice(-2)}`, now).valid && year.length === 4;
}

/** Dados de cartão: usados só em memória no servidor; mensagens de erro nunca ecoam o valor. */
export const cardDataSchema = z
  .object({
    holderName: z.string().trim().min(2, "Informe o nome impresso no cartão.").max(60),
    number: z
      .string()
      .transform(onlyDigits)
      .refine((d) => d.length >= 13 && d.length <= 19 && passesLuhn(d), "Número de cartão inválido."),
    expiryMonth: z
      .string()
      .trim()
      .regex(/^\d{1,2}$/, "Validade inválida.")
      .transform((v) => v.padStart(2, "0")),
    expiryYear: z
      .string()
      .trim()
      .regex(/^\d{2}(\d{2})?$/, "Validade inválida.")
      .transform((v) => (v.length === 2 ? `20${v}` : v)),
    ccv: z.string().trim().regex(/^\d{3,4}$/, "CVV inválido."),
    holderCpfCnpj: z
      .string()
      .transform(onlyDigits)
      .refine((d) => documentError(d) === null, "CPF do titular inválido."),
    postalCode: z
      .string()
      .transform(onlyDigits)
      .refine((d) => d.length === 8, "CEP inválido."),
    addressNumber: z.string().trim().min(1, "Informe o número do endereço.").max(10),
    email: z.string().trim().toLowerCase().email("E-mail inválido.").max(120),
  })
  .strict()
  .refine((c) => expiryOk(c.expiryMonth, c.expiryYear), {
    path: ["expiryMonth"],
    message: "Cartão vencido ou validade inválida.",
  });

/** CPF/CNPJ do pagador: obrigatório para gerar Pix/fatura quando o pedido ainda não tem um. */
const documentField = z
  .string()
  .transform(onlyDigits)
  .refine((d) => documentError(d) === null, "CPF inválido.")
  .optional();

export const payOrderSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("pix"), documentNumber: documentField }).strict(),
  z.object({ mode: z.literal("hosted"), documentNumber: documentField }).strict(),
  /** Cliente desistiu do Pix (foi para o cartão): invalida o QR Code pendente. */
  z.object({ mode: z.literal("cancel-pix") }).strict(),
  z.object({ mode: z.literal("card"), card: cardDataSchema }).strict(),
]);

export type PayOrderInput = z.infer<typeof payOrderSchema>;
