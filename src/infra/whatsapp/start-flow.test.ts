import { describe, expect, it } from "vitest";

import { endOfTodaySaoPaulo } from "./greeting";
import { buildStartFlow, isRepeatRequest, shouldUseStartFlow } from "./start-flow";

describe("buildStartFlow", () => {
  it("cliente novo: boas-vindas + como funciona (curtas) + botão, sem atalho", () => {
    const f = buildStartFlow("Boa tarde", "FIRST_TODAY", { isRegistered: false });
    expect(f.preface).toHaveLength(2);
    expect(f.preface[0]).toBe("Boa tarde! Bem-vindo a bordo do Passaporte Burguer! ✈️");
    expect(f.preface.every((t) => t.length <= 130)).toBe(true);
    expect(f.repeatSummary).toBeNull();
  });

  it("cadastrado: chama pelo nome e oferece repetir o último pedido", () => {
    const f = buildStartFlow("Bom dia", "FIRST_TODAY", { isRegistered: true, firstName: "João", lastOrderSummary: "1x México + 1x Batata" });
    expect(f.preface).toEqual(["Bom dia, João! Bem-vindo de volta a bordo ✈️"]);
    expect(f.repeatSummary).toBe("1x México + 1x Batata");
  });

  it("cadastrado sem pedido anterior: sem atalho; retorno do dia não repete a saudação", () => {
    const f = buildStartFlow("Boa noite", "RETURNING_TODAY", { isRegistered: true, firstName: "Ana", lastOrderSummary: null });
    expect(f.preface).toEqual(["Oi de novo, Ana! ✈️"]);
    expect(f.repeatSummary).toBeNull();
  });
});

describe("regras do início", () => {
  it("atalho: só o clique em 'Repetir pedido'", () => {
    expect(isRepeatRequest(["Repetir pedido"])).toBe(true);
    expect(isRepeatRequest(["quero repetir o pedido de ontem"])).toBe(false);
  });
  it("pergunta vai para a IA; saudação e tentativa de pedido usam o roteiro", () => {
    expect(shouldUseStartFlow(["Oi"])).toBe(true);
    expect(shouldUseStartFlow(["Quero um mexico"])).toBe(true);
    expect(shouldUseStartFlow(["Vocês abrem hoje?"])).toBe(false);
  });
});

describe("endOfTodaySaoPaulo", () => {
  it("é a próxima meia-noite de Brasília (03:00 UTC)", () => {
    expect(endOfTodaySaoPaulo(new Date("2026-11-19T16:30:00Z")).toISOString()).toBe("2026-11-20T03:00:00.000Z");
    // 01:00 em Brasília ainda é o mesmo "hoje" local (19/11 UTC-3 = 20/11 04:00Z?) -> 21/11 03:00Z? conferir virada:
    expect(endOfTodaySaoPaulo(new Date("2026-11-20T02:00:00Z")).toISOString()).toBe("2026-11-20T03:00:00.000Z");
    expect(endOfTodaySaoPaulo(new Date("2026-11-20T03:30:00Z")).toISOString()).toBe("2026-11-21T03:00:00.000Z");
  });
});
