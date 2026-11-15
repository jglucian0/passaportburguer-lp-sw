"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type OverlayContextValue = { count: number; register: () => () => void };

const OverlayContext = createContext<OverlayContextValue | null>(null);

/** Conta modais/drawers abertos para esconder a tab bar e a barra do carrinho. */
export function OverlayProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  const value = useMemo<OverlayContextValue>(
    () => ({
      count,
      register: () => {
        setCount((c) => c + 1);
        return () => setCount((c) => Math.max(0, c - 1));
      },
    }),
    [count],
  );
  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>;
}

export function useOverlayOpen(): boolean {
  return (useContext(OverlayContext)?.count ?? 0) > 0;
}

/** Registra um overlay enquanto `open` for true (use dentro de modais). */
export function useRegisterOverlay(open = true): void {
  const ctx = useContext(OverlayContext);
  const register = ctx?.register;
  useEffect(() => {
    if (!open || !register) return;
    return register();
  }, [open, register]);
}
