import {
  MapPin,
  MessageCircle,
  Instagram,
  Star,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { getStorefrontData } from "@/actions/storefront";
import { OG_IMAGE, SITE_NAME } from "@/lib/site";
import { whatsappLink } from "@/lib/utils";

const TITLE = "Passaporte Burguer | Maringá";
const SLOGAN = "Não precisa de visto, só de vontade de saborear! ✈️";
const ADDRESS = "Av. São Paulo, 123 - Zona 07, Maringá - PR";

const INSTAGRAM_URL = "https://www.instagram.com/passaporteburguer";
const MAPS_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Passaporte Burguer ${ADDRESS}`)}`;
const GOOGLE_PLACE_ID = "ChIJXdJk2CbR7JQRPkk5dxkCbH8";
const GOOGLE_REVIEW_URL = `https://search.google.com/local/writereview?placeid=${GOOGLE_PLACE_ID}`;

export const metadata: Metadata = {
  title: "Links",
  description: `${SLOGAN} Peça pelo site, fale no WhatsApp, veja como chegar e siga o ${SITE_NAME}.`,
  alternates: { canonical: "/links" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: "/links",
    siteName: SITE_NAME,
    title: TITLE,
    description: SLOGAN,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: SLOGAN,
    images: [OG_IMAGE.url],
  },
};

type LinkItem = {
  label: string;
  hint: string;
  href: string;
  icon: LucideIcon;
  external: boolean;
  primary?: boolean;
};

const base =
  "group grid w-full grid-cols-[1.5rem_1fr_1.5rem] items-center gap-3 rounded-xl border px-4 py-4 text-center font-semibold transition duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400";
const primaryCls = `${base} border-amber-400 bg-[#F59E0B] text-[#0B132B] shadow-lg shadow-amber-500/20 hover:bg-amber-400`;
const secondaryCls = `${base} border-white/10 bg-white/5 text-slate-100 hover:border-amber-400/50 hover:bg-white/10`;

export default async function LinksPage() {
  const data = await getStorefrontData().catch(() => null);
  const phone = data?.tenant.phoneWhatsapp;

  const links: LinkItem[] = [
    {
      label: "Cardápio Online",
      hint: "Pedir pelo site",
      href: "/",
      icon: UtensilsCrossed,
      external: false,
      primary: true,
    },
    ...(phone
      ? [
          {
            label: "Atendimento via WhatsApp",
            hint: "Tire suas dúvidas",
            href: whatsappLink(
              phone,
              "Olá! Vim pelo Instagram e gostaria de tirar uma dúvida.",
            ),
            icon: MessageCircle,
            external: true,
          },
        ]
      : []),
    {
      label: "Como Chegar",
      hint: "Google Maps",
      href: MAPS_URL,
      icon: MapPin,
      external: true,
    },
    {
      label: "Nosso Instagram",
      hint: "@passaporteburguer",
      href: INSTAGRAM_URL,
      icon: Instagram,
      external: true,
    },
    {
      label: "Avalie no Google",
      hint: "Conte como foi sua viagem",
      href: GOOGLE_REVIEW_URL,
      icon: Star,
      external: true,
    },
  ];

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#0B132B] text-slate-100">
      {/* Brilho dourado atrás da logo: ancora o centro visual da página. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[42rem] w-[42rem] max-w-[140vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,158,11,0.14)_0%,rgba(245,158,11,0)_65%)]"
      />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center px-4 py-10 text-center sm:max-w-md sm:py-12">
        <div className="flex w-full flex-col items-center gap-8 sm:gap-10">
          <header className="flex w-full flex-col items-center space-y-3 text-center">
            <Image
              src="/logo_passaporteburguer_links.min.webp"
              alt="Logo do Passaporte Burguer"
              width={512}
              height={512}
              priority
              className="mx-auto block h-32 w-32 rounded-full object-contain sm:h-40 sm:w-40"
            />
            <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              {TITLE}
            </h1>
            <p className="text-sm font-medium text-amber-400">{SLOGAN}</p>
            <div className="flex flex-col items-center space-y-1">
              <p className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
                <MapPin className="h-3.5 w-3.5" aria-hidden /> Av. São Paulo,
                123 - Zona 07
              </p>
              <p className="flex items-center justify-center gap-2 text-xs font-light text-slate-400 sm:text-sm">
                🍞 Presencial &amp; Delivery 🛵
              </p>
              <p className="flex items-center justify-center gap-2 text-xs font-light text-slate-400 sm:text-sm">
                Quarta a Segunda das 18:00 às 23:00
              </p>
            </div>
          </header>

          <nav
            aria-label="Links do Passaporte Burguer"
            className="flex w-full flex-col items-center gap-3"
          >
            {links.map(
              ({ label, hint, href, icon: Icon, external, primary }) => {
                const content = (
                  <>
                    <Icon
                      className={`h-6 w-6 shrink-0 ${primary ? "text-[#0B132B]" : "text-amber-400"}`}
                      aria-hidden
                    />
                    <span className="flex min-w-0 flex-col items-center leading-tight">
                      <span>{label}</span>
                      <span
                        className={`text-xs font-normal ${primary ? "text-[#0B132B]/70" : "text-slate-400"}`}
                      >
                        {hint}
                      </span>
                    </span>
                    <span aria-hidden />
                  </>
                );
                const cls = primary ? primaryCls : secondaryCls;
                return external ? (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cls}
                  >
                    {content}
                  </a>
                ) : (
                  <Link key={label} href={href} className={cls}>
                    {content}
                  </Link>
                );
              },
            )}
          </nav>

          <footer className="text-center text-xs text-slate-500">
            Passaporte Burguer © 2026 • Todos os direitos reservados
          </footer>
        </div>
      </div>
    </main>
  );
}
