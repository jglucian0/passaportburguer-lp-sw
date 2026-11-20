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
// Meta Pixel / GA4 só entram na política quando os ids estão configurados.
const pixelOn = !!process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();
const gaOn = !!process.env.NEXT_PUBLIC_GA_ID?.trim();
const adScripts = [pixelOn ? "https://connect.facebook.net" : "", gaOn ? "https://www.googletagmanager.com" : ""].filter(Boolean);
const adConnect = [
  pixelOn ? "https://www.facebook.com https://connect.facebook.net" : "",
  gaOn ? "https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com" : "",
].filter(Boolean);
const adImages = [pixelOn ? "https://www.facebook.com" : "", gaOn ? "https://www.google-analytics.com https://www.googletagmanager.com" : ""].filter(Boolean);

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com ${adScripts.join(" ")}${isDev ? " 'unsafe-eval'" : ""}`,
  "frame-src https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${imageOrigins.join(" ")} ${adImages.join(" ")}`.trim(),
  "font-src 'self' data:",
  `connect-src 'self' https://challenges.cloudflare.com ${adConnect.join(" ")}${isDev ? " ws: wss:" : ""}`,
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
