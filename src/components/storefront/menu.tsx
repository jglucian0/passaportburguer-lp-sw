"use client";

import { BadgeCheck, Globe2, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CatalogCategory, CatalogProduct } from "@/core/schemas/product";
import { cn } from "@/lib/utils";

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

const normalize = (text: string) =>
  text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

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
  const [popoverOpen, setPopoverOpen] = useState(false);
  const pillRefs = useRef(new Map<string, HTMLElement>());
  const spyLockUntil = useRef(0);
  const popoverRef = useRef<HTMLDivElement>(null);
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

  /* Categorias reais do cardápio, filtradas pelo destino ativo e pela busca (nome ou ingredientes). */
  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    return categories
      .map((category) => ({
        ...category,
        products: category.products.filter(
          (p) =>
            (active === "all" || destinationByProduct.get(p.id)?.id === active) &&
            (!needle || normalize(`${p.name} ${p.description ?? ""}`).includes(needle)),
        ),
      }))
      .filter((category) => category.products.length > 0);
  }, [categories, active, destinationByProduct, query]);

  const visibleKey = visible.map((c) => c.id).join("|");
  const currentCat =
    activeCat && visible.some((c) => c.id === activeCat) ? activeCat : (visible[0]?.id ?? null);

  /* Scroll-spy: a seção que cruza a faixa logo abaixo da barra sticky vira a categoria ativa. */
  useEffect(() => {
    const ids = visibleKey ? visibleKey.split("|") : [];
    if (ids.length === 0 || typeof IntersectionObserver === "undefined") return;

    const topOffset = window.matchMedia("(min-width: 768px)").matches ? 270 : 270;
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
    pillRefs.current
      .get(currentCat)
      ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [currentCat]);

  /* Popover dos carimbos: fecha ao clicar fora ou com ESC. */
  useEffect(() => {
    if (!popoverOpen) return;
    function onDown(event: MouseEvent | TouchEvent) {
      if (!popoverRef.current?.contains(event.target as Node)) setPopoverOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPopoverOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen]);

  const goToCategory = useCallback((id: string) => {
    setActiveCat(id);
    spyLockUntil.current = Date.now() + 900;
    document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  function openSearch() {
    setSearchOpen(true);
    requestAnimationFrame(() => searchInputRef.current?.focus());
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

  function choose(id: string) {
    setActive(id);
    document
      .getElementById("rota")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section id="cardapio" className="scroll-mt-20 bg-[#F4F6F9] text-[#0A2540]">
      {/* Carimbos + categorias: fixos juntos ao topo ao rolar (abaixo do header) */}
      <div className="sticky top-20 z-30 bg-[#F4F6F9]/95 backdrop-blur-md">
      {available.length > 0 ? (
        <div className="border-b border-slate-200/80">
          <div className="mx-auto flex max-w-5xl items-center">
          <nav aria-label="Filtrar por destino" className="no-scrollbar min-w-0 flex-1 overflow-x-auto">
            <ul className="flex items-end gap-2.5 px-4 py-4">
              <li>
                <button
                  type="button"
                  onClick={() => choose("all")}
                  aria-pressed={active === "all"}
                  className={cn(
                    "flex h-[84px] w-[72px] flex-col items-center justify-center gap-1 rounded-xl border-2 text-[11px] font-bold transition duration-150 ease-out active:scale-95",
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
                      onClick={() => choose(destination.id)}
                      aria-pressed={isActive}
                      aria-label={`${destination.city}${isVisited ? " (carimbado)" : ""}`}
                      className={cn(
                        "flex h-[84px] w-[72px] flex-col items-center justify-center rounded-xl border-2 px-1 transition duration-150 ease-out hover:-translate-y-0.5 active:scale-95",
                        isActive
                          ? "border-dashed border-[#0A2540] bg-[#F59E0B]"
                          : "border-transparent bg-[#0A2540] hover:bg-[#0A2540]/90",
                      )}
                    >
                      <PassportStamp
                        key={isVisited ? "visited" : "pending"}
                        stamp={destination.stamp}
                        destinationId={destination.id}
                        size={48}
                        distressed={false}
                        className={cn(
                          isActive
                            ? "text-[#0A2540] brightness-0"
                            : isVisited
                              ? "animate-stamp-in text-[#F59E0B]"
                              : "text-white opacity-60",
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

          {available.length > 1 ? (
            <div ref={popoverRef} className="relative shrink-0 pl-1 pr-4">
              <button
                type="button"
                onClick={() => setPopoverOpen((o) => !o)}
                aria-expanded={popoverOpen}
                aria-haspopup="dialog"
                className="rounded-lg px-2 py-1.5 text-right text-[11px] font-bold text-[#0A2540] transition hover:bg-slate-200/60 active:scale-95"
              >
                {visited.size}/{available.length}
                <span className="block font-medium text-[#475569] underline decoration-dotted underline-offset-2">
                  carimbos
                </span>
              </button>

              {popoverOpen ? (
                <div
                  role="dialog"
                  aria-label="Seus carimbos"
                  className="absolute right-3 top-full z-40 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl animate-in fade-in zoom-in-95 duration-150"
                >
                  <p className="text-xs font-bold text-[#0A2540]">
                    {passportComplete
                      ? "Passaporte completo! 🎉"
                      : `Faltam ${available.length - visited.size} destino(s) para completar`}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {available.map((d) => {
                      const done = visited.has(d.id);
                      return (
                        <li key={d.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setPopoverOpen(false);
                              choose(d.id);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-slate-100"
                          >
                            <span
                              className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                                done ? "bg-emerald-600 text-white" : "border border-slate-300 text-transparent",
                              )}
                            >
                              ✓
                            </span>
                            <span className={cn("font-semibold", done ? "text-[#0A2540]" : "text-slate-500")}>
                              {d.city}
                            </span>
                            <span className="ml-auto text-[10px] text-slate-400">
                              {done ? "no carrinho" : "explorar"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          </div>
        </div>
      ) : null}

      {/* Categorias */}
      <div className="border-b border-slate-200/80">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2.5">
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
              <ul className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto">
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
        className="mx-auto max-w-5xl scroll-mt-64 space-y-5 px-4 py-6 pb-32"
      >
        {passportComplete ? (
          <p className="animate-in fade-in zoom-in-95 rounded-2xl border-2 border-dashed border-[#F59E0B] bg-[#F59E0B]/10 p-4 text-center text-sm font-bold text-[#0A2540]">
            Passaporte completo! Você carimbou todos os destinos do cardápio.
            Bon voyage!
          </p>
        ) : null}

        {/* Cabeçalho do destino filtrado */}
        {activeDestination ? (
          <div className="flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <PassportStamp
              key={activeDestination.id}
              stamp={activeDestination.stamp}
              destinationId={activeDestination.id}
              size={92}
              className="shrink-0 animate-stamp-in text-[#0A2540]"
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
              <ul className="mt-2 flex flex-wrap gap-1.5">
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
          </div>
        ) : null}

        {visible.map((category) => (
          <div
            key={category.id}
            id={`cat-${category.id}`}
            data-cat={category.id}
            className="scroll-mt-64 space-y-4"
          >
            <h2 className="font-display text-xl font-bold uppercase tracking-wide text-[#0A2540]">
              {category.name}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {category.products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  destination={destinationByProduct.get(product.id) ?? null}
                  bestSeller={bestSellers.has(product.id)}
                  onSelect={setSelected}
                />
              ))}
            </div>
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
