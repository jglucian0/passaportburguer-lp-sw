import { z } from "zod";

export const uuidSchema = z.string().uuid();

/** Valor monetário em centavos (inteiro, não negativo). */
export const centsSchema = z.number().int().min(0).max(100_000_000);

/** Telefone brasileiro: aceita máscara, normaliza para apenas dígitos (10 ou 11, com ou sem DDI 55). */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => {
    const digits = value.replace(/\D/g, "");
    return digits.length > 11 && digits.startsWith("55") ? digits.slice(2) : digits;
  })
  .refine((digits) => digits.length === 10 || digits.length === 11, {
    message: "Informe um WhatsApp válido com DDD.",
  });

export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (HH:mm).");

export const ORDER_STATUSES = [
  "AWAITING_PAYMENT",
  "RECEIVED",
  "PREPARING",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELED",
] as const;

export const DELIVERY_TYPES = ["DELIVERY", "PICKUP"] as const;
export const PAYMENT_METHODS = ["PIX", "CARD_ON_DELIVERY", "CASH"] as const;
export const ADMIN_ROLES = ["OWNER", "STAFF"] as const;

export const orderStatusSchema = z.enum(ORDER_STATUSES);
export const deliveryTypeSchema = z.enum(DELIVERY_TYPES);
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type DeliveryType = z.infer<typeof deliveryTypeSchema>;
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
