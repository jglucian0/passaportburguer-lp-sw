import { MapPin, MessageCircle, Instagram, Star, UtensilsCrossed, type LucideIcon } from "lucide-react";
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
// TODO: trocar pelo link curto oficial do Google Meu Negócio (g.page/r/.../review) quando disponível.
const GOOGLE_REVIEW_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Passaporte Burguer ${ADDRESS} avaliações`)}`;

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
  twitter: { card: "summary_large_image", title: TITLE, description: SLOGAN, images: [OG_IMAGE.url] },
};

type LinkItem = { label: string; hint: string; href: string; icon: LucideIcon; external: boolean; primary?: boolean };

const base =
  "group flex w-full items-center gap-4 rounded-xl border px-6 py-4 text-left font-semibold transition duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400";
const primaryCls = `${base} border-amber-400 bg-[#F59E0B] text-[#0B132B] shadow-lg shadow-amber-500/20 hover:bg-amber-400`;
const secondaryCls = `${base} border-white/10 bg-white/5 text-slate-100 hover:border-amber-400/50 hover:bg-white/10`;

export default async function LinksPage() {
  const data = await getStorefrontData().catch(() => null);
  const phone = data?.tenant.phoneWhatsapp;

  const links: LinkItem[] = [
    { label: "Cardápio Online", hint: "Pedir pelo site", href: "/", icon: UtensilsCrossed, external: false, primary: true },
    ...(phone
      ? [
          {
            label: "Atendimento via WhatsApp",
            hint: "Tire suas dúvidas",
            href: whatsappLink(phone, "Olá! Vim pelo Instagram e gostaria de tirar uma dúvida."),
            icon: MessageCircle,
            external: true,
          },
        ]
      : []),
    { label: "Como Chegar", hint: "Google Maps", href: MAPS_URL, icon: MapPin, external: true },
    { label: "Nosso Instagram", hint: "@passaporteburguer", href: INSTAGRAM_URL, icon: Instagram, external: true },
    { label: "Avalie no Google", hint: "Conte como foi sua viagem", href: GOOGLE_REVIEW_URL, icon: Star, external: true },
  ];

  return (
    <main className="min-h-screen bg-[#0B132B] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-between px-4 py-8">
        <header className="flex flex-col items-center text-center">
          <Image
            src="/logo_passaporteburguer.webp"
            alt="Logo do Passaporte Burguer"
            width={112}
            height={112}
            priority
            className="h-28 w-28 rounded-full border-2 border-amber-400/60 object-cover shadow-lg"
          />
          <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-white">{TITLE}</h1>
          <p className="mt-2 text-sm font-medium text-amber-400">{SLOGAN}</p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
            <MapPin className="h-3.5 w-3.5" aria-hidden /> Av. São Paulo, 123 - Zona 07
          </p>
        </header>

        <nav aria-label="Links do Passaporte Burguer" className="my-8 flex w-full flex-col gap-3">
          {links.map(({ label, hint, href, icon: Icon, external, primary }) => {
            const content = (
              <>
                <Icon className={`h-6 w-6 shrink-0 ${primary ? "text-[#0B132B]" : "text-amber-400"}`} aria-hidden />
                <span className="flex flex-col leading-tight">
                  <span>{label}</span>
                  <span className={`text-xs font-normal ${primary ? "text-[#0B132B]/70" : "text-slate-400"}`}>{hint}</span>
                </span>
              </>
            );
            const cls = primary ? primaryCls : secondaryCls;
            return external ? (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer" className={cls}>
                {content}
              </a>
            ) : (
              <Link key={label} href={href} className={cls}>
                {content}
              </Link>
            );
          })}
        </nav>

        <footer className="text-center text-xs text-slate-500">
          Passaporte Burguer © 2026 • Todos os direitos reservados
        </footer>
      </div>
    </main>
  );
}
