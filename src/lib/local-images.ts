import { readdirSync } from "node:fs";
import path from "node:path";

import type { CatalogCategory } from "@/core/schemas/product";
import { matchDestination } from "@/components/storefront/destinations";

/*
 * Fotos locais do cardápio: public/lanches/<destino>/, public/lanches/outros/,
 * public/combos/ e public/bebidas/. O arquivo é `<slug-do-nome-do-produto>.webp`.
 * Se existir, é usado no lugar do imageUrl do banco; senão nada muda.
 */

const PUBLIC_DIR = path.join(process.cwd(), "public");

export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^saint-/, "st-") // "Saint Louis" e "St. Louis" são o mesmo arquivo
    .replace(/gorngozola/g, "gorgonzola"); // grafia errada que existe no cardápio
}

/** Slug do produto de bebida -> nome do arquivo em public/bebidas (sem extensão). */
function matchDrink(slug: string): string | null {
  if (slug.includes("prats")) return "suco-prats-300";
  if (slug.includes("heineken")) return "heineken-long-neck";
  if (!/(^|-)350(-|$)/.test(slug)) return null; // só as latas de 350 ml têm foto
  const isZero = /(^|-)(zero|sem-acucar)(-|$)/.test(slug);
  if (slug.includes("coca")) return isZero ? "cocacola-350-zero" : "cocacola-350-normal";
  if (slug.includes("kuat")) return "kuat-350-normal";
  if (slug.includes("sprite")) return "sprite-350-normal";
  return null;
}

function listWebp(dir: string): string[] {
  try {
    return readdirSync(path.join(PUBLIC_DIR, dir))
      .filter((f) => f.toLowerCase().endsWith(".webp"))
      .map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

function subdirs(dir: string): string[] {
  try {
    return readdirSync(path.join(PUBLIC_DIR, dir), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Índice slug -> URL por pasta (lido a cada requisição: custa um readdir por pasta). */
function buildIndex() {
  const byFolder = new Map<string, Map<string, string>>();
  const folders = [
    ...subdirs("lanches").map((d) => `lanches/${d}`),
    "combos",
    "bebidas",
  ];
  for (const folder of folders) {
    byFolder.set(
      folder,
      new Map(listWebp(folder).map((slug) => [slug, `/${folder}/${slug}.webp`])),
    );
  }
  return byFolder;
}

/** Troca imageUrl pelas fotos locais quando existirem. Sem foto local, mantém o valor atual. */
export function applyLocalImages<C extends CatalogCategory>(categories: C[]): C[] {
  const index = buildIndex();
  if ([...index.values()].every((m) => m.size === 0)) return categories;

  const used = new Set<string>();

  return categories.map((category) => ({
    ...category,
    products: category.products.map((product) => {
      const slug = slugify(product.name);
      const destination = matchDestination(category.name, product.name);
      const categorySlug = slugify(category.name);

      const preferred = [
        destination ? `lanches/${destination.id}` : null,
        categorySlug.includes("combo") ? "combos" : null,
        categorySlug.includes("bebida") ? "bebidas" : null,
        "lanches/outros",
        "combos",
        "bebidas",
      ].filter((f): f is string => !!f);
      const folders = [...new Set([...preferred, ...index.keys()])];

      /* 1) Nome exato do produto. */
      for (const folder of folders) {
        const url = index.get(folder)?.get(slug);
        if (url) {
          used.add(url);
          return { ...product, imageUrl: url };
        }
      }

      /* 1b) Bebidas: o nome do arquivo é "<marca>-350-<normal|zero>"; o produto pode ter
       *     nome diferente ("Coca-Cola Original 350 ml", "Refrigerante sem Açúcar..."). */
      const drinkFile = matchDrink(slug);
      if (drinkFile) {
        const url = index.get("bebidas")?.get(drinkFile);
        if (url) return { ...product, imageUrl: url };
      }

      /* 2) Na pasta do destino, arquivo curto contido no nome ("corbin.webp" para "Corbin, Frango").
       *    Cada arquivo atende só ao primeiro produto que casar, para "Saint Louis Salad"
       *    não herdar a foto do "Saint Louis". */
      if (destination) {
        const files = index.get(`lanches/${destination.id}`);
        const tokens = `-${slug}-`;
        const best = [...(files ?? [])]
          .filter(([name, url]) => !used.has(url) && tokens.includes(`-${name}-`))
          .sort((a, b) => b[0].length - a[0].length)[0];
        if (best) {
          used.add(best[1]);
          return { ...product, imageUrl: best[1] };
        }
      }
      return product;
    }),
  }));
}
