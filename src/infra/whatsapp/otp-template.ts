/**
 * Envio do código de login pelo template de AUTENTICAÇÃO da Meta (botão "copiar código").
 * Funções puras: montagem do payload e tradução dos erros da Graph API para o cliente.
 */

export type AuthTemplateInput = {
  /** Telefone só com dígitos e DDI 55 (ex.: 5544999998888). */
  to: string;
  name: string;
  languageCode: string;
  /** Código de 6 dígitos. */
  code: string;
};

type TextParam = { type: "text"; text: string };

export type AuthTemplatePayload = {
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components: [
      { type: "body"; parameters: [TextParam] },
      { type: "button"; sub_type: "url"; index: "0"; parameters: [TextParam] },
    ];
  };
};

const BR_PHONE = /^55\d{10,11}$/;
const OTP_CODE = /^\d{6}$/;

/** O código vai no corpo E no botão: exigência do template AUTHENTICATION com COPY_CODE. */
export function buildAuthTemplatePayload({ to, name, languageCode, code }: AuthTemplateInput): AuthTemplatePayload {
  if (!BR_PHONE.test(to)) throw new Error("Telefone do OTP deve ter só dígitos com DDI 55.");
  if (!OTP_CODE.test(code)) throw new Error("O código do OTP deve ter 6 dígitos.");
  const param: TextParam = { type: "text", text: code };
  return {
    to,
    type: "template",
    template: {
      name,
      language: { code: languageCode },
      components: [
        { type: "body", parameters: [param] },
        { type: "button", sub_type: "url", index: "0", parameters: [param] },
      ],
    },
  };
}

export type OtpSendFailure = { status: number; message: string };

const NOT_ON_WHATSAPP = 131026;
const RATE_LIMITED = new Set([130429, 80007, 131056]);

function metaCode(error: unknown): number | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : null;
}

/**
 * Erro da Graph API → resposta ao cliente. Problemas de configuração (template, token, número de teste)
 * ficam só no log do servidor: o cliente recebe uma mensagem genérica.
 */
export function describeOtpSendError(error: unknown): OtpSendFailure {
  const code = metaCode(error);
  if (code === NOT_ON_WHATSAPP) {
    return { status: 422, message: "Não conseguimos enviar para este número. Confira se ele tem WhatsApp." };
  }
  if (code !== null && RATE_LIMITED.has(code)) {
    return { status: 429, message: "Muitas solicitações no momento. Tente novamente em alguns minutos." };
  }
  return { status: 503, message: "Não foi possível enviar o código agora. Tente novamente em instantes." };
}
