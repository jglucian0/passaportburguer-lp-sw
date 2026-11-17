/** Endereço estruturado devolvido pelas rotas /api/address/* e guardado no histórico do cliente. */
export type AddressSuggestion = {
  id: string;
  street: string;
  /** Número, quando a fonte já o informa (GPS, busca por endereço completo). */
  number: string | null;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  lat: number;
  lon: number;
  formattedLabel: string;
};

export function buildLabel(p: {
  street: string;
  number?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
}): string {
  const first = p.number ? `${p.street}, ${p.number}` : p.street;
  const place = [p.city, p.state].filter(Boolean).join(" - ");
  return [first, p.neighborhood, place].filter(Boolean).join(" • ");
}

/** Palavras que, antes de um número final, indicam zona/rodovia (e não número predial). */
const NOT_A_HOUSE_NUMBER_BEFORE = new Set(["zona", "br", "pr", "km", "rodovia", "pr-", "br-"]);

/**
 * Separa o número predial digitado no fim da busca.
 *   "Av. Mandacaru, 3449" -> { text: "Av. Mandacaru", number: "3449" }
 *   "Rua Santos Dumont 555" -> { text: "Rua Santos Dumont", number: "555" }
 * CEP (8 dígitos) nunca é tratado como número; números de 6+ dígitos também não.
 */
export function extractAddressNumber(query: string): { text: string; number: string | null } {
  const q = query.trim();
  if (q.replace(/\D/g, "").length === 8 && /^[\d\s.-]+$/.test(q)) return { text: q, number: null };

  const m = q.match(/^(.*?[^\d\s,.\-])[\s,]*(?:n[ºo°]?\.?\s*)?(\d{1,5})(?:\s*[a-zA-Z])?$/i);
  if (!m) return { text: q, number: null };

  const text = m[1].trim();
  const lastWord = (text.split(/\s+/).pop() ?? "").toLowerCase().replace(/[.,]/g, "");
  if (NOT_A_HOUSE_NUMBER_BEFORE.has(lastWord) || text.length < 3) return { text: q, number: null };

  return { text, number: m[2] };
}
