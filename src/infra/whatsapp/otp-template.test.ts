import { describe, expect, it } from "vitest";

import { WhatsAppApiError } from "./client";
import { buildAuthTemplatePayload, describeOtpSendError } from "./otp-template";

const base = { to: "5544999998888", name: "passaporte_otp", languageCode: "pt_BR", code: "123456" };

describe("payload do template de autenticação (COPY_CODE)", () => {
  const payload = buildAuthTemplatePayload(base);

  it("é do tipo template e vai para o número com DDI", () => {
    expect(payload.type).toBe("template");
    expect(payload.to).toBe("5544999998888");
    expect(payload.template.name).toBe("passaporte_otp");
    expect(payload.template.language).toEqual({ code: "pt_BR" });
  });

  it("envia o código no body E no botão (url, index 0)", () => {
    expect(payload.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "123456" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "123456" }] },
    ]);
  });

  it("recusa código que não seja de 6 dígitos", () => {
    expect(() => buildAuthTemplatePayload({ ...base, code: "12345" })).toThrow();
    expect(() => buildAuthTemplatePayload({ ...base, code: "12345a" })).toThrow();
  });

  it("recusa telefone sem DDI 55 ou com símbolos", () => {
    expect(() => buildAuthTemplatePayload({ ...base, to: "44999998888" })).toThrow();
    expect(() => buildAuthTemplatePayload({ ...base, to: "+5544999998888" })).toThrow();
  });
});

describe("erros da Graph API ao enviar o OTP", () => {
  const err = (code: number | null, status = 400) => new WhatsAppApiError(status, "POST /x/messages", "", code);

  it("número sem WhatsApp vira mensagem clara (422)", () => {
    expect(describeOtpSendError(err(131026))).toMatchObject({ status: 422 });
  });

  it("template inexistente/pausado, número de teste e token inválido são erros de configuração (503, sem vazar detalhe)", () => {
    for (const code of [132001, 132015, 132016, 131030, 190]) {
      const r = describeOtpSendError(err(code));
      expect(r.status).toBe(503);
      expect(r.message).not.toMatch(/template|token|131030/i);
    }
  });

  it("limite de taxa da Meta vira 429", () => {
    expect(describeOtpSendError(err(130429, 429)).status).toBe(429);
    expect(describeOtpSendError(err(80007, 429)).status).toBe(429);
  });

  it("qualquer outro erro vira 503 genérico", () => {
    expect(describeOtpSendError(err(null, 500)).status).toBe(503);
    expect(describeOtpSendError(new Error("boom")).status).toBe(503);
  });
});
