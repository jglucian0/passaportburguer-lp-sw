export type DayOpeningHours = {
  enabled: boolean;
  open: string; // "HH:mm"
  close: string; // "HH:mm"
};

export type OpeningHours = Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", DayOpeningHours>;

export type StoreStatusReason = "OPEN" | "MANUALLY_OPEN" | "MANUALLY_CLOSED" | "OUTSIDE_HOURS";

export type StoreStatus = {
  isOpen: boolean;
  reason: StoreStatusReason;
};

export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function getLocalClock(now: Date, timeZone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");

  return { day: WEEKDAY_INDEX[weekday] ?? 0, minutes: hour * 60 + minute };
}

function dayKey(day: number): keyof OpeningHours {
  return String(((day % 7) + 7) % 7) as keyof OpeningHours;
}

/**
 * Verifica se a loja está aberta. Suporta janelas que viram a madrugada
 * (ex: abre 18:00, fecha 00:30 — o trecho após a meia-noite pertence ao dia anterior).
 */
export function getStoreStatus(params: {
  openingHours: OpeningHours;
  /** true = aberta à força, false = fechada à força, null = segue o horário. */
  isOpenOverride: boolean | null;
  now?: Date;
  timeZone?: string;
}): StoreStatus {
  const { openingHours, isOpenOverride, now = new Date(), timeZone = DEFAULT_TIME_ZONE } = params;

  if (isOpenOverride === false) return { isOpen: false, reason: "MANUALLY_CLOSED" };
  if (isOpenOverride === true) return { isOpen: true, reason: "MANUALLY_OPEN" };

  const { day, minutes } = getLocalClock(now, timeZone);

  const today = openingHours[dayKey(day)];
  if (today?.enabled) {
    const open = toMinutes(today.open);
    const close = toMinutes(today.close);
    if (open < close && minutes >= open && minutes < close) return { isOpen: true, reason: "OPEN" };
    if (open > close && minutes >= open) return { isOpen: true, reason: "OPEN" };
  }

  const yesterday = openingHours[dayKey(day - 1)];
  if (yesterday?.enabled) {
    const open = toMinutes(yesterday.open);
    const close = toMinutes(yesterday.close);
    if (open > close && minutes < close) return { isOpen: true, reason: "OPEN" };
  }

  return { isOpen: false, reason: "OUTSIDE_HOURS" };
}

export function isStoreOpen(params: {
  openingHours: OpeningHours;
  isOpenOverride: boolean | null;
  now?: Date;
  timeZone?: string;
}): boolean {
  return getStoreStatus(params).isOpen;
}
