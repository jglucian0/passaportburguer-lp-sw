/**
 * Regras puras da campanha de resgate (sem banco, sem I/O): sorteio do desconto, janela de envio,
 * código do cupom e textos humanizados. Tudo testável.
 */

export type MarketingConfig = {
  enabled: boolean;
  discountMinPercent: number;
  discountMaxPercent: number;
  fanBonusPercent: number;
  couponValidHours: number;
  couponMinOrderCents: number;
  minDaysBetween: number;
  sendFromHour: number;
  sendUntilHour: number;
  targetAtRisk: boolean;
  targetLost: boolean;
  /** Cliente de um pedido só: incentivo ao segundo pedido (uma vez, a partir de NEW_CUSTOMER_MIN_DAYS dias). */
  targetNew: boolean;
};

/** Dias depois do primeiro pedido para convidar ao segundo. */
export const NEW_CUSTOMER_MIN_DAYS = 7;

export const DEFAULT_MARKETING_CONFIG: MarketingConfig = {
  enabled: false,
  discountMinPercent: 5,
  discountMaxPercent: 15,
  fanBonusPercent: 5,
  couponValidHours: 48,
  couponMinOrderCents: 0,
  minDaysBetween: 7,
  sendFromHour: 10,
  sendUntilHour: 21,
  targetAtRisk: true,
  targetLost: true,
  targetNew: true,
};

/** Desconto sorteado entre o mínimo e o máximo do admin; fã ganha o bônus, sempre limitado ao máximo. */
export function pickDiscountPercent(config: MarketingConfig, isFan: boolean, random: () => number = Math.random): number {
  const min = Math.max(1, Math.min(config.discountMinPercent, config.discountMaxPercent));
  const max = Math.min(100, Math.max(config.discountMinPercent, config.discountMaxPercent));
  const drawn = min + Math.floor(random() * (max - min + 1));
  return Math.min(max, drawn + (isFan ? Math.max(0, config.fanBonusPercent) : 0));
}

/** Só envia no horário comercial do admin (hora local de Brasília, [from, until)). */
export function isWithinSendHours(hour: number, config: Pick<MarketingConfig, "sendFromHour" | "sendUntilHour">): boolean {
  const { sendFromHour: from, sendUntilHour: until } = config;
  return from <= until ? hour >= from && hour < until : hour >= from || hour < until;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I, fácil de ditar

/** Ex.: VOLTA-7K2QX, FAMILIA-9TR4M. */
export function couponCodeFor(isFan: boolean, random: () => number = Math.random, prefix?: string): string {
  let suffix = "";
  for (let i = 0; i < 5; i++) suffix += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return `${prefix ?? (isFan ? "FAMILIA" : "VOLTA")}-${suffix}`;
}

/** "quinta, 19/11 às 21h" (hora de Brasília). */
export function formatCouponDeadline(date: Date): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday").replace(/-feira$/, "");
  const minute = get("minute");
  const hour = String(Number(get("hour")));
  return `${weekday}, ${get("day")}/${get("month")} às ${hour}h${minute === "00" ? "" : minute}`;
}

export type WinbackCopyInput = {
  firstName: string;
  favoriteName: string | null;
  percent: number;
  deadline: string;
  isFan: boolean;
};

/** Segundo pedido: quem fez só um pedido e ainda não voltou. Tom de "gostou?", não de saudade. */
export function secondOrderMessage(input: WinbackCopyInput, variant: number): string {
  const { firstName, favoriteName, percent, deadline } = input;
  const fav = favoriteName ? `o seu ${favoriteName}` : "o seu burger";
  const variants = [
    `Oi, ${firstName}! Aqui é do Passaporte Burguer 🍔 Curtiu ${fav}? Separei ${percent}% de desconto nos itens do seu próximo pedido, válido até ${deadline}. É só pedir que o desconto entra sozinho!`,
    `${firstName}, tudo certo com ${fav}? 😋 Liberei ${percent}% de desconto no seu segundo pedido, válido até ${deadline}. O desconto entra sozinho, é só pedir.`,
  ];
  return variants[((variant % variants.length) + variants.length) % variants.length];
}

/** Textos de resgate. Variam por sorteio (variant) e mudam de tom para o fã ("da família"). */
export function winbackMessage(input: WinbackCopyInput, variant: number): string {
  const { firstName, favoriteName, percent, deadline, isFan } = input;
  const fav = favoriteName ? `o seu ${favoriteName}` : "um burger";
  const saudade = favoriteName ? `do seu ${favoriteName}` : "de um burger";
  const variants = isFan
    ? [
        `${firstName}, você é da família Passaporte Burguer 🧡 Por isso separei ${percent}% de desconto nos itens do seu próximo pedido. Vale até ${deadline}, e o desconto entra sozinho. Bora de ${favoriteName ?? "burger"} hoje?`,
        `Oi, ${firstName}! Cliente da família merece mimo 🍔 Liberei ${percent}% de desconto no seu próximo pedido, válido até ${deadline}. Bateu a saudade ${saudade}?`,
      ]
    : [
        `Oi, ${firstName}! Faz um tempinho que a gente não te vê por aqui 😄 Bateu saudade ${saudade}? Separei ${percent}% de desconto nos itens do seu próximo pedido, válido até ${deadline}. Bora matar essa fome?`,
        `${firstName}, sumiu! 🍔 Passando pra avisar que liberei ${percent}% de desconto no seu próximo pedido, válido até ${deadline}. O desconto entra sozinho, é só pedir. Que tal ${fav} hoje?`,
      ];
  return variants[((variant % variants.length) + variants.length) % variants.length];
}
