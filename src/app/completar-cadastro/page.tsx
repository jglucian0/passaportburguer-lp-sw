import { MessageCircle } from "lucide-react";
import type { Metadata } from "next";

import { CompleteRegistrationForm } from "@/components/quick-menu/complete-registration-form";
import { businessWhatsAppNumber } from "@/infra/whatsapp/quick-cart";
import { loadRegistrationPrefill, registrationTokenClaims } from "@/infra/whatsapp/registration";
import { toCustomerPhone } from "@/infra/whatsapp/shared";

export const dynamic = "force-dynamic";

/* O token vive na URL: sem indexação e sem vazar em Referer. */
export const metadata: Metadata = {
  title: "Completar cadastro",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function CompleteRegistrationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";
  const claims = token ? registrationTokenClaims(token) : null;

  if (!claims) {
    const number = businessWhatsAppNumber();
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#071329] p-8 text-center text-white">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
          <MessageCircle className="h-8 w-8" />
        </span>
        <h1 className="text-xl font-bold">Este link expirou</h1>
        <p className="max-w-sm text-sm text-white/70">
          O link para completar o cadastro vale por 24 horas. Chame a gente no WhatsApp para receber um novo.
        </p>
        {number ? (
          <a href={`https://wa.me/${number}`} className="rounded-2xl bg-[#25D366] px-6 py-3 font-bold text-[#052e16]">
            Voltar para o WhatsApp
          </a>
        ) : null}
      </main>
    );
  }

  const prefill = await loadRegistrationPrefill(claims);
  const local = toCustomerPhone(claims.phone) ?? "";
  // Só o DDD e os 4 últimos dígitos: o telefone completo não precisa aparecer na tela.
  const phoneLabel = local ? `(${local.slice(0, 2)}) •••••-${local.slice(-4)}` : "WhatsApp";

  return (
    <main className="min-h-dvh bg-[#071329] px-4 py-8">
      <div className="mx-auto max-w-md space-y-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo_passaporteburguer_nav.min.webp" alt="Passaporte Burguer" className="mx-auto h-12 w-auto" />
        <div className="space-y-1 text-center text-white">
          <h1 className="text-xl font-bold">Peça com 1 clique da próxima vez</h1>
          <p className="text-sm text-white/70">Leva 15 segundos. Sem senha e sem código de confirmação.</p>
        </div>
        <CompleteRegistrationForm token={token} phoneLabel={phoneLabel} prefill={prefill} />
      </div>
    </main>
  );
}
