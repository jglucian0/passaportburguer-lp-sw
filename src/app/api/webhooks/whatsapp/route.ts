import { and, eq, gt } from "drizzle-orm";
import { after } from "next/server";

import { CODE_REGEX, samePhone } from "@/infra/auth/otp";
import { db } from "@/infra/db";
import { maskPhone } from "@/infra/security/mask";
import { whatsappOtps } from "@/infra/db/schema";
import { bufferInbound, processAfterDebounce } from "@/infra/whatsapp/inbox";
import { errorSummary } from "@/infra/whatsapp/log";
import { extractInboundMessages, safeEqual, verifyMetaSignature } from "@/infra/whatsapp/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* after() precisa sobreviver ao debounce de 5s + processamento do bot. */
export const maxDuration = 60;

/** GET: handshake de verificação do Webhook (Meta Cloud API). */
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  /* WHATSAPP_VERIFY_TOKEN é o nome novo; WHATSAPP_WEBHOOK_VERIFY_TOKEN segue aceito (legado). */
  const expected = process.env.WHATSAPP_VERIFY_TOKEN || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (
    expected &&
    params.get("hub.mode") === "subscribe" &&
    safeEqual(params.get("hub.verify_token"), expected)
  ) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

function validSignature(raw: string, header: string | null): boolean {
  /* Falha fechada: sem segredo ou sem assinatura, nada é aceito (em nenhum ambiente).
     WHATSAPP_APP_SECRET_2: segundo app da Meta apontando para o mesmo webhook (cada app tem o seu segredo). */
  return verifyMetaSignature(raw, header, [process.env.WHATSAPP_APP_SECRET, process.env.WHATSAPP_APP_SECRET_2]);
}

type MetaPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: Array<{ from?: string; type?: string; text?: { body?: string } }>;
      };
    }>;
  }>;
};

/** Resposta automática (best-effort): nunca lança erro nem atrasa o webhook por mais de 4s. */
async function sendConfirmation(phoneNumberId: string | undefined, to: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const numberId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !numberId) {
    console.warn("[WhatsApp Reply] WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID ausente; resposta automática não enviada");
    return;
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${numberId}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: {
            body: "✅ Código confirmado! Agora volte para a página do Passaporte Burguer no seu navegador para concluir seu cadastro.",
          },
        }),
        signal: AbortSignal.timeout(4000),
      },
    );
    /* Sem o corpo da resposta da Meta: ele ecoa o telefone do cliente (wa_id). */
    console.log("[WhatsApp Reply]", res.status, maskPhone(to));
  } catch (error) {
    console.warn("[WhatsApp Reply] erro ao enviar:", (error as Error).name, maskPhone(to));
  }
}

/** POST: mensagens recebidas. Marca como verificado o PASS-XXXX enviado pelo próprio número. */
export async function POST(request: Request) {
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: MetaPayload;
  try {
    payload = JSON.parse(raw) as MetaPayload;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  try {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value?.messages ?? []) {
          const from = message.from;
          const match = message.text?.body?.match(CODE_REGEX);
          if (!from || !match) continue;

          const code = match[0].toUpperCase();
          const [otp] = await db
            .select({ id: whatsappOtps.id, phone: whatsappOtps.phone })
            .from(whatsappOtps)
            .where(and(eq(whatsappOtps.code, code), gt(whatsappOtps.expiresAt, new Date())))
            .limit(1);

          /* O remetente precisa ser o mesmo telefone que iniciou o fluxo. */
          if (otp && samePhone(otp.phone, from)) {
            await db.update(whatsappOtps).set({ verified: true }).where(eq(whatsappOtps.id, otp.id));
            await sendConfirmation(change.value?.metadata?.phone_number_id, from);
          }
        }
      }
    }
  } catch (error) {
    console.error("[whatsapp-webhook] falha ao processar:", errorSummary(error));
    return new Response("Error", { status: 500 }); // a Meta reenvia
  }

  /* Bot: tudo que não é código OTP vai para o buffer (dedupe por wamid) e é processado após o debounce. */
  try {
    /* O bot só atende o número dele: mensagens recebidas em outro número (ex.: o do login por OTP) não entram. */
    const botNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const botMessages = extractInboundMessages(payload).filter(
      (m) =>
        !(m.mediaType === "text" && CODE_REGEX.test(m.content)) &&
        (!botNumberId || !m.phoneNumberId || m.phoneNumberId === botNumberId),
    );
    if (botMessages.length > 0) {
      const fresh = await bufferInbound(botMessages);
      const lastByPhone = new Map<string, string>();
      for (const m of fresh) lastByPhone.set(m.phone, m.wamid);
      for (const [phone, wamid] of lastByPhone) {
        after(() =>
          processAfterDebounce(phone, wamid).catch((error) =>
            console.error("[whatsapp-bot] falha no processamento:", errorSummary(error)),
          ),
        );
      }
    }
  } catch (error) {
    console.error("[whatsapp-bot] falha ao bufferizar:", errorSummary(error));
    return new Response("Error", { status: 500 }); // a Meta reenvia; o dedupe por wamid torna seguro
  }

  return new Response("OK", { status: 200 });
}
