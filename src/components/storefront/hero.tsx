import { BadgeCheck, Plane, ShoppingBag } from "lucide-react";

import type { PublicTenant } from "@/actions/storefront";
import type {
  CatalogCategory,
  CatalogDeliveryZone,
} from "@/core/schemas/product";
import type { StoreStatus } from "@/core/store/opening-hours";

import { PlaneTrail } from "./brand-marks";
import { DESTINATIONS, matchDestination } from "./destinations";
import { DigitalBoardingPass } from "./digital-boarding-pass";
import { HeroCartSpacer } from "./hero-cart-spacer";
import { HeroSyncProvider } from "./hero-sync";
import { PassportCarousel, type CarouselCard } from "./passport-carousel";

/** Um cartão por destino, preferindo o produto que já tem foto cadastrada. */
function buildCards(categories: CatalogCategory[]): CarouselCard[] {
  const picked = new Map<string, CarouselCard>();

  for (const category of categories) {
    for (const product of category.products) {
      if (!product.isAvailable) continue;
      const destination = matchDestination(category.name, product.name);
      if (!destination) continue;

      const current = picked.get(destination.id);
      if (!current || (!current.imageUrl && product.imageUrl)) {
        picked.set(destination.id, {
          destination,
          imageUrl: product.imageUrl,
          dish: product.name,
          product,
        });
      }
    }
  }

  // Sem cardápio temático ainda: mostra os destinos como vitrine de placeholders.
  if (picked.size === 0) {
    return DESTINATIONS.slice(0, 3).map((destination) => ({
      destination,
      imageUrl: null,
      dish: destination.city,
      product: null,
    }));
  }

  return DESTINATIONS.flatMap((d) => picked.get(d.id) ?? []);
}

const FEATURES = [
  { icon: Plane, title: "Voo Direto", subtitle: "Entrega rápida na sua porta" },
  { icon: ShoppingBag, title: "Embarque Imediato", subtitle: "Retire no balcão sem filas" },
  { icon: BadgeCheck, title: "Receitas Autorais", subtitle: "Ingredientes típicos selecionados" },
] as const;

export function Hero({
  tenant,
  store,
  zones,
  categories,
}: {
  tenant: PublicTenant;
  store: StoreStatus;
  zones: CatalogDeliveryZone[];
  categories: CatalogCategory[];
}) {
  const cards = buildCards(categories);

  return (
    <section className="relative isolate flex min-h-[calc(100svh-5rem)] flex-col overflow-hidden bg-[#071329]">
      {/* ----------------------------- Fundo ----------------------------- */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url(/backgorund-hero.min.jpg)" }}
      />
      {/* Escurece levemente e suaviza as bordas para manter o texto legível */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_45%,rgba(1,10,40,0.15)_30%,rgba(1,10,40,0.6)_100%)]"
      />

      {/* --------------------------- Conteúdo --------------------------- */}
      <HeroSyncProvider>
        <div className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 content-center items-center gap-10 px-4 py-10 lg:grid-cols-12">
          {/* Copy + cartão de embarque */}
          <div className="lg:col-span-6">
            <h1 className="font-poppins text-5xl font-extrabold uppercase leading-[1.08] tracking-tight text-white sm:text-6xl">
              O <span className="text-[#F59E0B]">MUNDO</span> EM
              <br />
              CADA <span className="text-[#F59E0B]">MORDIDA</span>
            </h1>

            <p className="mt-5 max-w-lg text-base leading-relaxed text-[#CBD5E1]">
              Hambúrgueres artesanais inspirados na gastronomia de cada país, preparados com ingredientes típicos. Escolha seu próximo destino.
            </p>

            <div className="mt-7">
              <DigitalBoardingPass cards={cards} storeOpen={store.isOpen} />
            </div>
          </div>

          {/* Carrossel de passaportes */}
          <div className="relative lg:col-span-6">
            <PlaneTrail
              width={140}
              className="pointer-events-none absolute -left-9 -top-6 hidden text-gold lg:block"
            />
            <PlaneTrail
              width={100}
              className="pointer-events-none absolute -left-[155px] top-[500px] hidden text-gold/70 lg:block"
            />
            <PlaneTrail
              width={84}
              flip
              className="pointer-events-none absolute right-6 top-0 hidden text-gold/80 lg:block"
            />
            <PassportCarousel cards={cards} />
          </div>
        </div>
      </HeroSyncProvider>

      {/* ------------------------- Diferenciais ------------------------- */}
      <div className="mx-auto w-full max-w-7xl px-4 pb-8">
        <ul className="mx-auto grid w-fit grid-cols-1 gap-5 text-white sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-12">
          {FEATURES.map(({ icon: Icon, title, subtitle }) => (
            <li key={title} className="flex items-center gap-3">
              <Icon className="h-9 w-9 shrink-0 text-[#F59E0B]" strokeWidth={1.5} />
              <div className="leading-tight">
                <p className="text-sm font-semibold">
                  {title}
                </p>
                <p className="text-xs text-slate-400">{subtitle}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <HeroCartSpacer />
    </section>
  );
}
