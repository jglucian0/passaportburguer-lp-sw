/** CPF/CNPJ: máscara dinâmica e validação dos dígitos verificadores (puro; cliente e servidor). */

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Até 11 dígitos formata como CPF; de 12 a 14, como CNPJ. */
export function formatDocument(value: string): string {
  const d = onlyDigits(value).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3/$4")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, "$1.$2.$3/$4-$5");
}

function allEqual(d: string): boolean {
  return /^(\d)\1+$/.test(d);
}

function checkDigit(digits: number[], weights: number[]): number {
  const sum = digits.reduce((acc, n, i) => acc + n * weights[i], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCpf(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || allEqual(d)) return false;
  const n = d.split("").map(Number);
  const d1 = checkDigit(n.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigit(n.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === n[9] && d2 === n[10];
}

export function isValidCnpj(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 14 || allEqual(d)) return false;
  const n = d.split("").map(Number);
  const d1 = checkDigit(n.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigit(n.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === n[12] && d2 === n[13];
}

/** Mensagem de erro, ou null quando o documento é válido. */
export function documentError(value: string): string | null {
  const d = onlyDigits(value);
  if (d.length === 0) return "Informe o CPF ou CNPJ.";
  if (d.length <= 11) return isValidCpf(d) ? null : d.length < 11 ? "CPF incompleto." : "CPF inválido.";
  if (d.length === 14) return isValidCnpj(d) ? null : "CNPJ inválido.";
  return "CNPJ incompleto.";
}
