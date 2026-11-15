import type { Metadata, Viewport } from "next";
import { Oswald, Plus_Jakarta_Sans, Poppins } from "next/font/google";
import type { ReactNode } from "react";

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
  title: {
    default: "Passaporte Burguer | Hamburgueria Artesanal",
    template: "%s | Passaporte Burguer",
  },
  description:
    "Não precisa de visto, só de vontade de saborear! Embarque em uma viagem de sabores do mundo com lanches temáticos feitos com ingredientes típicos de cada região.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#03257a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" data-scroll-behavior="smooth" className={`dark ${jakarta.variable} ${oswald.variable} ${poppins.variable}`}>
      <body className="min-h-dvh bg-background">{children}</body>
    </html>
  );
}
