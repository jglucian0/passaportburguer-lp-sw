import { z } from "zod";

import {
  centsSchema,
  deliveryTypeSchema,
  orderStatusSchema,
  paymentMethodSchema,
  phoneSchema,
  timeSchema,
  uuidSchema,
} from "./common";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  password: z.string().min(1, "Informe a senha.").max(200),
});

const dayHoursSchema = z.object({
  enabled: z.boolean(),
  open: timeSchema,
  close: timeSchema,
});

export const openingHoursSchema = z.object({
  "0": dayHoursSchema,
  "1": dayHoursSchema,
  "2": dayHoursSchema,
  "3": dayHoursSchema,
  "4": dayHoursSchema,
  "5": dayHoursSchema,
  "6": dayHoursSchema,
});

export const storeSettingsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phoneWhatsapp: phoneSchema.nullish(),
  address: z.string().trim().max(200).nullish(),
  logoUrl: z.string().url().nullish(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida (#RRGGBB)."),
  minOrderCents: centsSchema,
  autoAcceptOrders: z.boolean(),
  estimatedDeliveryMinutes: z.coerce.number().int().min(5).max(240),
  openingHours: openingHoursSchema,
});

/** true = abrir agora, false = fechar agora, null = voltar ao horário automático. */
export const setOpenOverrideSchema = z.object({
  isOpenOverride: z.boolean().nullable(),
});

export const quickEditProductSchema = z.object({
  id: uuidSchema,
  priceCents: centsSchema,
  description: z.string().trim().max(400).nullish(),
});

export const deliveryZoneInputSchema = z.object({
  id: uuidSchema.optional(),
  neighborhood: z.string().trim().min(2).max(80),
  feeCents: centsSchema,
  estimatedMinutes: z.coerce.number().int().min(5).max(240).default(40),
  isActive: z.boolean().default(true),
});

export const advanceOrderSchema = z.object({
  orderId: uuidSchema,
  /** Etapa de destino pretendida (drag-and-drop). Se informada, deve ser exatamente a próxima. */
  toStatus: orderStatusSchema.optional(),
});

export const cancelOrderSchema = z.object({
  orderId: uuidSchema,
  reason: z.string().trim().min(3, "Informe o motivo.").max(200),
});

export const presignedUploadRequestSchema = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/avif"]),
  sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024),
  folder: z.enum(["products", "logo"]).default("products"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type StoreSettingsInput = z.infer<typeof storeSettingsSchema>;
export type DeliveryZoneInput = z.infer<typeof deliveryZoneInputSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
export type PresignedUploadRequest = z.infer<typeof presignedUploadRequestSchema>;

/** Pedido lançado manualmente (balcão / WhatsApp) direto na fila da cozinha. */
export const manualOrderSchema = z
  .object({
    channel: z.enum(["COUNTER", "WHATSAPP"]),
    customerName: z.string().trim().min(2, "Informe o nome.").max(80),
    customerPhone: phoneSchema,
    deliveryType: deliveryTypeSchema,
    neighborhood: z.string().trim().max(80).optional(),
    street: z.string().trim().max(120).optional(),
    number: z.string().trim().max(20).optional(),
    reference: z.string().trim().max(120).optional(),
    deliveryFeeCents: centsSchema.default(0),
    /** Cartão online só nasce no checkout do site (precisa de confirmação do gateway). */
    paymentMethod: paymentMethodSchema.refine((m) => m !== "CREDIT_CARD", "Forma de pagamento inválida."),
    notes: z.string().trim().max(300).optional(),
    items: z
      .array(z.object({ productId: uuidSchema, quantity: z.number().int().min(1).max(50) }))
      .min(1, "Adicione ao menos um item.")
      .max(50),
  })
  .refine((v) => v.deliveryType !== "DELIVERY" || (v.street && v.number && v.neighborhood), {
    message: "Informe rua, número e bairro para entrega.",
    path: ["street"],
  });

export type ManualOrderInput = z.input<typeof manualOrderSchema>;

/* ---------------- Entregas por raio ---------------- */

export const deliveryRulesSchema = z
  .object({
    restrictToCity: z.boolean(),
    city: z.string().trim().min(2, "Informe a cidade.").max(80),
    maxRadiusKm: z.number().min(0.5, "Raio mínimo: 0,5 km.").max(100),
    baseAddress: z.string().trim().min(5, "Informe o endereço base.").max(200),
    bands: z
      .array(
        z.object({
          maxKm: z.number().min(0.1).max(100),
          feeCents: centsSchema,
        }),
      )
      .min(1, "Cadastre ao menos uma faixa.")
      .max(10),
  })
  .superRefine((v, ctx) => {
    v.bands.forEach((band, i) => {
      if (i > 0 && band.maxKm <= v.bands[i - 1].maxKm) {
        ctx.addIssue({ code: "custom", path: ["bands", i, "maxKm"], message: "Faixas devem ter limite crescente." });
      }
    });
    const last = v.bands[v.bands.length - 1];
    if (last && last.maxKm > v.maxRadiusKm) {
      ctx.addIssue({ code: "custom", path: ["bands"], message: "A última faixa não pode passar do raio máximo." });
    }
  });

export type DeliveryRulesInput = z.infer<typeof deliveryRulesSchema>;

/* ---------------- Equipe ---------------- */

export const teamMemberInputSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome.").max(80),
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  password: z.string().min(8, "A senha deve ter ao menos 8 caracteres.").max(100),
  role: z.enum(["OWNER", "KITCHEN"]),
});

export const setTeamMemberActiveSchema = z.object({
  id: uuidSchema,
  isActive: z.boolean(),
});

/** Cupom promocional. PERCENT: value 1–100; FIXED: value em centavos. */
export const couponInputSchema = z
  .object({
    id: uuidSchema.optional(),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,20}$/, "Código: 3–20 letras, números, - ou _."),
    type: z.enum(["PERCENT", "FIXED"]),
    value: z.number().int().min(1, "Informe o desconto."),
    minOrderCents: centsSchema.default(0),
    maxUses: z.number().int().min(1).max(1_000_000).nullable().default(null),
    isActive: z.boolean().default(true),
  })
  .refine((c) => c.type !== "PERCENT" || c.value <= 100, {
    path: ["value"],
    message: "O desconto percentual não pode passar de 100%.",
  });

export const setCouponActiveSchema = z.object({ id: uuidSchema, isActive: z.boolean() });
