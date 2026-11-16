import type { StampData } from "./passport-stamp";

/**
 * Serializável de ponta a ponta: um Server Component pode passar um Destination
 * para um Client Component. Por isso os RegExp ficam fora deste tipo, em
 * DESTINATION_PATTERNS.
 */
export type Destination = {
  id: string;
  /** Nome curto exibido no rodapé do cartão de passaporte. */
  cardTitle: string;
  /** Código de 3 letras no estilo IATA, exibido no bilhete de embarque. */
  code: string;
  city: string;
  country: string;
  /** Cor dos carimbos do cartão deste destino. */
  accent: string;
  stamp: StampData;
  tagline: string;
  /** Ingredientes típicos que inspiram os lanches do destino. */
  ingredients: string[];
};

/**
 * Padrões testados contra o texto normalizado (minúsculo, sem acentos) do nome
 * da categoria e do produto. A ordem de DESTINATIONS decide quem ganha quando
 * mais de um padrão casa.
 */
const DESTINATION_PATTERNS: Record<string, RegExp[]> = {
  "st-louis": [/saint\.? ?louis/, /st\.? ?louis/],
  mexico: [/mexic/],
  tokyo: [/tokyo/, /tokio/, /toquio/, /japao/],
  "buenos-aires": [/buenos/, /argentin/],
  milao: [/milao/, /gorgonzola/, /gorngozola/],
  cremona: [/cremona/, /conessione/],
  corbin: [/corbin/],
  gwangju: [/gwangju/, /kwangju/, /coreia/, /kimchi/],
};

export const DESTINATIONS: Destination[] = [
  {
    id: "st-louis",
    code: "STL",
    cardTitle: "ST. LOUIS",
    city: "St. Louis",
    country: "Estados Unidos",
    accent: "#1d4ed8",
    stamp: { top: "USA", middle: "ST. LOUIS", bottom: "POSTAGE" },
    tagline: "O tradicional americano, do jeito que virou clássico.",
    ingredients: [
      "Smash bovino 90g",
      "Queijo prato",
      "Maionese verde Pass",
      "Pão brioche",
    ],
  },
  {
    id: "mexico",
    code: "MEX",
    cardTitle: "MÉXICO",
    city: "México",
    country: "México",
    accent: "#d97706",
    stamp: { top: "CIDADE DO MÉXICO", middle: "MÉXICO", bottom: "★ ★ ★" },
    tagline: "Arriba! Picância média, crocância e muito sabor.",
    ingredients: [
      "Doritos",
      "Picles de jalapeño",
      "Bacon crocante",
      "Cebola caramelizada",
    ],
  },
  {
    id: "tokyo",
    code: "TYO",
    cardTitle: "TOKYO",
    city: "Tóquio",
    country: "Japão",
    accent: "#b91c1c",
    stamp: { top: "APPROVED", middle: "TOKYO", bottom: "JAPÃO" },
    tagline: "Doce, salgado e umami na mesma mordida.",
    ingredients: ["Tarê", "Cream cheese", "Bacon crocante", "Maionese wasabi"],
  },
  {
    id: "buenos-aires",
    code: "BUE",
    cardTitle: "BUENOS AIRES",
    city: "Buenos Aires",
    country: "Argentina",
    accent: "#0369a1",
    stamp: { top: "ARGENTINA", middle: "BUENOS AIRES", bottom: "★ ★ ★" },
    tagline: "Hermanos, bienvenidos: parrilla e chimichurri artesanal.",
    ingredients: [
      "Blend bovino 170g",
      "Chimichurri",
      "Tomate chapeado",
      "Toque defumado",
    ],
  },
  {
    id: "milao",
    code: "MIL",
    cardTitle: "MILÃO",
    city: "Milão",
    country: "Itália",
    accent: "#15803d",
    stamp: { top: "ITÁLIA", middle: "MILANO", bottom: "APPROVED" },
    tagline: "O cremoso encontro do gorgonzola com a cebola caramelizada.",
    ingredients: [
      "Molho de gorgonzola",
      "Blend 170g",
      "Bacon caramelizado",
      "Queijo prato",
    ],
  },
  {
    id: "cremona",
    code: "CRM",
    cardTitle: "CREMONA",
    city: "Cremona",
    country: "Itália",
    accent: "#be123c",
    stamp: { top: "ITÁLIA", middle: "CREMONA", bottom: "★ ★ ★" },
    tagline: "Mamma mia! Blend suíno com pepperoni e um toque de mel.",
    ingredients: ["Blend suíno", "Pepperoni", "Mel", "Cebola roxa fresca"],
  },
  {
    id: "corbin",
    code: "CBN",
    cardTitle: "CORBIN",
    city: "Corbin",
    country: "Estados Unidos",
    accent: "#7c3aed",
    stamp: { top: "KENTUCKY", middle: "CORBIN", bottom: "USA" },
    tagline: "Leve, de frango, com mel de florada silvestre.",
    ingredients: [
      "Frango supreme",
      "Mel silvestre",
      "Alface americana",
      "Maionese verde",
    ],
  },
  {
    id: "gwangju",
    code: "KWJ",
    cardTitle: "GWANGJU",
    city: "Gwangju",
    country: "Coreia do Sul",
    accent: "#0f766e",
    stamp: { top: "COREIA DO SUL", middle: "GWANGJU", bottom: "APPROVED" },
    tagline: "Pra quem ama pimenta: kimchi coreano e bacon crocante.",
    ingredients: [
      "Kimchi coreano",
      "Smash bovino 90g",
      "Bacon crocante",
      "Maionese verde Pass",
    ],
  },
];

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Descobre o destino a partir de textos em ordem de prioridade (ex: nome da categoria, depois do produto). */
export function matchDestination(
  ...texts: Array<string | null | undefined>
): Destination | null {
  for (const text of texts) {
    if (!text) continue;
    const normalized = normalize(text);
    const found = DESTINATIONS.find((d) =>
      (DESTINATION_PATTERNS[d.id] ?? []).some((p) => p.test(normalized)),
    );
    if (found) return found;
  }
  return null;
}

export const PASSPORT_SELECT_EVENT = "passport:select";
