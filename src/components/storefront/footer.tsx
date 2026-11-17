import { Clock, Instagram, MapPin, MessageCircle } from "lucide-react";
import Link from "next/link";

import type { PublicTenant } from "@/actions/storefront";
import { whatsappLink } from "@/lib/utils";

// TODO: ajustar com os dados reais da unidade.
const INSTAGRAM_URL = "https://www.instagram.com/passaporteburguer";
const ADDRESS = "Maringá - PR";
const MAPS_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Passaporte Burguer ${ADDRESS}`)}`;

const PAYMENTS = ["PIX", "Cartão de Crédito", "Débito", "Dinheiro"];

const columnTitle = "mb-3 text-xs font-bold uppercase tracking-wider text-white";
const contactBtn =
  "inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs transition hover:border-amber-400/50 hover:text-white";
const navLink = "text-sm text-slate-300 transition hover:text-amber-400";

export function Footer({ tenant }: { tenant: PublicTenant }) {
  return (
    <footer className="border-t border-white/10 bg-[#071329] px-4 pb-32 pt-12 text-slate-300 sm:px-6 md:pb-10">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 md:grid-cols-3 lg:gap-12">
        {/* Coluna 1 — Identidade */}
        <div>
          <p className="text-lg font-extrabold uppercase tracking-wide text-white">Passaporte Burguer</p>
          <p className="mt-3 text-sm font-medium text-amber-400">
            Não precisa de visto, só de vontade de saborear!
          </p>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Hambúrgueres artesanais inspirados na gastronomia mundial, preparados na hora com ingredientes
            selecionados.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className={contactBtn}>
              <Instagram className="h-4 w-4" /> Instagram
            </a>
            {tenant.phoneWhatsapp ? (
              <a
                href={whatsappLink(tenant.phoneWhatsapp)}
                target="_blank"
                rel="noopener noreferrer"
                className={contactBtn}
              >
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </a>
            ) : null}
          </div>
        </div>

        {/* Coluna 2 — Horário & Retirada */}
        <div>
          <h3 className={columnTitle}>Horário &amp; Retirada</h3>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-start gap-2">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <span>Terça a Domingo: 18h30 às 23h30</span>
            </li>
            <li className="pl-6 text-slate-400">Segunda: Fechado</li>
          </ul>
          <a
            href={MAPS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex items-start gap-2 text-sm transition hover:text-amber-400"
          >
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <span>{ADDRESS}</span>
          </a>
        </div>

        {/* Coluna 3 — Navegação & Pagamento */}
        <div>
          <h3 className={columnTitle}>Acesso Rápido</h3>
          <nav aria-label="Links do rodapé" className="flex flex-col gap-2">
            <Link href="/#cardapio" className={navLink}>
              Cardápio
            </Link>
            <Link href="/meus-pedidos" className={navLink}>
              Acompanhar meus pedidos
            </Link>
            <Link href="/meus-pedidos" className={navLink}>
              Fazer Login / Minha Conta
            </Link>
          </nav>
          <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Formas de pagamento
          </p>
          <ul className="flex flex-wrap gap-2">
            {PAYMENTS.map((p) => (
              <li
                key={p}
                className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300"
              >
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mx-auto mt-10 flex max-w-6xl flex-col items-center justify-between gap-2 border-t border-dashed border-white/15 pt-6 text-xs text-slate-400 sm:flex-row">
        <p>
          © {new Date().getFullYear()} Passaporte Burguer. Todos os direitos reservados.{" "}
          <span className="whitespace-nowrap">CNPJ 48.678.564/0001-04</span>
        </p>
        <p className="flex items-center gap-3">
          <Link href="/termos" className="transition hover:text-amber-400">
            Termos de Uso
          </Link>
          <Link href="/privacidade" className="transition hover:text-amber-400">
            Privacidade
          </Link>
        </p>
        <p className="font-mono text-[11px] text-slate-500">OPERAÇÃO MGA • MARINGÁ - PR</p>
      </div>
    </footer>
  );
}
