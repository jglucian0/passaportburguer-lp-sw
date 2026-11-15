export type CartLineAddon = {
  addonId: string;
  name: string;
  priceCents: number;
  quantity: number;
};

export type CartLine = {
  key: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
  addons: CartLineAddon[];
  /** Observação do cliente para este item (ex: sem cebola). */
  note?: string;
};

export const MAX_LINE_QUANTITY = 50;

/** Flag em sessionStorage: o checkout marca antes de enviar; /meus-pedidos limpa o carrinho ao chegar. */
export const ORDER_PLACED_FLAG = "pb:order-placed";
export const CUSTOMER_PREFILL_KEY = "pb:customer";
/** Bairro escolhido no cartão de embarque do hero; o checkout pré-seleciona. */
export const ZONE_PREFILL_KEY = "pb:zone";

export function cartStorageKey(tenantId: string): string {
  return `cart:${tenantId}`;
}

export function buildLineKey(productId: string, addons: CartLineAddon[], note = ""): string {
  const signature = [...addons]
    .sort((a, b) => a.addonId.localeCompare(b.addonId))
    .map((a) => `${a.addonId}x${a.quantity}`)
    .join(",");
  return note ? `${productId}|${signature}|${note}` : `${productId}|${signature}`;
}

export function lineUnitTotal(line: Pick<CartLine, "unitPriceCents" | "addons">): number {
  return line.unitPriceCents + line.addons.reduce((sum, a) => sum + a.priceCents * a.quantity, 0);
}

export function lineTotal(line: CartLine): number {
  return lineUnitTotal(line) * line.quantity;
}

export function loadCart(tenantId: string): CartLine[] {
  try {
    const raw = window.localStorage.getItem(cartStorageKey(tenantId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartLine[]) : [];
  } catch {
    return [];
  }
}

export function saveCart(tenantId: string, lines: CartLine[]): void {
  try {
    window.localStorage.setItem(cartStorageKey(tenantId), JSON.stringify(lines));
  } catch {
    /* armazenamento indisponível: carrinho vive apenas em memória */
  }
}

export function clearStoredCart(tenantId: string): void {
  try {
    window.localStorage.removeItem(cartStorageKey(tenantId));
  } catch {
    /* ignorar */
  }
}
