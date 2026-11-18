const GRAPH = "https://graph.facebook.com/v21.0";

function env(name: "WHATSAPP_PHONE_NUMBER_ID" | "WHATSAPP_ACCESS_TOKEN"): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} não definida.`);
  return v;
}

async function graphPost(body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${GRAPH}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("WHATSAPP_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  // LGPD: só o status vai para o erro (o corpo pode conter telefone/mensagem).
  if (!res.ok) throw new Error(`WhatsApp API respondeu ${res.status}.`);
  return res.json();
}

export type ReplyButton = { id: string; title: string };

export function sendTextMessage(to: string, text: string) {
  return graphPost({
    to,
    type: "text",
    text: { body: text.slice(0, 4096), preview_url: false },
  });
}

/** Máximo 3 botões (limite da Meta); título até 20 caracteres. */
export function sendInteractiveButtons(to: string, bodyText: string, buttons: ReplyButton[]) {
  if (buttons.length < 1 || buttons.length > 3) {
    throw new Error("sendInteractiveButtons aceita de 1 a 3 botões.");
  }
  return graphPost({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText.slice(0, 1024) },
      action: {
        buttons: buttons.map((b) => ({
          type: "reply",
          reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
        })),
      },
    },
  });
}

/** Botão que abre um link direto (Cardápio Rápido / Checkout). */
export function sendCtaUrlButton(to: string, bodyText: string, buttonText: string, url: string) {
  return graphPost({
    to,
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: { text: bodyText.slice(0, 1024) },
      action: {
        name: "cta_url",
        parameters: { display_text: buttonText.slice(0, 20), url },
      },
    },
  });
}

/** Marca como lida (dois tiques azuis). */
export function markMessageAsRead(wamid: string) {
  return graphPost({ status: "read", message_id: wamid });
}

export type DownloadedMedia = { buffer: Buffer; mimeType: string };

/** Resolve a URL temporária da mídia e baixa o binário (a URL também exige o Bearer). */
export async function downloadMedia(mediaId: string): Promise<DownloadedMedia> {
  const auth = { Authorization: `Bearer ${env("WHATSAPP_ACCESS_TOKEN")}` };
  const metaRes = await fetch(`${GRAPH}/${encodeURIComponent(mediaId)}`, { headers: auth });
  if (!metaRes.ok) throw new Error(`Falha ao obter mídia (${metaRes.status}).`);
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) throw new Error("Mídia sem URL.");

  const fileRes = await fetch(meta.url, { headers: auth });
  if (!fileRes.ok) throw new Error(`Falha ao baixar mídia (${fileRes.status}).`);
  return {
    buffer: Buffer.from(await fileRes.arrayBuffer()),
    mimeType: meta.mime_type ?? fileRes.headers.get("content-type") ?? "application/octet-stream",
  };
}
