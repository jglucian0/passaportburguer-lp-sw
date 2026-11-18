import { createHmac, timingSafeEqual } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";

import { CODE_REGEX, samePhone } from "@/infra/auth/otp";
import { db } from "@/infra/db";
import { maskPhone } from "@/infra/security/mask";
import { whatsappOtps } from "@/infra/db/schema";

export const dynamic = "force-dynamic";

/** GET: handshake de verificação do Webhook (Meta Cloud API). */
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (
    expected &&
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === expected
  ) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

function validSignature(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  /* Falha fechada: sem segredo ou sem assinatura, nada é aceito (em nenhum ambiente). */
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  const received = Buffer.from(header.slice(7), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
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
    console.error("[whatsapp-webhook] falha ao processar:", error);
    return new Response("Error", { status: 500 }); // a Meta reenvia
  }

  return new Response("OK", { status: 200 });
}
