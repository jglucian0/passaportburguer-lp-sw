import { clsx, type ClassValue } from "clsx";
import type { CSSProperties } from "react";
import { twMerge } from "tailwind-merge";

export { formatCents } from "@/core/cart/calculate-cart";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "#f59e0b" -> "245 158 11" (canais usados por rgb(var(--brand-rgb) / alpha)). */
export function hexToRgbChannels(hex: string): string {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return "245 166 35";
  return `${parseInt(match[1], 16)} ${parseInt(match[2], 16)} ${parseInt(match[3], 16)}`;
}

export function brandStyle(hex: string): CSSProperties {
  return { ["--brand-rgb" as string]: hexToRgbChannels(hex) } as CSSProperties;
}

export function formatPhone(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function whatsappLink(phone: string, text?: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}
