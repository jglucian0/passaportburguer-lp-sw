import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/** Origem (esquema + host) de uma URL de env, ou null se ausente/inválida. */
function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.replace(/\{[^}]*\}/g, "0")).origin;
  } catch {
    return null;
  }
}

const imageOrigins = [
  originOf(process.env.R2_PUBLIC_URL),
  originOf(process.env.NEXT_PUBLIC_MAP_TILES_URL) ?? "https://tile.openstreetmap.org",
].filter((o): o is string => o !== null);

/**
 * CSP sem nonce: o Next injeta scripts inline de hidratação, então `script-src` precisa de
 * 'unsafe-inline' (e 'unsafe-eval' só em dev). O ganho está nas demais diretivas:
 * sem plugins, sem framing, sem base/form hijack e conexões restritas à própria origem.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${imageOrigins.join(" ")}`.trim(),
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Content-Security-Policy", value: csp },
          {
            key: "Permissions-Policy",
            value:
              "geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
