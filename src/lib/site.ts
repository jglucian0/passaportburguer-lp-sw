/** Dados canônicos do site para SEO (metadata, JSON-LD, sitemap e robots). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://passaporteburguer.com.br").replace(/\/+$/, "");

export const SITE_NAME = "Passaporte Burguer";

export const SITE_TITLE = "Passaporte Burguer | Hamburgueria Artesanal e Smash Delivery em Maringá - PR";

export const SITE_DESCRIPTION =
  "Hamburgueria artesanal em Maringá-PR (Zona 07): smash burgers com ingredientes típicos de cada país. Peça delivery ou retire no balcão sem fila no Passaporte Burguer.";

export const SITE_KEYWORDS = [
  "hamburgueria Maringá",
  "smash burger Maringá",
  "hambúrguer artesanal Maringá",
  "delivery de hambúrguer Maringá",
  "hamburgueria Zona 07",
  "hamburgueria delivery Maringá PR",
  "Passaporte Burguer",
  "smash burger artesanal",
  "retirada hamburgueria Maringá",
];

export const OG_IMAGE = { url: "/og-image.jpg", width: 1200, height: 630, alt: "Passaporte Burguer — hamburgueria artesanal e smash delivery em Maringá-PR" };

export const BUSINESS = {
  address: {
    streetAddress: "Av. São Paulo, 123",
    addressLocality: "Maringá",
    addressRegion: "PR",
    postalCode: "87030-010",
    addressCountry: "BR",
  },
  geo: { latitude: -23.4139, longitude: -51.9378 },
} as const;

/** Torna absoluta uma URL de imagem relativa (ex.: "/lanches/x.webp"). */
export function absoluteUrl(path: string): string {
  return /^https?:\/\//i.test(path) ? path : `${SITE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Alt descritivo para fotos de produtos, com contexto gastronômico e local. */
export function productImageAlt(name: string, description: string | null | undefined, isBurger: boolean): string {
  const base = isBurger ? `Hambúrguer artesanal ${name}` : `${name} do cardápio do Passaporte Burguer`;
  const detail = description?.replace(/\s+/g, " ").trim();
  if (!detail) return `${base} — Passaporte Burguer, Maringá-PR`;
  const short = detail.length > 110 ? `${detail.slice(0, 107).trimEnd()}...` : detail;
  return `${base}: ${short}`;
}
