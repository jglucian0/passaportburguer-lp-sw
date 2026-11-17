import { z } from "zod";

import { documentError } from "../validation/document";
import { cartInputSchema } from "./cart";
import {
  centsSchema,
  deliveryTypeSchema,
  paymentMethodSchema,
  phoneSchema,
} from "./common";

export const checkoutSchema = z
  .object({
    customerName: z.string().trim().min(2, "Informe seu nome.").max(80),
    customerPhone: phoneSchema,
    deliveryType: deliveryTypeSchema,
    /** Endereço geocodificado (autocomplete/GPS). A taxa é recalculada no servidor a partir daqui. */
    lat: z.number().finite().min(-90).max(90).nullish(),
    lon: z.number().finite().min(-180).max(180).nullish(),
    city: z.string().trim().max(80).nullish(),
    postalCode: z.string().trim().max(12).nullish(),
    neighborhood: z.string().trim().max(80).nullish(),
    street: z.string().trim().max(120).nullish(),
    number: z.string().trim().max(20).nullish(),
    complement: z.string().trim().max(80).nullish(),
    reference: z.string().trim().max(120).nullish(),
    paymentMethod: paymentMethodSchema,
    changeForCents: centsSchema.nullish(),
    notes: z.string().trim().max(2000).nullish(),
    /** CPF/CNPJ na nota (opcional). Chega com ou sem máscara; é validado e guardado só com dígitos. */
    documentNumber: z.string().trim().max(18).nullish(),
    items: cartInputSchema,
  })
  .superRefine((data, ctx) => {
    if (data.deliveryType === "DELIVERY") {
      if (data.lat == null || data.lon == null || !data.city) {
        ctx.addIssue({ code: "custom", path: ["lat"], message: "Escolha um endereço de entrega." });
      }
      if (!data.street) {
        ctx.addIssue({ code: "custom", path: ["street"], message: "Informe a rua." });
      }
      if (!data.number) {
        ctx.addIssue({ code: "custom", path: ["number"], message: "Informe o número." });
      }
    }
    if (data.documentNumber) {
      const message = documentError(data.documentNumber);
      if (message) ctx.addIssue({ code: "custom", path: ["documentNumber"], message });
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
