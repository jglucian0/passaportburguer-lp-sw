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
  | "COUPON_MIN_NOT_REACHED"
  | "COUPON_PRODUCT_MISSING"
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

/** Cupom já validado (ativo, dentro da validade, com usos): aqui só se calcula o desconto. */
export type CartCoupon = {
  code: string;
  type: "PERCENT" | "FIXED";
  /** PERCENT: 1–100. FIXED: centavos. */
  value: number;
  minOrderCents: number;
  /** Teto do desconto em % dos itens (cupons de cashback de milhas). Ausente/null = sem teto. */
  maxDiscountPercent?: number | null;
  /** Item grátis: desconta 1 unidade deste produto (preço base, sem adicionais); precisa estar no pedido. */
  freeProductId?: string | null;
  freeProductName?: string | null;
  /** Frete grátis: zera a taxa de entrega (benefício de nível). */
  freeShipping?: boolean;
};

/** Desconto só sobre os itens (nunca sobre a taxa de entrega), nunca maior que o subtotal nem que o teto em %. */
export function couponDiscountCents(
  subtotalCents: number,
  coupon: Pick<CartCoupon, "type" | "value" | "maxDiscountPercent" | "freeProductId">,
  lines?: Pick<CalculatedLine, "productId" | "unitPriceCents">[],
): number {
  if (coupon.freeProductId) {
    const line = lines?.find((l) => l.productId === coupon.freeProductId);
    return line ? Math.max(0, Math.min(line.unitPriceCents, subtotalCents)) : 0;
  }
  const raw = coupon.type === "PERCENT" ? Math.floor((subtotalCents * coupon.value) / 100) : coupon.value;
  const cap = coupon.maxDiscountPercent ? Math.floor((subtotalCents * coupon.maxDiscountPercent) / 100) : subtotalCents;
  return Math.max(0, Math.min(raw, subtotalCents, cap));
}

export type CalculateCartParams = {
  items: CartItemInput[];
  /** Catálogo do tenant (produtos com grupos e adicionais). */
  catalog: CatalogProduct[];
  deliveryType: DeliveryType;
  deliveryZone?: CatalogDeliveryZone | null;
  minOrderCents: number;
  paymentMethod?: PaymentMethod;
  changeForCents?: number | null;
  coupon?: CartCoupon | null;
};

export type CalculateCartResult =
  | {
      ok: true;
      lines: CalculatedLine[];
      subtotalCents: number;
      deliveryFeeCents: number;
      /** Desconto do cupom (0 sem cupom). */
      discountCents: number;
      totalCents: number;
    }
  | { ok: false; errors: CartError[] };

export function calculateCart(params: CalculateCartParams): CalculateCartResult {
  const { items, catalog, deliveryType, deliveryZone, minOrderCents, paymentMethod, changeForCents, coupon } =
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
  if (coupon?.freeShipping && subtotalCents >= coupon.minOrderCents) deliveryFeeCents = 0;
  const discountCents = coupon && subtotalCents >= coupon.minOrderCents ? couponDiscountCents(subtotalCents, coupon, lines) : 0;
  const totalCents = subtotalCents - discountCents + deliveryFeeCents;

  if (errors.length === 0 && coupon?.freeProductId && subtotalCents >= coupon.minOrderCents && discountCents === 0) {
    errors.push({
      code: "COUPON_PRODUCT_MISSING",
      message: `O cupom ${coupon.code} vale para 1 ${coupon.freeProductName ?? "item específico"} grátis: adicione-o ao pedido.`,
    });
  }

  if (errors.length === 0 && coupon && subtotalCents < coupon.minOrderCents) {
    errors.push({
      code: "COUPON_MIN_NOT_REACHED",
      message: `O cupom ${coupon.code} vale para pedidos a partir de ${formatCents(coupon.minOrderCents)} em itens.`,
    });
  }

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

  return { ok: true, lines, subtotalCents, deliveryFeeCents, discountCents, totalCents };
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
