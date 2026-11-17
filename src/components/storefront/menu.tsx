"use client";

import { BadgeCheck, Globe2, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CatalogCategory, CatalogProduct } from "@/core/schemas/product";
import { cn, normalizeSearch } from "@/lib/utils";
import { centerInContainer, scrollToElement } from "@/lib/smooth-scroll";

import { useCart } from "./cart-provider";
import {
  DESTINATIONS,
  matchDestination,
  PASSPORT_SELECT_EVENT,
  type Destination,
} from "./destinations";
import { PassportStamp } from "./passport-stamp";
import { ProductCard } from "./product-card";
import { ProductModal } from "./product-modal";
import { pickBestSellers, pickUpsells } from "./upsell";

/** Combos: separa por número de pessoas (1, 2 ou 4) pelo nome. Outras categorias não mudam. */
function comboSections<P extends { name: string }>(category: { name: string; products: P[] }) {
  if (!/combo/i.test(category.name)) {
    return [{ title: null as string | null, products: category.products }];
  }
  const size = (n: string) => (/familia|4 batata/i.test(n) ? 4 : /2 batata/i.test(n) ? 2 : 1);
  return [
    { title: "Para 1 pessoa", products: category.products.filter((p) => size(p.name) === 1) },
    { title: "Para 2 pessoas", products: category.products.filter((p) => size(p.name) === 2) },
    { title: "Para 4 pessoas", products: category.products.filter((p) => size(p.name) === 4) },
  ].filter((g) => g.products.length > 0);
}

export function Menu({
  categories,
  storeOpen,
}: {
  categories: CatalogCategory[];
  storeOpen: boolean;
}) {
  const { lines } = useCart();
  const [selected, setSelected] = useState<CatalogProduct | null>(null);
  const [active, setActive] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const pillRefs = useRef(new Map<string, HTMLElement>());
  const spyLockUntil = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const upsells = useMemo(() => pickUpsells(categories), [categories]);
  const bestSellers = useMemo(() => pickBestSellers(categories), [categories]);
  const categoryNameByProduct = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) for (const p of c.products) map.set(p.id, c.name);
    return map;
  }, [categories]);

  /* Destino de cada produto + destinos que realmente têm itens no cardápio. */
  const { destinationByProduct, available } = useMemo(() => {
    const byProduct = new Map<string, Destination>();
    const ids = new Set<string>();

    for (const category of categories) {
      for (const product of category.products) {
        const destination = matchDestination(category.name, product.name);
        if (!destination) continue;
        byProduct.set(product.id, destination);
        ids.add(destination.id);
      }
    }

    return {
      destinationByProduct: byProduct,
      available: DESTINATIONS.filter((d) => ids.has(d.id)),
    };
  }, [categories]);

  /* Destinos "carimbados": os que já têm algum item no carrinho. */
  const visited = useMemo(() => {
    const ids = new Set<string>();
    for (const line of lines) {
      const destination = destinationByProduct.get(line.productId);
      if (destination) ids.add(destination.id);
    }
    return ids;
  }, [lines, destinationByProduct]);

  /* Os cartões do hero disparam este evento. */
  useEffect(() => {
    function onSelectDestination(event: Event) {
      const id = (event as CustomEvent<string>).detail;
      setActive(available.some((d) => d.id === id) ? id : "all");
      setQuery("");
      setSearchOpen(false);
    }
    window.addEventListener(PASSPORT_SELECT_EVENT, onSelectDestination);
    return () =>
      window.removeEventListener(PASSPORT_SELECT_EVENT, onSelectDestination);
  }, [available]);

  /* Deep-link vindo do Meu Passaporte: /?destino=<id>#cardapio filtra pelo destino e rola até o cardápio. */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("destino");
    if (!id || !available.some((d) => d.id === id)) return;
    setActive(id);
    const timer = window.setTimeout(() => scrollToElement(document.getElementById("cardapio")), 120);
    return () => window.clearTimeout(timer);
  }, [available]);

  /* Categorias reais do cardápio, filtradas pelo destino ativo e pela busca (nome ou ingredientes). */
  const visible = useMemo(() => {
    const needle = normalizeSearch(query);
    return categories
      .map((category) => ({
        ...category,
        products: category.products.filter(
          (p) =>
            (active === "all" || destinationByProduct.get(p.id)?.id === active) &&
            (!needle || normalizeSearch(`${p.name} ${p.description ?? ""}`).includes(needle)),
        ),
      }))
      .filter((category) => category.products.length > 0);
  }, [categories, active, destinationByProduct, query]);

  /* Os dois primeiros itens do cardápio carregam já; o resto fica lazy. */
  const [firstProductId, secondProductId] = visible
    .flatMap((c) => c.products)
    .slice(0, 2)
    .map((p) => p.id);

  const visibleKey = visible.map((c) => c.id).join("|");
  const currentCat =
    activeCat && visible.some((c) => c.id === activeCat) ? activeCat : (visible[0]?.id ?? null);

  /* Scroll-spy: a seção que cruza a faixa logo abaixo da barra sticky vira a categoria ativa. */
  useEffect(() => {
    const ids = visibleKey ? visibleKey.split("|") : [];
    if (ids.length === 0 || typeof IntersectionObserver === "undefined") return;

    const topOffset = window.matchMedia("(min-width: 768px)").matches ? 270 : 72;
    const inView = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute("data-cat");
          if (!id) continue;
          if (entry.isIntersecting) inView.add(id);
          else inView.delete(id);
        }
        if (Date.now() < spyLockUntil.current) return;
        const first = ids.find((id) => inView.has(id));
        if (first) setActiveCat(first);
      },
      { rootMargin: `-${topOffset}px 0px -60% 0px`, threshold: 0 },
    );

    for (const id of ids) {
      const el = document.getElementById(`cat-${id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [visibleKey]);

  /* Mantém a pílula ativa centralizada na barra horizontal. */
  useEffect(() => {
    if (!currentCat) return;
    /* Rola só a lista horizontal; scrollIntoView também rolaria a página (pulo ao recarregar). */
    const pill = pillRefs.current.get(currentCat);
    const list = pill?.closest("ul");
    if (!pill || !list) return;
    centerInContainer(list, pill);
  }, [currentCat]);

  const goToCategory = useCallback((id: string) => {
    setActiveCat(id);
    spyLockUntil.current = Date.now() + 900;
    scrollToElement(document.getElementById(`cat-${id}`));
  }, []);

  function openSearch() {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus({ preventScroll: true });
      /* No mobile, leva o início dos resultados ao topo para o teclado não cobrir os primeiros cards. */
      if (!window.matchMedia("(max-width: 767px)").matches) return;
      const first = visible[0] ? document.getElementById(`cat-${visible[0].id}`) : null;
      scrollToElement(first ?? document.getElementById("cardapio"));
    });
  }

  function closeSearch() {
    setSearchOpen(false);
    setQuery("");
  }

  if (categories.every((c) => c.products.length === 0)) {
    return (
      <section
        id="cardapio"
        className="bg-[#F4F6F9] px-4 py-16 text-center text-sm text-[#475569]"
      >
        O cardápio está sendo atualizado. Volte em instantes.
      </section>
    );
  }

  const activeDestination = available.find((d) => d.id === active) ?? null;
  const passportComplete =
    available.length > 1 && visited.size === available.length;

  function choose(id: string, el?: HTMLElement) {
    setActive(id);
    const list = el?.closest("nav");
    if (el && list) centerInContainer(list, el);
    scrollToElement(document.getElementById("rota"));
  }

  return (
    <section id="cardapio" className="scroll-mt-20 bg-[#F4F6F9] text-[#0A2540]">
      {/* Carimbos + categorias: fixos juntos ao topo ao rolar (abaixo do header) */}
      {/* Mobile: só a barra de categorias é sticky (wrapper vira `contents`); md+: ambos juntos */}
      <div className="contents md:sticky md:top-20 md:z-30 md:block md:bg-[#F4F6F9]/95 md:backdrop-blur-md">
        {available.length > 0 ? (
          <div className="border-b border-slate-200/80">
            <div className="relative mx-auto max-w-5xl">
              <nav
                aria-label="Filtrar por destino"
                className="no-scrollbar w-full overflow-x-auto"
              >
                <ul className="flex w-max min-w-full items-end gap-2.5 px-4 py-3">
                  <li>
                    <button
                      type="button"
                      onClick={(e) => choose("all", e.currentTarget)}
                      aria-pressed={active === "all"}
                      className={cn(
                        "flex h-[78px] min-w-[74px] flex-col items-center justify-center gap-1 rounded-xl border-2 text-[11px] font-bold transition duration-150 ease-out active:scale-95",
                        active === "all"
                          ? "border-dashed border-[#0A2540] bg-[#F59E0B] text-[#0A2540]"
                          : "border-transparent bg-[#0A2540] text-white hover:bg-[#0A2540]/90",
                      )}
                    >
                      <Globe2 className="h-6 w-6" strokeWidth={1.75} />
                      Todos
                    </button>
                  </li>

                  {available.map((destination) => {
                    const isActive = active === destination.id;
                    const isVisited = visited.has(destination.id);

                    return (
                      <li key={destination.id} className="relative">
                        <button
                          type="button"
                          onClick={(e) => choose(destination.id, e.currentTarget)}
                          aria-pressed={isActive}
                          aria-label={`${destination.city}${isVisited ? " (carimbado)" : ""}`}
                          className={cn(
                            "flex h-[78px] min-w-[74px] flex-col items-center justify-center rounded-xl border-2 px-1 transition duration-150 ease-out hover:-translate-y-0.5 active:scale-95",
                            isActive
                              ? "border-dashed border-[#0A2540] bg-[#F59E0B]"
                              : "border-transparent bg-[#0A2540] hover:bg-[#0A2540]/90",
                          )}
                        >
                          <PassportStamp
                            key={isVisited ? "visited" : "pending"}
                            stamp={destination.stamp}
                            destinationId={destination.id}
                            size={40}
                            distressed={false}
                            tone={isActive ? "blue" : isVisited ? "yellow" : "white"}
                            className={cn(
                              !isActive && isVisited && "animate-stamp-in",
                              !isActive && !isVisited && "opacity-60",
                            )}
                          />
                          <span
                            className={cn(
                              "mt-1 max-w-full truncate text-[10px] font-bold",
                              isActive ? "text-[#0A2540]" : "text-white",
                            )}
                          >
                            {destination.cardTitle}
                          </span>
                        </button>
                        {isVisited ? (
                          <BadgeCheck className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-[#F4F6F9] text-emerald-600" />
                        ) : null}
                      </li>
                    );
                  })}

                </ul>
              </nav>

            </div>
          </div>
        ) : null}

        {/* Categorias */}
        <div className="sticky top-0 z-30 h-14 border-b border-slate-200 bg-[#F4F6F9]/95 backdrop-blur-md md:static md:z-auto md:h-auto md:border-slate-200/80 md:bg-transparent md:backdrop-blur-none">
          <div className="mx-auto flex h-full max-w-5xl items-center gap-2 px-4 md:h-auto md:py-2.5">
            {searchOpen ? (
              <>
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && closeSearch()}
                    placeholder="Buscar lanche ou ingrediente..."
                    aria-label="Buscar no cardápio"
                    className="h-9 w-full rounded-full border border-slate-300 bg-white pl-9 pr-3 text-sm text-[#0A2540] placeholder:text-slate-400 focus:border-[#F59E0B] focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/30"
                  />
                </div>
                <button
                  type="button"
                  onClick={closeSearch}
                  aria-label="Fechar busca"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-[#0A2540] transition active:scale-95"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={openSearch}
                  aria-label="Buscar no cardápio"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-[#0A2540] transition hover:border-[#F59E0B] active:scale-95"
                >
                  <Search className="h-4 w-4" />
                </button>
                <ul className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto after:block after:w-2 after:shrink-0 after:content-['']">
                  {visible.map((category) => {
                    const isCurrent = category.id === currentCat;
                    return (
                      <li key={category.id} className="shrink-0">
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) pillRefs.current.set(category.id, el);
                            else pillRefs.current.delete(category.id);
                          }}
                          onClick={() => goToCategory(category.id)}
                          aria-current={isCurrent ? "true" : undefined}
                          className={cn(
                            "block whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition duration-150 ease-out active:scale-95",
                            isCurrent
                              ? "border-amber-500 bg-amber-50 font-semibold text-amber-950"
                              : "border-slate-300 bg-white font-semibold text-[#0A2540] hover:border-[#F59E0B] hover:bg-[#F59E0B]/10",
                          )}
                        >
                          {category.name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>

      <div
        id="rota"
        className="mx-auto max-w-5xl scroll-mt-16 space-y-5 md:scroll-mt-64 px-4 py-6 pb-32 md:pb-12"
      >
        {passportComplete ? (
          <p className="animate-in fade-in zoom-in-95 rounded-2xl border-2 border-dashed border-[#F59E0B] bg-[#F59E0B]/10 p-4 text-center text-sm font-bold text-[#0A2540]">
            Passaporte completo! Você carimbou todos os destinos do cardápio.
            Bon voyage!
          </p>
        ) : null}

        {/* Cabeçalho do destino filtrado */}
        {activeDestination ? (
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 md:gap-y-2 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <PassportStamp
              key={activeDestination.id}
              stamp={activeDestination.stamp}
              destinationId={activeDestination.id}
              size={92}
              tone="blue"
              className="shrink-0 animate-stamp-in md:row-span-2"
            />
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#B45309]">
                Destino • {activeDestination.country}
              </p>
              <h2 className="font-display text-2xl font-bold uppercase leading-tight text-[#0A2540]">
                {activeDestination.city}
              </h2>
              <p className="mt-1 text-sm text-[#475569]">
                {activeDestination.tagline}
              </p>
            </div>
            <ul className="col-span-2 flex flex-wrap gap-1.5 md:col-span-1 md:col-start-2">
              {activeDestination.ingredients.map((ingredient) => (
                <li
                  key={ingredient}
                  className="rounded-full border border-[#F59E0B]/50 bg-[#F59E0B]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#92400E]"
                >
                  {ingredient}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {visible.map((category) => (
          <div
            key={category.id}
            id={`cat-${category.id}`}
            data-cat={category.id}
            className="scroll-mt-16 space-y-4 md:scroll-mt-64"
          >
            <h2 className="font-display text-xl font-bold uppercase tracking-wide text-[#0A2540]">
              {category.name}
            </h2>
            {comboSections(category).map(({ title, products }) => (
              <div key={title ?? "all"} className="space-y-3">
                {title ? (
                  <h3 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-[0.2em] text-[#0a2540b3] after:h-px after:flex-1 after:bg-[#0a2540b3]/40">
                    {title}
                  </h3>
                ) : null}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {products.map((product) => (
                    <ProductCard
                      key={product.id}
                      priority={product.id === firstProductId || product.id === secondProductId}
                      product={product}
                      destination={destinationByProduct.get(product.id) ?? null}
                      bestSeller={bestSellers.has(product.id)}
                      onSelect={setSelected}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}

        {visible.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-[#475569]">
            {query.trim()
              ? `Nenhum item encontrado para “${query.trim()}”.`
              : "Nenhum lanche deste destino está disponível agora."}
          </p>
        ) : null}
      </div>

      {selected ? (
        <ProductModal
          key={selected.id}
          product={selected}
          storeOpen={storeOpen}
          categoryName={categoryNameByProduct.get(selected.id)}
          upsells={upsells}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </section>
  );
}
