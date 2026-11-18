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
    <section className="relative isolate flex min-h-[calc(100svh-5rem)] flex-col max-md:min-h-0 overflow-hidden bg-[#071329]">
      {/* ----------------------------- Fundo ----------------------------- */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url(/backgorund-hero.min.webp)" }}
      />
      {/* Escurece levemente e suaviza as bordas para manter o texto legível */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_45%,rgba(1,10,40,0.15)_30%,rgba(1,10,40,0.6)_100%)]"
      />
      {/* Desktop: gradiente direcional sutil só atrás da coluna de texto (mapa intacto no resto) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 -z-10 hidden w-1/2 bg-gradient-to-r from-[#071329]/75 via-[#071329]/25 to-transparent md:block"
      />

      {/* --------------------------- Conteúdo --------------------------- */}
      <HeroSyncProvider>
        <div className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 content-center items-center gap-10 px-4 py-10 max-md:flex max-md:min-h-[calc(100svh-116px)] max-md:flex-col max-md:justify-evenly max-md:gap-2 max-md:px-4 max-md:py-2.5 max-md:pb-16 md:px-8 lg:grid-cols-12 lg:gap-8 lg:px-10 xl:gap-10 xl:px-8 [@media(min-height:800px)]:max-md:gap-4">
          {/* Copy + cartão de embarque (no mobile os filhos são reordenados) */}
          <div className="max-md:contents lg:col-span-6">
            <div className="relative min-w-0 max-md:order-1 max-md:pt-5">
              {/* Mobile: gradiente radial suave só atrás do bloco de texto */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-x-6 -inset-y-4 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(7,19,41,0.7)_0%,rgba(7,19,41,0.35)_45%,transparent_75%)] md:hidden"
              />
              <h1 className="font-poppins text-5xl font-extrabold uppercase leading-[1.08] tracking-tight text-white max-md:text-center max-md:text-2xl max-md:leading-[1.1] sm:text-6xl max-md:sm:text-[28px] lg:text-[44px] xl:text-6xl">
                O <span className="text-[#F59E0B]">MUNDO</span> EM
                <br />
                CADA <span className="text-[#F59E0B]">MORDIDA</span>
              </h1>

              <p className="mt-5 max-w-lg text-base leading-relaxed text-[#CBD5E1] max-md:mx-auto max-md:mt-1.5 max-md:max-w-xs max-md:text-center max-md:text-xs max-md:leading-snug max-md:text-slate-300">
                <span className="md:hidden">Hambúrgueres artesanais inspirados em cada país. Escolha seu próximo destino.</span>
                <span className="hidden md:inline">Hambúrgueres artesanais inspirados na gastronomia de cada país, preparados com ingredientes típicos. Escolha seu próximo destino.</span>
              </p>
            </div>

            <div className="mt-7 max-md:order-3 max-md:mt-0 max-md:w-full">
              <DigitalBoardingPass cards={cards} storeOpen={store.isOpen} />
            </div>
          </div>

          {/* Carrossel de passaportes */}
          <div className="relative min-w-0 max-md:order-2 lg:col-span-6">
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
      <div className="mx-auto w-full max-w-7xl px-4 pb-8 max-md:pb-3 md:px-8 lg:px-10 xl:px-8">
        {/* Mobile: faixa horizontal compacta */}
        <ul className="grid grid-cols-3 gap-2 border-t border-white/10 pt-3 text-center md:hidden">
          {FEATURES.map(({ icon: Icon, title }) => (
            <li key={title} className="flex flex-col items-center gap-1">
              <Icon className="h-4 w-4 text-[#F59E0B]" strokeWidth={1.75} />
              <p className="text-[11px] font-medium text-slate-300">{title}</p>
            </li>
          ))}
        </ul>
        <ul className="mx-auto hidden w-auto flex-wrap items-center justify-center gap-5 gap-x-12 text-white md:flex">
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
