import { Plane } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Destino não encontrado",
  robots: { index: false, follow: false },
};

/* Mesmos tokens da tela Meu Passaporte: faixa #071329, destaque #F59E0B, fundo #F4F6F9. */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col bg-[#F4F6F9] text-[#0A2540]">
      <header className="bg-[#071329] px-4 pb-10 pt-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#F59E0B]">Erro 404</p>
        <h1 className="mt-1 font-display text-3xl font-bold uppercase tracking-wide text-white">
          Passaporte <span className="text-[#F59E0B]">Burguer</span>
        </h1>
      </header>

      <div className="flex flex-1 items-start justify-center px-4 pb-24 pt-6">
        <section className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm sm:p-8">
          <Plane
            aria-hidden
            className="pointer-events-none absolute -right-3 -top-3 h-24 w-24 rotate-12 text-slate-900/[0.06]"
          />

          <span className="inline-block rounded-full border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#B45309]">
            Portão 404 • Rota indisponível
          </span>

          <h2 className="mt-4 font-display text-3xl font-bold uppercase tracking-wide text-[#0A2540]">
            Destino não encontrado
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            O endereço que você tentou acessar não existe ou mudou de rota.
          </p>

          <Link
            href="/"
            className="mt-6 flex w-full items-center justify-center rounded-xl bg-[#F59E0B] py-3 text-base font-semibold text-[#0A2540] transition hover:brightness-105"
          >
            Voltar para o Cardápio
          </Link>
          <Link
            href="/meus-pedidos"
            className="mt-4 block text-center text-sm text-slate-500 hover:text-slate-800"
          >
            Acessar Meu Passaporte
          </Link>
        </section>
      </div>
    </main>
  );
}
