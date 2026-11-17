import { minOrderMessage } from "../store/min-order";
import type { CartItemInput } from "../schemas/cart";
import type { DeliveryType, PaymentMethod } from "../schemas/common";
import type { CatalogDeliveryZone, CatalogProduct } from "../schemas/product";

export type CartErrorCode =
  | "EMPTY_CART"
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_UNAVAILABLE"
  | "ADDON_INVALID"
  | "ADDON_UNAVAILABLE"
  | "ADDON_MIN_SELECTIONS"
  | "ADDON_MAX_SELECTIONS"
  | "ADDON_MAX_QUANTITY"
  | "ZONE_REQUIRED"
  | "ZONE_INACTIVE"
  | "MIN_ORDER_NOT_REACHED"
  | "CHANGE_INSUFFICIENT";

export type CartError = {
  code: CartErrorCode;
  message: string;
  productId?: string;
  addonId?: string;
};

export type CalculatedAddon = {
  addonId: string;
  name: string;
  price_cents: number;
  quantity: number;
};

export type CalculatedLine = {
  productId: string;
  productName: string;
  unitPriceCents: number;
  quantity: number;
  addons: CalculatedAddon[];
  totalItemCents: number;
};

export type CalculateCartParams = {
  items: CartItemInput[];
  /** Catálogo do tenant (produtos com grupos e adicionais). */
  catalog: CatalogProduct[];
  deliveryType: DeliveryType;
  deliveryZone?: CatalogDeliveryZone | null;
  minOrderCents: number;
  paymentMethod?: PaymentMethod;
  changeForCents?: number | null;
};

export type CalculateCartResult =
  | {
      ok: true;
      lines: CalculatedLine[];
      subtotalCents: number;
      deliveryFeeCents: number;
      totalCents: number;
    }
  | { ok: false; errors: CartError[] };

export function calculateCart(params: CalculateCartParams): CalculateCartResult {
  const { items, catalog, deliveryType, deliveryZone, minOrderCents, paymentMethod, changeForCents } =
    params;

  const errors: CartError[] = [];
  const lines: CalculatedLine[] = [];

  if (items.length === 0) {
    return { ok: false, errors: [{ code: "EMPTY_CART", message: "Carrinho vazio." }] };
  }

  const productsById = new Map(catalog.map((p) => [p.id, p]));

  for (const item of items) {
    const product = productsById.get(item.productId);

    if (!product) {
      errors.push({
        code: "PRODUCT_NOT_FOUND",
        message: "Um dos produtos não existe mais.",
        productId: item.productId,
      });
      continue;
    }

    if (!product.isAvailable) {
      errors.push({
        code: "PRODUCT_UNAVAILABLE",
        message: `"${product.name}" está indisponível no momento.`,
        productId: product.id,
      });
      continue;
    }

    /* Consolida seleções repetidas do mesmo adicional. */
    const selected = new Map<string, number>();
    for (const sel of item.addons) {
      selected.set(sel.addonId, (selected.get(sel.addonId) ?? 0) + sel.quantity);
    }

    const addonLines: CalculatedAddon[] = [];
    let productHasError = false;

    /* Todo adicional selecionado precisa pertencer a um grupo do produto. */
    const knownAddonIds = new Set(product.addonGroups.flatMap((g) => g.addons.map((a) => a.id)));
    for (const addonId of selected.keys()) {
      if (!knownAddonIds.has(addonId)) {
        errors.push({
          code: "ADDON_INVALID",
          message: `Adicional inválido para "${product.name}".`,
          productId: product.id,
          addonId,
        });
        productHasError = true;
      }
    }

    for (const group of product.addonGroups) {
      let groupCount = 0;

      for (const addon of group.addons) {
        const qty = selected.get(addon.id);
        if (!qty) continue;

        if (!addon.isAvailable) {
          errors.push({
            code: "ADDON_UNAVAILABLE",
            message: `"${addon.name}" está indisponível no momento.`,
            productId: product.id,
            addonId: addon.id,
          });
          productHasError = true;
          continue;
        }

        if (qty > addon.maxQuantity) {
          errors.push({
            code: "ADDON_MAX_QUANTITY",
            message: `São no máximo ${addon.maxQuantity}x "${addon.name}" por item.`,
            productId: product.id,
            addonId: addon.id,
          });
          productHasError = true;
          continue;
        }

        groupCount += qty;
        addonLines.push({
          addonId: addon.id,
          name: addon.name,
          price_cents: addon.priceCents,
          quantity: qty,
        });
      }

      if (groupCount < group.minSelections) {
        errors.push({
          code: "ADDON_MIN_SELECTIONS",
          message: `Escolha ao menos ${group.minSelections} em "${group.name}" (${product.name}).`,
          productId: product.id,
        });
        productHasError = true;
      }
      if (groupCount > group.maxSelections) {
        errors.push({
          code: "ADDON_MAX_SELECTIONS",
          message: `Escolha no máximo ${group.maxSelections} em "${group.name}" (${product.name}).`,
          productId: product.id,
        });
        productHasError = true;
      }
    }

    if (productHasError) continue;

    const addonsPerUnit = addonLines.reduce((sum, a) => sum + a.price_cents * a.quantity, 0);
    const totalItemCents = (product.priceCents + addonsPerUnit) * item.quantity;

    lines.push({
      productId: product.id,
      productName: product.name,
      unitPriceCents: product.priceCents,
      quantity: item.quantity,
      addons: addonLines,
      totalItemCents,
    });
  }

  let deliveryFeeCents = 0;
  if (deliveryType === "DELIVERY") {
    if (!deliveryZone) {
      errors.push({ code: "ZONE_REQUIRED", message: "Escolha um endereço de entrega válido." });
    } else if (!deliveryZone.isActive) {
      errors.push({ code: "ZONE_INACTIVE", message: "Não entregamos mais neste bairro." });
    } else {
      deliveryFeeCents = deliveryZone.feeCents;
    }
  }

  const subtotalCents = lines.reduce((sum, l) => sum + l.totalItemCents, 0);
  const totalCents = subtotalCents + deliveryFeeCents;

  /* Mínimo vale só para ENTREGA e incide sobre o subtotal dos produtos (sem a taxa). */
  if (errors.length === 0 && deliveryType === "DELIVERY" && subtotalCents < minOrderCents) {
    errors.push({
      code: "MIN_ORDER_NOT_REACHED",
      message: minOrderMessage(minOrderCents, minOrderCents - subtotalCents),
    });
  }

  if (
    errors.length === 0 &&
    paymentMethod === "CASH" &&
    changeForCents != null &&
    changeForCents < totalCents
  ) {
    errors.push({
      code: "CHANGE_INSUFFICIENT",
      message: `O troco deve ser para um valor igual ou maior que ${formatCents(totalCents)}.`,
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, lines, subtotalCents, deliveryFeeCents, totalCents };
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
