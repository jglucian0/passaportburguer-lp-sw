import { z } from "zod";

import { uuidSchema } from "./common";

export const cartAddonSelectionSchema = z.object({
  addonId: uuidSchema,
  /** Quantidade do adicional por unidade do produto. */
  quantity: z.number().int().min(1).max(20).default(1),
});

export const cartItemInputSchema = z.object({
  productId: uuidSchema,
  quantity: z.number().int().min(1).max(50),
  addons: z.array(cartAddonSelectionSchema).max(40).default([]),
});

export const cartInputSchema = z.array(cartItemInputSchema).min(1, "Carrinho vazio.").max(50);

export type CartAddonSelection = z.infer<typeof cartAddonSelectionSchema>;
export type CartItemInput = z.infer<typeof cartItemInputSchema>;
export type CartInput = z.infer<typeof cartInputSchema>;
