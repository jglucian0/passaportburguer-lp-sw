import { ChevronRight, Clock, MessageCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export const LEGAL_UPDATED_AT = "16 de novembro de 2026";

/* TODO: ajustar com os dados reais antes de publicar. */
export const LEGAL_CONTACT = {
  company: "Passaporte Burguer",
  cnpj: "48.678.564/0001-04",
  city: "Maringá - PR",
  instagram: "https://www.instagram.com/passaporteburguer",
};

export type LegalSection = { id: string; title: string; body: ReactNode };

function contactHref(): string {
  const phone = process.env.STORE_WHATSAPP?.replace(/\D/g, "");
  if (!phone) return LEGAL_CONTACT.instagram;
  return `https://wa.me/${phone}?text=${encodeURIComponent("Olá Passaporte Burguer! Tenho uma dúvida sobre privacidade/termos.")}`;
}

const num = (i: number) => String(i + 1).padStart(2, "0");

export function LegalPage({
  eyebrow,
  title,
  highlight,
  intro,
  summary,
  sections,
  related,
}: {
  eyebrow: string;
  /** Título; `highlight` é a palavra destacada em dourado. */
  title: string;
  highlight: string;
  intro: string;
  summary: ReactNode;
  sections: LegalSection[];
  related: { href: string; label: string }[];
}) {
  const [before, after = ""] = title.split(highlight);
  const wa = contactHref();

  return (
    <div className="text-slate-300">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-white/10 bg-gradient-to-b from-[#0b1d3d] to-[#071329] px-4 pb-10 pt-8 sm:px-6 md:pb-14 md:pt-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-amber-400/10 blur-3xl"
        />
        <div className="relative mx-auto max-w-6xl">
          <nav aria-label="Você está em" className="flex items-center gap-1.5 text-xs text-slate-400">
            <Link href="/" className="transition hover:text-amber-400">
              Início
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-slate-200">{highlight === "Privacidade" ? "Política de Privacidade" : "Termos de Uso"}</span>
          </nav>

          <span className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-300">
            <ShieldCheck className="h-3.5 w-3.5" /> {eyebrow}
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            {before}
            <span className="text-amber-400">{highlight}</span>
            {after}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-300">{intro}</p>
          <p className="mt-5 inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-400">
            <Clock className="h-3.5 w-3.5 text-amber-400" /> Última atualização: {LEGAL_UPDATED_AT}
          </p>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[17rem_1fr] lg:gap-12 lg:py-14">
        {/* Lateral: sumário + contato */}
        <aside className="space-y-4 lg:sticky lg:top-28 lg:self-start">
          <nav aria-label="Nesta página" className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-white">Nesta página</h2>
            <ol className="mt-3 space-y-0.5">
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="group flex items-baseline gap-3 rounded-lg px-2 py-1.5 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white"
                  >
                    <span className="font-mono text-[11px] text-amber-400/70 group-hover:text-amber-400">
                      {num(i)}
                    </span>
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="hidden rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-5 lg:block">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-300">Dúvidas?</p>
            <p className="mt-2 text-sm text-slate-300">Fale com a gente sobre seus dados ou sobre estes termos.</p>
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex h-10 items-center justify-center gap-2 rounded-xl bg-[#22bb5a] text-sm font-bold text-white transition hover:brightness-105"
            >
              <MessageCircle className="h-4 w-4" /> Chamar no WhatsApp
            </a>
          </div>
        </aside>

        {/* Conteúdo */}
        <article className="min-w-0 space-y-5">
          <div className="rounded-2xl border-l-4 border-amber-400 bg-amber-400/[0.07] p-5 sm:p-6">
            <h2 className="text-sm font-bold uppercase tracking-wider text-amber-300">Em resumo</h2>
            <div className="mt-2 text-[15px] leading-relaxed text-slate-200 [&_strong]:text-white">{summary}</div>
          </div>

          {sections.map((s, i) => (
            <section
              key={s.id}
              id={s.id}
              className="scroll-mt-28 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-7"
            >
              <h2 className="flex items-baseline gap-3 text-xl font-extrabold text-white">
                <span className="font-mono text-sm font-bold text-amber-400">{num(i)}</span>
                {s.title}
              </h2>
              <div className="mt-3 space-y-3 text-[15px] leading-relaxed [&_a]:font-semibold [&_a]:text-amber-400 [&_a]:underline [&_a]:underline-offset-2 [&_li]:relative [&_li]:pl-5 [&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:top-[0.6em] [&_li]:before:h-1.5 [&_li]:before:w-1.5 [&_li]:before:rounded-full [&_li]:before:bg-amber-400 [&_strong]:font-semibold [&_strong]:text-white [&_ul]:space-y-2">
                {s.body}
              </div>
            </section>
          ))}

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            <h2 className="text-xs font-bold uppercase tracking-wider text-white">Veja também</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {related.map((r) => (
                <li key={r.href}>
                  <Link
                    href={r.href}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 transition hover:border-amber-400/50 hover:text-amber-400"
                  >
                    {r.label} <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#22bb5a] text-base font-bold text-white transition hover:brightness-105 lg:hidden"
          >
            <MessageCircle className="h-5 w-5" /> Dúvidas? Chamar no WhatsApp
          </a>
        </article>
      </div>
    </div>
  );
}
