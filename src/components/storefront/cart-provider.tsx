"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  buildLineKey,
  lineTotal,
  loadCart,
  MAX_LINE_QUANTITY,
  saveCart,
  type CartLine,
} from "./cart-storage";

type CartContextValue = {
  tenantId: string;
  lines: CartLine[];
  hydrated: boolean;
  count: number;
  subtotalCents: number;
  isOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  addLine: (line: Omit<CartLine, "key">) => void;
  setQuantity: (key: string, quantity: number) => void;
  removeLine: (key: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ tenantId, children }: { tenantId: string; children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setLines(loadCart(tenantId));
    setHydrated(true);
  }, [tenantId]);

  useEffect(() => {
    if (hydrated) saveCart(tenantId, lines);
  }, [tenantId, lines, hydrated]);

  const addLine = useCallback((line: Omit<CartLine, "key">) => {
    const key = buildLineKey(line.productId, line.addons, line.note ?? "");
    setLines((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) =>
          l.key === key
            ? { ...l, quantity: Math.min(MAX_LINE_QUANTITY, l.quantity + line.quantity) }
            : l,
        );
      }
      return [...prev, { ...line, key, quantity: Math.min(MAX_LINE_QUANTITY, line.quantity) }];
    });
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.key !== key)
        : prev.map((l) =>
            l.key === key ? { ...l, quantity: Math.min(MAX_LINE_QUANTITY, quantity) } : l,
          ),
    );
  }, []);

  const removeLine = useCallback((key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }, []);

  const clear = useCallback(() => setLines([]), []);
  const openCart = useCallback(() => setIsOpen(true), []);
  const closeCart = useCallback(() => setIsOpen(false), []);

  const value = useMemo<CartContextValue>(
    () => ({
      tenantId,
      lines,
      hydrated,
      count: lines.reduce((sum, l) => sum + l.quantity, 0),
      subtotalCents: lines.reduce((sum, l) => sum + lineTotal(l), 0),
      isOpen,
      openCart,
      closeCart,
      addLine,
      setQuantity,
      removeLine,
      clear,
    }),
    [tenantId, lines, hydrated, isOpen, openCart, closeCart, addLine, setQuantity, removeLine, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart deve ser usado dentro de <CartProvider>.");
  return ctx;
}
