import { z } from "zod";

import { centsSchema, phoneSchema, timeSchema, uuidSchema } from "./common";

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
  logoUrl: z.string().url().nullish(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida (#RRGGBB)."),
  minOrderCents: centsSchema,
  openingHours: openingHoursSchema,
});

export const setManuallyClosedSchema = z.object({
  isManuallyClosed: z.boolean(),
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
