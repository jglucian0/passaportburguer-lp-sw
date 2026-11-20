import type { Metadata, Viewport } from "next";
import { Oswald, Plus_Jakarta_Sans, Poppins } from "next/font/google";
import type { ReactNode } from "react";

import { OG_IMAGE, SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";

import { AdPixels } from "@/components/analytics/ad-pixels";
import { AttributionCapture } from "@/components/analytics/attribution-capture";

import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const oswald = Oswald({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  variable: "--font-poppins",
  weight: ["700", "800", "900"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: "/",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE.url],
  },
  // Verificação de domínio da Meta (Business Manager).
  other: { "facebook-domain-verification": "0x1wg78yct78x4mc2qqaeqkqnfnfrf" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#03257a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" data-scroll-behavior="smooth" className={`dark ${jakarta.variable} ${oswald.variable} ${poppins.variable}`}>
      <body className="min-h-dvh bg-background">
        {children}
        <AttributionCapture />
        <AdPixels />
      </body>
    </html>
  );
}
