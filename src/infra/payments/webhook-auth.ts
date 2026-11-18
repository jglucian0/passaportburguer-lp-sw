import { createHash, timingSafeEqual } from "node:crypto";

/** Compara em tempo constante, sem vazar o tamanho do segredo (compara os SHA-256). */
export function tokenMatches(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
