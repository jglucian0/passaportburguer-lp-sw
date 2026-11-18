/**
 * Variações de um telefone brasileiro para casar o MESMO cliente, venha o número como vier.
 *
 * A Meta entrega `wa_id` de números antigos SEM o 9º dígito (554396098333), enquanto o cadastro
 * guarda COM ele (43996098333) — ou o contrário. Retorna, sem duplicatas:
 *   com DDI + 9º dígito, com DDI sem 9º dígito, sem DDI com 9º dígito, sem DDI sem 9º dígito.
 *
 * Só celular (primeiro dígito do número 6-9) ganha/perde o 9º dígito; fixo (2-5) fica como está.
 * Número que não é brasileiro volta apenas com os dígitos; sem dígitos, lista vazia.
 */
export function getBrazilianPhoneVariants(rawPhone: string): string[] {
  const digits = (rawPhone ?? "").replace(/\D/g, "");
  if (!digits) return [];

  let local: string | null = null;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) local = digits.slice(2);
  else if (digits.length === 10 || digits.length === 11) local = digits;
  if (!local) return [digits];

  const ddd = local.slice(0, 2);
  const number = local.slice(2); // 8 ou 9 dígitos
  let with9 = local;
  let without9 = local;
  if (number.length === 8 && /^[6-9]/.test(number)) with9 = `${ddd}9${number}`;
  if (number.length === 9 && number[0] === "9") without9 = `${ddd}${number.slice(1)}`;

  return [...new Set([`55${with9}`, `55${without9}`, with9, without9])];
}
