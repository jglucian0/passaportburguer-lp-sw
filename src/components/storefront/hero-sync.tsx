"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type HeroSyncValue = {
  /** Slide ativo do carrossel de destinos. */
  index: number;
  setIndex: (next: number | ((prev: number) => number)) => void;
};

const HeroSyncContext = createContext<HeroSyncValue | null>(null);

/** Compartilha o destino ativo entre o carrossel e o cartão de embarque. */
export function HeroSyncProvider({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState(0);
  const value = useMemo(() => ({ index, setIndex }), [index]);
  return <HeroSyncContext.Provider value={value}>{children}</HeroSyncContext.Provider>;
}

export function useHeroSync(): HeroSyncValue {
  const ctx = useContext(HeroSyncContext);
  if (!ctx) throw new Error("useHeroSync deve ser usado dentro de <HeroSyncProvider>");
  return ctx;
}
