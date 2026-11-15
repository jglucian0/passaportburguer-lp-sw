import type { CatalogCategory, CatalogProduct } from "@/core/schemas/product";

/** Categorias que recebem a prateleira "Complete seu embarque" e a dica de bebida. */
export const MAIN_CATEGORY = /hamb|kids/i;
export const DRINK_CATEGORY = /bebida/i;

const SIDE_CATEGORY = /acompanh/i;
const SAUCE_CATEGORY = /molho/i;

const MAX_UPSELLS = 4;
const MAX_BADGES = 3;

/** Só entram itens que cabem em um toque: disponíveis e sem escolha obrigatória. */
function isOneTap(product: CatalogProduct): boolean {
  return (
    product.isAvailable &&
    product.priceCents > 0 &&
    product.addonGroups.every((g) => g.minSelections === 0)
  );
}

function firstMatching(
  categories: CatalogCategory[],
  categoryRe: RegExp,
  preferred: RegExp,
  taken: Set<string>,
): CatalogProduct | null {
  const pool = categories
    .filter((c) => categoryRe.test(c.name))
    .flatMap((c) => c.products)
    .filter((p) => isOneTap(p) && !taken.has(p.id));
  return pool.find((p) => preferred.test(p.name)) ?? pool[0] ?? null;
}

/** 3–4 sugestões de alto giro: batata, molho da casa, refrigerante em lata e mais um acompanhamento. */
export function pickUpsells(categories: CatalogCategory[]): CatalogProduct[] {
  const taken = new Set<string>();
  const picks: CatalogProduct[] = [];

  const steps: Array<[RegExp, RegExp]> = [
    [SIDE_CATEGORY, /batata/i],
    [SAUCE_CATEGORY, /verde|maionese/i],
    [DRINK_CATEGORY, /coca.*(lata|350)|lata|350/i],
    [SIDE_CATEGORY, /./],
  ];

  for (const [categoryRe, preferred] of steps) {
    const product = firstMatching(categories, categoryRe, preferred, taken);
    if (!product) continue;
    taken.add(product.id);
    picks.push(product);
  }

  return picks.slice(0, MAX_UPSELLS);
}

/** Até 3 itens marcados como destaque no painel viram "★ Mais pedido". */
export function pickBestSellers(categories: CatalogCategory[]): Set<string> {
  const ids: string[] = [];
  for (const category of categories) {
    for (const product of category.products) {
      if (product.isFeatured && product.isAvailable && ids.length < MAX_BADGES) {
        ids.push(product.id);
      }
    }
  }
  return new Set(ids);
}
