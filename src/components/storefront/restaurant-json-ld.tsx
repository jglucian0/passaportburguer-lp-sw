import type { PublicTenant } from "@/actions/storefront";
import { getProductDisplayPrice } from "@/core/menu/pricing";
import type { CatalogCategory } from "@/core/schemas/product";
import type { OpeningHours } from "@/core/store/opening-hours";
import { absoluteUrl, BUSINESS, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function openingHoursSpec(hours: OpeningHours) {
  return (Object.keys(hours) as Array<keyof OpeningHours>)
    .filter((key) => hours[key]?.enabled)
    .map((key) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: DAY_NAMES[Number(key)],
      opens: hours[key].open,
      closes: hours[key].close,
    }));
}

function menuJson(categories: CatalogCategory[]) {
  const sections = categories
    .map((category) => {
      const items = category.products
        .filter((p) => p.isAvailable)
        .map((p) => ({
          "@type": "MenuItem",
          name: p.name,
          ...(p.description ? { description: p.description } : {}),
          ...(p.imageUrl ? { image: absoluteUrl(p.imageUrl) } : {}),
          offers: {
            "@type": "Offer",
            price: (getProductDisplayPrice(p).cents / 100).toFixed(2),
            priceCurrency: "BRL",
          },
        }));
      return items.length > 0 ? { "@type": "MenuSection", name: category.name, hasMenuItem: items } : null;
    })
    .filter((s) => s !== null);

  return { "@type": "Menu", name: `Cardápio ${SITE_NAME}`, url: `${SITE_URL}/#cardapio`, hasMenuSection: sections };
}

export function RestaurantJsonLd({
  tenant,
  categories,
}: {
  tenant: PublicTenant;
  categories: CatalogCategory[];
}) {
  const phone = tenant.phoneWhatsapp?.replace(/\D/g, "");

  const data = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": `${SITE_URL}/#restaurant`,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    image: absoluteUrl("/og-image.jpg"),
    logo: absoluteUrl("/logo_passaportburguer.webp"),
    servesCuisine: "Hamburgueria Artesanal, Smash Burger",
    priceRange: "$$",
    ...(phone ? { telephone: `+${phone.startsWith("55") ? phone : `55${phone}`}` } : {}),
    address: { "@type": "PostalAddress", ...BUSINESS.address },
    geo: { "@type": "GeoCoordinates", ...BUSINESS.geo },
    openingHoursSpecification: openingHoursSpec(tenant.openingHours),
    hasMenu: menuJson(categories),
    potentialAction: {
      "@type": "OrderAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/#cardapio`,
        inLanguage: "pt-BR",
        actionPlatform: [
          "http://schema.org/DesktopWebPlatform",
          "http://schema.org/MobileWebPlatform",
        ],
      },
      deliveryMethod: [
        "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet",
        "http://purl.org/goodrelations/v1#DeliveryModePickUp",
      ],
    },
  };

  return (
    <script
      type="application/ld+json"
      // "<" escapado para o conteúdo do cardápio nunca fechar a tag <script>.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\u003c") }}
    />
  );
}
