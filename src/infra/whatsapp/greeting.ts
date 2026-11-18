/** Saudação por contexto temporal (funções puras, sempre no fuso de Brasília). */

const TZ = "America/Sao_Paulo";
/** Passadas mais de 6 h desde a última mensagem, o cliente é tratado como primeiro contato do dia. */
export const NEW_DAY_AFTER_MS = 6 * 60 * 60_000;

export type GreetingMode = "FIRST_TODAY" | "RETURNING_TODAY" | "IN_CONVERSATION";

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const hourFormat = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" });

const dayInSaoPaulo = (d: Date) => dayFormat.format(d);

/**
 * - FIRST_TODAY: sem mensagem anterior hoje (ou a última foi há mais de 6 h): cumprimenta pelo horário.
 * - RETURNING_TODAY: já conversou hoje, o atendimento foi encerrado e a sessão atual ainda não tem
 *   mensagens (a última é anterior a `sessionStartedAt`): segue natural, sem novo "Boa tarde/Boa noite".
 * - IN_CONVERSATION: já há mensagens na sessão atual: vai direto ao assunto.
 *
 * `lastMessageAt` = última mensagem do telefone, fora o lote que está sendo respondido.
 */
export function resolveGreetingMode(lastMessageAt: Date | null, sessionStartedAt: Date, now: Date): GreetingMode {
  if (!lastMessageAt) return "FIRST_TODAY";
  const sameDay = dayInSaoPaulo(lastMessageAt) === dayInSaoPaulo(now);
  const stale = now.getTime() - lastMessageAt.getTime() > NEW_DAY_AFTER_MS;
  if (!sameDay || stale) return "FIRST_TODAY";
  return lastMessageAt.getTime() >= sessionStartedAt.getTime() ? "IN_CONVERSATION" : "RETURNING_TODAY";
}

/** "Bom dia" (até 11h59), "Boa tarde" (12h–17h59) ou "Boa noite", pelo relógio de Brasília. */
export function greetingForHour(now: Date): "Bom dia" | "Boa tarde" | "Boa noite" {
  const hour = Number(hourFormat.format(now));
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}
