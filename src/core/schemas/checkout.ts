import { z } from "zod";

import { cartInputSchema } from "./cart";
import {
  centsSchema,
  deliveryTypeSchema,
  paymentMethodSchema,
  phoneSchema,
  uuidSchema,
} from "./common";

export const checkoutSchema = z
  .object({
    customerName: z.string().trim().min(2, "Informe seu nome.").max(80),
    customerPhone: phoneSchema,
    deliveryType: deliveryTypeSchema,
    deliveryZoneId: uuidSchema.nullish(),
    street: z.string().trim().max(120).nullish(),
    number: z.string().trim().max(20).nullish(),
    complement: z.string().trim().max(80).nullish(),
    reference: z.string().trim().max(120).nullish(),
    paymentMethod: paymentMethodSchema,
    changeForCents: centsSchema.nullish(),
    notes: z.string().trim().max(2000).nullish(),
    items: cartInputSchema,
  })
  .superRefine((data, ctx) => {
    if (data.deliveryType === "DELIVERY") {
      if (!data.deliveryZoneId) {
        ctx.addIssue({ code: "custom", path: ["deliveryZoneId"], message: "Selecione o bairro." });
      }
      if (!data.street) {
        ctx.addIssue({ code: "custom", path: ["street"], message: "Informe a rua." });
      }
      if (!data.number) {
        ctx.addIssue({ code: "custom", path: ["number"], message: "Informe o número." });
      }
    }
    if (data.paymentMethod !== "CASH" && data.changeForCents != null) {
      ctx.addIssue({
        code: "custom",
        path: ["changeForCents"],
        message: "Troco só se aplica a pagamento em dinheiro.",
      });
    }
  });

export const customerNameSchema = z.object({
  name: z.string().trim().min(2, "Informe como podemos te chamar.").max(80),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
