/**
 * Ordenação do cardápio público: categorias de "Combos" sempre primeiro; as demais mantêm
 * a ordem recebida (sortOrder, nome). Função pura e estável.
 */
export function sortMenuCategories<T extends { name: string }>(categories: T[]): T[] {
  const isCombo = (c: T) => c.name.toLowerCase().includes("combo");
  return [...categories.filter(isCombo), ...categories.filter((c) => !isCombo(c))];
}
