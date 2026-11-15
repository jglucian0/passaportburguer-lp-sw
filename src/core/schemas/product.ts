import { z } from "zod";

import { centsSchema, uuidSchema } from "./common";

/* ---------------------- Entrada (CRUD admin) ----------------------- */

export const categoryInputSchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().trim().min(2, "Nome muito curto.").max(60),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});

export const productInputSchema = z.object({
  id: uuidSchema.optional(),
  categoryId: uuidSchema,
  name: z.string().trim().min(2, "Nome muito curto.").max(80),
  description: z.string().trim().max(400).nullish(),
  priceCents: centsSchema,
  imageUrl: z.string().url().nullish(),
  isAvailable: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export const addonGroupInputSchema = z
  .object({
    id: uuidSchema.optional(),
    productId: uuidSchema,
    name: z.string().trim().min(2).max(60),
    minSelections: z.coerce.number().int().min(0).max(20).default(0),
    maxSelections: z.coerce.number().int().min(1).max(20).default(1),
    sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  })
  .refine((v) => v.minSelections <= v.maxSelections, {
    message: "O mínimo não pode ser maior que o máximo.",
    path: ["minSelections"],
  });

export const addonInputSchema = z.object({
  id: uuidSchema.optional(),
  addonGroupId: uuidSchema,
  name: z.string().trim().min(1).max(60),
  priceCents: centsSchema.default(0),
  maxQuantity: z.coerce.number().int().min(1).max(20).default(1),
  isAvailable: z.boolean().default(true),
});

export const toggleAvailabilitySchema = z.object({
  id: uuidSchema,
  isAvailable: z.boolean(),
});

export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type ProductInput = z.infer<typeof productInputSchema>;
export type AddonGroupInput = z.infer<typeof addonGroupInputSchema>;
export type AddonInput = z.infer<typeof addonInputSchema>;
export type ToggleAvailabilityInput = z.infer<typeof toggleAvailabilitySchema>;

/* ------------- Catálogo (leitura, usado por carrinho/UI) ------------ */

export type CatalogAddon = {
  id: string;
  name: string;
  priceCents: number;
  /** Quantidade máxima deste adicional por item. */
  maxQuantity: number;
  isAvailable: boolean;
};

export type CatalogAddonGroup = {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  sortOrder: number;
  addons: CatalogAddon[];
};

export type CatalogProduct = {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceCents: number;
  imageUrl: string | null;
  isAvailable: boolean;
  isFeatured: boolean;
  sortOrder: number;
  addonGroups: CatalogAddonGroup[];
};

export type CatalogCategory = {
  id: string;
  name: string;
  sortOrder: number;
  products: CatalogProduct[];
};

export type CatalogDeliveryZone = {
  id: string;
  neighborhood: string;
  feeCents: number;
  estimatedMinutes: number;
  isActive: boolean;
};
