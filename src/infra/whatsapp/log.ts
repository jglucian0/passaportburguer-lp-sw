/**
 * Resumo de erro seguro para log (LGPD).
 * As mensagens de erro do drizzle trazem uma linha `params: ...` com os valores da query
 * (telefone, texto do cliente, CPF). Aqui só sobra nome, código e a 1ª linha (a SQL com placeholders).
 */
export function errorSummary(error: unknown): string {
  if (!(error instanceof Error)) return "erro desconhecido";
  const e = error as Error & { code?: string; cause?: { code?: string } };
  const code = e.code ?? e.cause?.code;
  const firstLine = error.message.split("\n")[0].slice(0, 900);
  return `${error.name}${code ? ` [${code}]` : ""}: ${firstLine}`;
}
