"use client";

import { useCart } from "./cart-provider";

/** Espaço extra no fim da Hero (mobile) para a barra "Ver carrinho" não cobrir o conteúdo. */
export function HeroCartSpacer() {
  const { count, hydrated } = useCart();
  if (!hydrated || count === 0) return null;
  return <div aria-hidden="true" className="h-16 md:hidden" />;
}
