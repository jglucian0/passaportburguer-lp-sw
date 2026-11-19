import { MessageCircle } from "lucide-react";
import type { Metadata } from "next";

import { getStorefrontData } from "@/actions/storefront";
import { QuickCheckoutForm } from "@/components/quick-menu/quick-checkout-form";
import { QuickMenu } from "@/components/quick-menu/quick-menu";
import { db } from "@/infra/db";
import { whatsappMessages, whatsappSessions } from "@/infra/db/schema";
import { priceCart } from "@/infra/whatsapp/order-flow";
import { quickMenuClaimKey, businessWhatsAppNumber } from "@/infra/whatsapp/quick-cart";
import { loadQuickCheckoutPrefill } from "@/infra/whatsapp/quick-checkout";
import { verifyWhatsAppToken } from "@/infra/whatsapp/session-token";
import { getTenantId } from "@/infra/whatsapp/shared";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/* O token vive na URL: sem indexação e sem vazar em Referer. */
export const metadata: Metadata = {
  title: "Cardápio Rápido",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Notice({ title, text }: { title: string; text: string }) {
  const number = businessWhatsAppNumber();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#071329] p-8 text-center text-white">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
        <MessageCircle className="h-8 w-8" />
      </span>
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="max-w-sm text-sm text-white/70">{text}</p>
      {number ? (
        <a
          href={`https://wa.me/${number}`}
          className="rounded-2xl bg-[#25D366] px-6 py-3 font-bold text-[#052e16]"
        >
          Voltar para o WhatsApp
        </a>
      ) : null}
    </main>
  );
}

export default async function QuickMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";
  const claims = token ? verifyWhatsAppToken(token) : null;

  if (!claims || (claims.purpose !== "QUICK_MENU" && claims.purpose !== "QUICK_CHECKOUT")) {
    return (
      <Notice
        title="Este link expirou"
        text="Por segurança, o Cardápio Rápido vale por 30 minutos. Peça um novo link ao atendente no WhatsApp."
      />
    );
  }

  const [used] = await db
    .select({ id: whatsappMessages.id })
    .from(whatsappMessages)
    .where(eq(whatsappMessages.wamid, quickMenuClaimKey(token)))
    .limit(1);
  if (used) {
    return (
      <Notice
        title="Esse pedido já foi enviado"
        text="Esse link já foi usado. Para fazer outro pedido, peça um novo Cardápio Rápido no WhatsApp."
      />
    );
  }

  const tenantId = await getTenantId();
  if (!tenantId) return <Notice title="Loja indisponível" text="Não conseguimos carregar o cardápio agora. Tente de novo em instantes." />;
  const prefill = await loadQuickCheckoutPrefill(tenantId, claims.phone);

  /* Atalho "Repetir pedido": itens já salvos na sessão; só falta entrega/endereço (e cadastro, se novo). */
  if (claims.purpose === "QUICK_CHECKOUT") {
    const [session] = await db.select().from(whatsappSessions).where(eq(whatsappSessions.phone, claims.phone)).limit(1);
    const draft = session?.draftCart ?? [];
    const priced = draft.length > 0 ? await priceCart(tenantId, draft, "PICKUP", null, null) : null;
    if (!priced || !priced.ok) {
      return (
        <Notice
          title={priced && !priced.ok ? priced.error : "Seu pedido não está mais salvo"}
          text="Peça um novo Cardápio Rápido no WhatsApp para escolher seus itens."
        />
      );
    }
    return (
      <QuickCheckoutForm
        token={token}
        prefill={prefill}
        subtotalCents={priced.calc.subtotalCents}
        items={null}
        lines={priced.calc.lines.map((l, i) => ({
          key: String(i),
          text: `${l.quantity}x ${l.productName}`,
          detail: l.addons.length ? `+ ${l.addons.map((a) => `${a.quantity > 1 ? `${a.quantity}x ` : ""}${a.name}`).join(", ")}` : undefined,
          totalCents: l.totalItemCents,
        }))}
      />
    );
  }

  const data = await getStorefrontData();
  if (!data) {
    return <Notice title="Loja indisponível" text="Não conseguimos carregar o cardápio agora. Tente de novo em instantes." />;
  }

  return <QuickMenu tenant={data.tenant} store={data.store} categories={data.categories} token={token} prefill={prefill} />;
}
