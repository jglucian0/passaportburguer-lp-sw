/**
 * Histórico de endereços de entrega do cliente (localStorage).
 * Regra: sempre que houver ao menos 1 endereço, o último nunca pode ser excluído.
 */

export type ConfirmedAddress = {
  id: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  lat: number;
  lon: number;
  usedAt: number;
};

export type AddressBook = { activeId: string | null; items: ConfirmedAddress[] };

const KEY = "pb:address-book";
const MAX_ITEMS = 8;

export const EMPTY_BOOK: AddressBook = { activeId: null, items: [] };

function isAddress(a: unknown): a is ConfirmedAddress {
  if (!a || typeof a !== "object") return false;
  const x = a as Record<string, unknown>;
  return (
    typeof x.id === "string" &&
    typeof x.street === "string" &&
    typeof x.number === "string" &&
    typeof x.city === "string" &&
    typeof x.lat === "number" &&
    typeof x.lon === "number"
  );
}

export function addressKey(a: Pick<ConfirmedAddress, "street" | "number" | "complement" | "neighborhood" | "city">) {
  return [a.street, a.number, a.complement, a.neighborhood, a.city]
    .map((v) => v.trim().toLowerCase())
    .join("|");
}

export function formatAddressLine(a: Pick<ConfirmedAddress, "street" | "number" | "complement">): string {
  const base = `${a.street}, ${a.number}`;
  return a.complement ? `${base} — ${a.complement}` : base;
}

export function loadAddressBook(): AddressBook {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY_BOOK;
    const parsed = JSON.parse(raw) as Partial<AddressBook>;
    const items = (Array.isArray(parsed.items) ? parsed.items : []).filter(isAddress).map((a) => ({
      ...a,
      complement: a.complement ?? "",
      neighborhood: a.neighborhood ?? "",
      state: a.state ?? "",
      postalCode: a.postalCode ?? "",
      usedAt: typeof a.usedAt === "number" ? a.usedAt : 0,
    }));
    const activeId = items.some((i) => i.id === parsed.activeId)
      ? (parsed.activeId as string)
      : ([...items].sort((a, b) => b.usedAt - a.usedAt)[0]?.id ?? null);
    return { activeId, items };
  } catch {
    return EMPTY_BOOK;
  }
}

function persist(book: AddressBook): AddressBook {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(book));
  } catch {
    /* armazenamento indisponível: segue só em memória */
  }
  return book;
}

/** Salva (ou atualiza) o endereço e o torna o ativo. */
export function saveAndActivate(book: AddressBook, input: Omit<ConfirmedAddress, "id" | "usedAt">): {
  book: AddressBook;
  address: ConfirmedAddress;
} {
  const existing = book.items.find((i) => addressKey(i) === addressKey(input));
  const address: ConfirmedAddress = {
    ...input,
    id: existing?.id ?? crypto.randomUUID(),
    usedAt: Date.now(),
  };
  const others = book.items.filter((i) => i.id !== address.id);
  const items = [address, ...others].slice(0, MAX_ITEMS);
  return { book: persist({ activeId: address.id, items }), address };
}

export function activate(book: AddressBook, id: string): { book: AddressBook; address: ConfirmedAddress | null } {
  const found = book.items.find((i) => i.id === id);
  if (!found) return { book, address: null };
  const address = { ...found, usedAt: Date.now() };
  const items = [address, ...book.items.filter((i) => i.id !== id)];
  return { book: persist({ activeId: id, items }), address };
}

export function canRemove(book: AddressBook): boolean {
  return book.items.length > 1;
}

/** Remove um endereço; recusa quando restaria zero (sempre fica ao menos 1). */
export function removeAddress(book: AddressBook, id: string): AddressBook {
  if (!canRemove(book) || !book.items.some((i) => i.id === id)) return book;
  const items = book.items.filter((i) => i.id !== id);
  const activeId =
    book.activeId && book.activeId !== id
      ? book.activeId
      : ([...items].sort((a, b) => b.usedAt - a.usedAt)[0]?.id ?? null);
  return persist({ activeId, items });
}
