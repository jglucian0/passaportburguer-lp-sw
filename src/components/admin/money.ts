/** "35,90" | "35.90" | "1.250,00" -> 3590 | 3590 | 125000. Retorna null se inválido. */
export function reaisToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : null;
}

/** 3590 -> "35,90" */
export function centsToReais(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
