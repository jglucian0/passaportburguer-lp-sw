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

describe("extractInboundMessages", () => {
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
      ["w4", "sticker", "[Cliente enviou uma figurinha/reação positiva]"],
    ]);
    expect(out[1].mediaId).toBe("m1");
  });

  it("só statuses => vazio; lixo => vazio", () => {
    expect(extractInboundMessages(wrap({ statuses: [{}] }))).toEqual([]);
    expect(extractInboundMessages(null)).toEqual([]);
  });
});
