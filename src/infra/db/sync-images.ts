/**
 * Preenche products.image_url com as fotos de /public (somente onde está vazio; idempotente).
 * Uso: npm run db:sync-images
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";

const norm = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** nome normalizado do produto -> caminho público da foto. */
const IMAGES: Record<string, string> = {
  // Lanches
  "saint. louis": "/lanches/st-louis/st-louis.webp",
  "saint louis salad!": "/lanches/st-louis/st-louis-salad.webp",
  "saint louis kids": "/lanches/st-louis/st-louis-kids.webp",
  "cidade do mexico": "/lanches/mexico/cidade-do-mexico.webp",
  "gorngozola - milao": "/lanches/milao/gorgonzola-milao.webp",
  "buenos aires": "/lanches/buenos-aires/buenos-aires.webp",
  "corbin, frango": "/lanches/corbin/corbin.webp",
  cremona: "/lanches/cremona/cremona.webp",
  "cremona kids": "/lanches/cremona/cremona-kids.webp",
  gwangju: "/lanches/gwangju/gwangju.webp",
  tokyo: "/lanches/tokyo/tokyo.webp",
  // Acompanhamentos e sobremesas
  "bolinha de queijo gouda": "/lanches/outros/bolinha-de-queijo-gouda.webp",
  "brownie de chocolate – pug factory (50g)": "/lanches/outros/brownie-de-chocolate-pug-factory-50g.webp",
  "leitinho com creme de avela – pug factory (20g)": "/lanches/outros/leitinho-com-creme-de-avela-pug-factory-20g.webp",
  nugguets: "/lanches/outros/nugguets.webp",
  "onion rings": "/lanches/outros/onion-rings.webp",
  "porcao de batata": "/lanches/outros/porcao-de-batata.webp",
  "pudim de leite no copo americano (aprox. 150g / 190ml)":
    "/lanches/outros/pudim-de-leite-no-copo-americano-aprox-150g-190ml.webp",
  // Bebidas
  "coca-cola original 350 ml": "/bebidas/cocacola-350-normal.webp",
  "refrigerante sem acucar coca-cola 350 ml": "/bebidas/cocacola-350-zero.webp",
  "heineken long neck": "/bebidas/heineken-long-neck.webp",
  "kuat guarana 350 ml": "/bebidas/kuat-350-normal.webp",
  "sprite original 350 ml": "/bebidas/sprite-350-normal.webp",
  "suco prats laranja 300 ml": "/bebidas/suco-prats-300.webp",
  // Molhos
  ketchup: "/molhos/ketchup.webp",
  "maionese verde": "/molhos/maionese-verde.webp",
  "maionese de bacon": "/molhos/maionese-de-bacon.webp",
  "maionese de wasabi": "/molhos/maionese-de-wasabi.webp",
  "maionese pimenta jalapeno": "/molhos/maionese-pimenta-jalapeno.webp",
  "mostarda e mel": "/molhos/mostarda-e-mel.webp",
  // Combos
  "cidade do mexico + batata + coca-cola 350ml": "/combos/cidade-do-mexico-batata-coca-cola-350ml.webp",
  "conessione eua > italia + 2 batata + 2 coca-cola": "/combos/conessione-eua-italia-2-batata-2-coca-cola.webp",
  "cremona + batata + coca-cola 350ml": "/combos/cremona-batata-coca-cola-350ml.webp",
  "familia conessione eua > italia + 4 batata + 2 coca-cola":
    "/combos/familia-conessione-eua-italia-4-batata-2-coca-cola.webp",
  "familia los favoritos + 4 batata + 2 coca-cola": "/combos/familia-los-favoritos-4-batata-2-coca-cola.webp",
  "gorgonzola - milao + batata + coca-cola 350ml": "/combos/gorgonzola-milao-batata-coca-cola-350ml.webp",
  "los favoritos + 2 batata + 2 coca-cola": "/combos/los-favoritos-2-batata-2-coca-cola.webp",
  "saint louis + batata + coca-cola 350ml": "/combos/st-louis-batata-coca-cola-350ml.webp",
  "tokyo + batata + coca-cola 350ml": "/combos/tokyo-batata-coca-cola-350ml.webp",
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida.");
  const sql = neon(url);

  const rows = await sql`SELECT id, name FROM products WHERE image_url IS NULL`;
  let updated = 0;
  for (const row of rows as { id: string; name: string }[]) {
    const path = IMAGES[norm(row.name)];
    if (!path) {
      console.log(`sem foto mapeada: ${row.name}`);
      continue;
    }
    if (!existsSync(join(process.cwd(), "public", path))) {
      console.log(`arquivo ausente (${path}): ${row.name}`);
      continue;
    }
    await sql`UPDATE products SET image_url = ${path} WHERE id = ${row.id}`;
    updated++;
  }
  console.log(`${updated} produto(s) atualizado(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
