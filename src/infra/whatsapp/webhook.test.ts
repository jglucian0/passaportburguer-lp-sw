import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { extractInboundMessages, verifyMetaSignature } from "./webhook";

const sign = (body: string, secret: string) =>
  "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

describe("verifyMetaSignature", () => {
  const body = '{"a":1}';
  it("aceita assinatura válida", () => {
    expect(verifyMetaSignature(body, sign(body, "s3"), "s3")).toBe(true);
  });
  it("rejeita corpo alterado, segredo errado, header ausente/sem prefixo", () => {
    expect(verifyMetaSignature('{"a":2}', sign(body, "s3"), "s3")).toBe(false);
    expect(verifyMetaSignature(body, sign(body, "x"), "s3")).toBe(false);
    expect(verifyMetaSignature(body, null, "s3")).toBe(false);
    expect(verifyMetaSignature(body, sign(body, "s3").slice(7), "s3")).toBe(false);
    expect(verifyMetaSignature(body, sign(body, "s3"), undefined)).toBe(false);
  });
});

describe("verifyMetaSignature com dois apps (mesmo webhook)", () => {
  const body = '{"a":1}';
  it("aceita a assinatura de qualquer um dos segredos configurados", () => {
    expect(verifyMetaSignature(body, sign(body, "app1"), ["app1", "app2"])).toBe(true);
    expect(verifyMetaSignature(body, sign(body, "app2"), ["app1", "app2"])).toBe(true);
  });
  it("rejeita segredo desconhecido e falha fechada sem nenhum segredo", () => {
    expect(verifyMetaSignature(body, sign(body, "outro"), ["app1", "app2"])).toBe(false);
    expect(verifyMetaSignature(body, sign(body, ""), [undefined, ""])).toBe(false);
    expect(verifyMetaSignature(body, sign(body, "app1"), [])).toBe(false);
  });
});

describe("extractInboundMessages", () => {
  it("anexa o phone_number_id do número que recebeu", () => {
    const out = extractInboundMessages({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "999" },
                messages: [{ id: "w1", from: "5543999999999", type: "text", text: { body: "oi" } }],
              },
            },
          ],
        },
      ],
    });
    expect(out[0].phoneNumberId).toBe("999");
  });

  const wrap = (value: unknown) => ({ entry: [{ changes: [{ value }] }] });

  it("extrai texto, áudio e botão; ignora statuses", () => {
    const out = extractInboundMessages(
      wrap({
        statuses: [{ id: "x", status: "delivered" }],
        messages: [
          { id: "w1", from: "5543999999999", type: "text", text: { body: "oi" } },
          { id: "w2", from: "5543999999999", type: "audio", audio: { id: "m1" } },
          {
            id: "w3",
            from: "5543999999999",
            type: "interactive",
            interactive: { button_reply: { id: "b1", title: "Sim" } },
          },
          { id: "w4", from: "5543999999999", type: "reaction", reaction: { emoji: "👍" } },
          { id: "w5", from: "5543999999999", type: "reaction", reaction: {} },
          { id: "w6", from: "5543999999999", type: "location" },
        ],
      }),
    );
    expect(out.map((m) => [m.wamid, m.mediaType, m.content])).toEqual([
      ["w1", "text", "oi"],
      ["w2", "audio", "[áudio]"],
      ["w3", "interactive", "Sim"],
      ["w4", "sticker", "[Cliente reagiu com 👍]"],
    ]);
    expect(out[1].mediaId).toBe("m1");
  });

  it("figurinha: texto neutro (sem presumir sentimento) e mediaId para a IA ler a imagem", () => {
    const [m] = extractInboundMessages(
      wrap({ messages: [{ id: "s1", from: "5543999999999", type: "sticker", sticker: { id: "st1" } }] }),
    );
    expect(m).toMatchObject({ mediaType: "sticker", content: "[Cliente enviou uma figurinha]", mediaId: "st1" });
    expect(m.content).not.toMatch(/positiva/);
  });

  it("só statuses => vazio; lixo => vazio", () => {
    expect(extractInboundMessages(wrap({ statuses: [{}] }))).toEqual([]);
    expect(extractInboundMessages(null)).toEqual([]);
  });
});
