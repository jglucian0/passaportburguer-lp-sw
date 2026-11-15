import type { CatalogProduct } from "../schemas/product";

export type DisplayPrice = {
  /** Menor preço possível do item já com as escolhas obrigatórias mais baratas. */
  cents: number;
  /** true quando o valor final varia conforme as escolhas ("a partir de"). */
  from: boolean;
};

/**
 * Preço de vitrine. Produtos cujo preço base é 0 e que têm um grupo obrigatório
 * (ex: "5 unidades" / "10 unidades") passam a exibir o menor combo possível.
 */
export function getProductDisplayPrice(product: CatalogProduct): DisplayPrice {
  let cents = product.priceCents;
  let from = false;

  for (const group of product.addonGroups) {
    if (group.minSelections <= 0) continue;

    const prices = group.addons
      .filter((addon) => addon.isAvailable)
      .map((addon) => addon.priceCents)
      .sort((a, b) => a - b);

    if (prices.length === 0) continue;

    // As escolhas obrigatórias mais baratas entram no preço exibido.
    for (let i = 0; i < Math.min(group.minSelections, prices.length); i++) {
      cents += prices[i];
    }

    if (prices.some((price) => price !== prices[0])) from = true;
  }

  return { cents, from };
}
