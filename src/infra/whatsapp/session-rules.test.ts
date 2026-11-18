import { describe, expect, it } from "vitest";

import {
  HISTORY_LIMIT,
  isCheckoutReady,
  isClosingMessage,
  nextStep,
  selectSessionMessages,
} from "./session-rules";

const at = (iso: string) => new Date(iso);

describe("selectSessionMessages (isolamento por sessionStartedAt)", () => {
  const rows = [
    { role: "user", content: "quero um nova york", createdAt: at("2026-01-01T19:00:00Z") },
    { role: "assistant", content: "Anotado! Entrega ou retirada?", createdAt: at("2026-01-01T19:01:00Z") },
    { role: "assistant", content: "Pedido #101 confirmado", createdAt: at("2026-01-01T19:10:00Z") },
    { role: "user", content: "quero uma batata", createdAt: at("2026-01-01T21:00:00Z") },
  ];

  it("depois de um pedido concluído, só entram mensagens a partir do novo sessionStartedAt", () => {
    const out = selectSessionMessages(rows, at("2026-01-01T19:10:30Z"));
    expect(out.map((r) => r.content)).toEqual(["quero uma batata"]);
  });

  it("inclui a mensagem exatamente no instante de início", () => {
    expect(selectSessionMessages(rows, at("2026-01-01T21:00:00Z"))).toHaveLength(1);
  });

  it("limita às últimas 12 mensagens, mantendo a ordem", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      role: "user",
      content: `m${i}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 12, i)),
    }));
    const out = selectSessionMessages(many, new Date(0));
    expect(HISTORY_LIMIT).toBe(12);
    expect(out).toHaveLength(12);
    expect(out[0].content).toBe("m18");
    expect(out.at(-1)?.content).toBe("m29");
  });

  it("sem sessionStartedAt (sessão nova) não filtra nada", () => {
    expect(selectSessionMessages(rows, null)).toHaveLength(4);
  });
});

describe("máquina de estado: isCheckoutReady / nextStep", () => {
  const cart = [{ productId: "p1", quantity: 1 }];
  it("só fecha com carrinho + endereço confirmado + pagamento", () => {
    expect(isCheckoutReady({ draftCart: cart, addressConfirmed: true, paymentMethod: "PIX" })).toBe(true);
    expect(isCheckoutReady({ draftCart: [], addressConfirmed: true, paymentMethod: "PIX" })).toBe(false);
    expect(isCheckoutReady({ draftCart: null, addressConfirmed: true, paymentMethod: "PIX" })).toBe(false);
    expect(isCheckoutReady({ draftCart: cart, addressConfirmed: false, paymentMethod: "PIX" })).toBe(false);
    expect(isCheckoutReady({ draftCart: cart, addressConfirmed: true, paymentMethod: null })).toBe(false);
  });

  it("nextStep aponta o que falta, na ordem carrinho → entrega → pagamento → checkout", () => {
    expect(nextStep({ draftCart: [], addressConfirmed: false, paymentMethod: null })).toBe("CART");
    expect(nextStep({ draftCart: cart, addressConfirmed: false, paymentMethod: null })).toBe("DELIVERY");
    expect(nextStep({ draftCart: cart, addressConfirmed: true, paymentMethod: null })).toBe("PAYMENT");
    expect(nextStep({ draftCart: cart, addressConfirmed: true, paymentMethod: "CASH" })).toBe("CHECKOUT");
  });
});

describe("isClosingMessage (cliente encerrou o papo)", () => {
  it.each(["Já chegou", "já chegou!", "Valeu", "valeu!!", "Obrigado", "vlw 👍", "Chegou, valeu"])(
    "encerra: %s",
    (t) => expect(isClosingMessage(t)).toBe(true),
  );
  it.each(["valeu, mas quero mais uma batata", "quero um burger", "já chegou meu pedido? veio errado"])(
    "não encerra: %s",
    (t) => expect(isClosingMessage(t)).toBe(false),
  );
});
