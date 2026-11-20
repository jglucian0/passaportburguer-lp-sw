"use client";

import { useEffect } from "react";

import { ATTRIBUTION_COOKIE, ATTRIBUTION_DAYS, attributionFromSearch, sanitizeAttribution } from "@/lib/attribution";

function readCookie(name: string): string | null {
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/**
 * Guarda de onde o visitante veio (UTM, fbclid, gclid ou site de origem) num cookie de 30 dias, para o pedido
 * carregar a origem. Último clique de campanha vence; sem campanha, só preenche se ainda não houver origem.
 */
export function AttributionCapture() {
  useEffect(() => {
    try {
      const fromUrl = attributionFromSearch(window.location.search);
      const existing = (() => {
        try {
          return sanitizeAttribution(JSON.parse(readCookie(ATTRIBUTION_COOKIE) ?? "null"));
        } catch {
          return null;
        }
      })();

      let next = fromUrl;
      if (!next && !existing && document.referrer) {
        try {
          const host = new URL(document.referrer).hostname.replace(/^www\./, "");
          if (host && host !== window.location.hostname.replace(/^www\./, "")) {
            next = sanitizeAttribution({ source: host, medium: "referral" });
          }
        } catch {
          /* referrer inválido */
        }
      }
      if (!next) return;

      const fbp = readCookie("_fbp") ?? undefined;
      const value = encodeURIComponent(JSON.stringify({ ...next, fbp }));
      document.cookie = `${ATTRIBUTION_COOKIE}=${value}; max-age=${ATTRIBUTION_DAYS * 86400}; path=/; SameSite=Lax`;
    } catch {
      /* cookies bloqueados: sem origem, o pedido segue normal */
    }
  }, []);
  return null;
}
