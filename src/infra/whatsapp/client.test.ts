import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  alternateBrNumber,
  markMessageAsRead,
  resetRecipientRewrites,
  sanitizeApiErrorBody,
  sendCtaUrlButton,
  sendInteractiveButtons,
  sendTextMessage,
  truncate,
  WhatsAppApiError,
} from "./client";

const TOKEN = "EAAQtoken-secretissimo-123";
const PNID = "1467640073102153";
const fetchMock = vi.fn();

const ok = () => new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 });
const metaErr = (status: number, code: number, message: string, details = "") =>
  new Response(
    JSON.stringify({ error: { message, type: "OAuthException", code, error_data: { details }, fbtrace_id: "AbC123" } }),
    { status },
  );
const notAllowed = () =>
  metaErr(400, 131030, "(#131030) Recipient phone number not in allowed list", "Add recipient phone number to recipient list and try again.");

const sent = (i: number) => JSON.parse(String(fetchMock.mock.calls[i][1].body));
const toOf = (i: number) => sent(i).to as string;

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock.mockReset();
  resetRecipientRewrites();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", TOKEN);
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", PNID);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("log detalhado de erro da Graph API", () => {
  it("400: o Error e o console.error trazem status, endpoint e o corpo completo da Meta", async () => {
    fetchMock.mockResolvedValue(metaErr(400, 100, "(#100) Param text['body'] must be a non-empty string", "Body is required"));
    const e = (await sendTextMessage("5543999999999", "oi").catch((x: unknown) => x)) as WhatsAppApiError;

    expect(e).toBeInstanceOf(WhatsAppApiError);
    expect(e.status).toBe(400);
    expect(e.code).toBe(100);
    expect(e.endpoint).toBe(`POST /v21.0/${PNID}/messages`);
    expect(e.message).toContain("400");
    expect(e.message).toContain(`POST /v21.0/${PNID}/messages`);
    expect(e.message).toContain("Param text['body'] must be a non-empty string");
    expect(e.message).toContain("Body is required");

    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("400");
    expect(logged).toContain("Body is required");
  });

  it("nunca vaza o token de acesso (nem no corpo ecoado pela Meta) nem telefone completo", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 190, message: `Invalid token ${TOKEN} for 5543999999999` } }), { status: 401 }),
    );
    const e = (await sendTextMessage("5543999999999", "oi").catch((x: unknown) => x)) as WhatsAppApiError;
    const everything = e.message + errorSpy.mock.calls.flat().join(" ");
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain("5543999999999");
    expect(everything).toContain("<redacted>");
    // o token só trafega no header
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain(TOKEN);
  });

  it("corpo que não é JSON também aparece (sanitizado)", () => {
    expect(sanitizeApiErrorBody(`<html>erro ${TOKEN}</html>`)).toBe("<html>erro <redacted></html>");
  });
});

describe("wa_id original e retry do 9º dígito (#131030)", () => {
  it("envia para o wa_id exatamente como a Meta entregou (sem adicionar/remover o 9)", async () => {
    fetchMock.mockImplementation(async () => ok());
    await sendTextMessage("554399999999", "oi"); // 12 dígitos (sem o 9)
    await sendTextMessage("5543999999999", "oi"); // 13 dígitos
    expect(toOf(0)).toBe("554399999999");
    expect(toOf(1)).toBe("5543999999999");
    expect(fetchMock).toHaveBeenCalledTimes(2); // sem retry quando dá certo
  });

  it("alternateBrNumber alterna 12 <-> 13 e ignora o que não é celular BR", () => {
    expect(alternateBrNumber("554399999999")).toBe("5543999999999");
    expect(alternateBrNumber("5543999999999")).toBe("554399999999");
    expect(alternateBrNumber("554333334444")).toBeNull(); // fixo (começa com 3)
    expect(alternateBrNumber("15558188713")).toBeNull(); // EUA
    expect(alternateBrNumber("5543")).toBeNull();
  });

  it("#131030 em 12 dígitos: tenta de novo com o 9 e funciona", async () => {
    fetchMock.mockResolvedValueOnce(notAllowed()).mockResolvedValueOnce(ok());
    await expect(sendTextMessage("554399999999", "oi")).resolves.toBeDefined();
    expect(toOf(0)).toBe("554399999999");
    expect(toOf(1)).toBe("5543999999999");
  });

  it("#131030 em 13 dígitos: tenta de novo sem o 9 e funciona", async () => {
    fetchMock.mockResolvedValueOnce(notAllowed()).mockResolvedValueOnce(ok());
    await sendTextMessage("5543999999999", "oi");
    expect(toOf(1)).toBe("554399999999");
  });

  it("lembra a variante que funcionou: o próximo envio já vai direto, sem nova falha", async () => {
    fetchMock.mockResolvedValueOnce(notAllowed()).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    await sendTextMessage("554399999999", "1");
    await sendTextMessage("554399999999", "2");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(toOf(2)).toBe("5543999999999");
  });

  it("as duas variantes recusadas: lança o erro original, só 2 chamadas (sem loop)", async () => {
    fetchMock.mockImplementation(async () => notAllowed());
    const e = (await sendTextMessage("554399999999", "oi").catch((x: unknown) => x)) as WhatsAppApiError;
    expect(e.code).toBe(131030);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("número que não é BR de 12/13 dígitos: sem retry", async () => {
    fetchMock.mockResolvedValue(notAllowed());
    await sendTextMessage("15558188713", "oi").catch(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("outros erros (ex.: 400 de formato, 500) não disparam a troca do 9", async () => {
    fetchMock.mockResolvedValue(metaErr(400, 100, "invalid param"));
    await sendTextMessage("554399999999", "oi").catch(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("vale também para botões e CTA (mesma rota de envio)", async () => {
    fetchMock.mockResolvedValueOnce(notAllowed()).mockResolvedValueOnce(ok());
    await sendCtaUrlButton("554399999999", "corpo", "Abrir", "https://app.test/x");
    expect(toOf(1)).toBe("5543999999999");
    expect(sent(1).type).toBe("interactive"); // continua interativo
  });
});

describe("sanitização e fallback dos interativos", () => {
  it("trunca título (20) e corpo (1024) dentro dos limites da Meta, sem partir emoji", async () => {
    fetchMock.mockImplementation(async () => ok());
    await sendCtaUrlButton("5543999999999", "A".repeat(2000), "Abrir Cardápio Rápido Agora Mesmo", "https://app.test/x");
    const p = sent(0).interactive;
    expect(Array.from(p.action.parameters.display_text).length).toBeLessThanOrEqual(20);
    expect(Array.from(p.body.text).length).toBeLessThanOrEqual(1024);
    expect(p.body.text.endsWith("…")).toBe(true);

    fetchMock.mockClear();
    await sendInteractiveButtons("5543999999999", "corpo", [{ id: "x".repeat(300), title: "🍔".repeat(15) }]);
    const b = sent(0).interactive.action.buttons[0].reply;
    expect(Array.from(b.title)).toHaveLength(15); // emojis intactos (<= 20 pontos de código)
    expect(b.id.length).toBeLessThanOrEqual(256);

    expect(truncate("🍔".repeat(30), 20)).toBe("🍔".repeat(20)); // nunca um surrogate solto
    expect(truncate("abc", 20)).toBe("abc");
  });

  it("CTA recusado com 400: cai para texto simples com o corpo + a URL completa", async () => {
    fetchMock
      .mockResolvedValueOnce(metaErr(400, 100, "(#100) Invalid parameter", "url must be https"))
      .mockResolvedValueOnce(ok());
    const url = "http://localhost:3000/pagamento/abc?token=xyz";
    await expect(sendCtaUrlButton("5543999999999", "Toque para pagar", "Pagar com Cartão", url)).resolves.toBeDefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(0).type).toBe("interactive");
    const fb = sent(1);
    expect(fb.type).toBe("text");
    expect(fb.to).toBe("5543999999999");
    expect(fb.text.body).toBe(`Toque para pagar\n\n${url}`);
  });

  it("a URL do fallback nunca é cortada, mesmo com corpo enorme", async () => {
    fetchMock.mockResolvedValueOnce(metaErr(400, 100, "bad")).mockResolvedValueOnce(ok());
    const url = "https://app.test/" + "p".repeat(300);
    await sendCtaUrlButton("5543999999999", "B".repeat(6000), "Abrir", url);
    const body = sent(1).text.body as string;
    expect(body.endsWith(url)).toBe(true);
    expect(Array.from(body).length).toBeLessThanOrEqual(4096);
  });

  it("botões recusados com 400: cai para texto listando as opções", async () => {
    fetchMock.mockResolvedValueOnce(metaErr(400, 100, "bad")).mockResolvedValueOnce(ok());
    await sendInteractiveButtons("5543999999999", "Como prefere pagar?", [
      { id: "pix", title: "Pix" },
      { id: "card", title: "Cartão" },
    ]);
    expect(sent(1).type).toBe("text");
    expect(sent(1).text.body).toBe("Como prefere pagar?\n\n• Pix\n• Cartão");
  });

  it("erro de destinatário (#131030 persistente) NÃO vira fallback de texto (falharia igual)", async () => {
    fetchMock.mockImplementation(async () => notAllowed());
    await sendCtaUrlButton("554399999999", "corpo", "Abrir", "https://app.test/x").catch(() => {});
    // 2 chamadas (original + variante do 9), nenhuma de texto
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect([0, 1].every((i) => sent(i).type === "interactive")).toBe(true);
  });

  it("erro que não é 400 (ex.: 500) não cai para texto", async () => {
    fetchMock.mockResolvedValue(metaErr(500, 1, "internal"));
    const e = (await sendCtaUrlButton("5543999999999", "corpo", "Abrir", "https://app.test/x").catch((x: unknown) => x)) as WhatsAppApiError;
    expect(e.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("limites de botões continuam validados (1 a 3)", async () => {
    await expect(sendInteractiveButtons("5543999999999", "x", [])).rejects.toThrow(/1 a 3/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("markMessageAsRead", () => {
  it("não usa `to` (nada de troca de 9º dígito) e propaga o erro detalhado", async () => {
    fetchMock.mockResolvedValue(metaErr(400, 100, "message not found"));
    const e = (await markMessageAsRead("wamid.X").catch((x: unknown) => x)) as WhatsAppApiError;
    expect(e.message).toContain("message not found");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
