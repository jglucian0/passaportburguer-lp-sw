import { describe, expect, it } from "vitest";

import { stripRepeatedGreeting, stripUrlsAndMarkdownLinks } from "./sanitizer";

describe("stripUrlsAndMarkdownLinks", () => {
  it("remove link Markdown [Cardápio](https://...) e mantém só o rótulo", () => {
    expect(stripUrlsAndMarkdownLinks("Escolhe no [Cardápio](https://app.menu-rapido.com/abc) aí")).toBe(
      "Escolhe no Cardápio aí",
    );
  });

  it("link Markdown cujo rótulo também é URL some por inteiro", () => {
    expect(stripUrlsAndMarkdownLinks("Veja [https://x.com/a](https://x.com/a) agora")).toBe("Veja agora");
  });

  it("remove URL crua https, http e www", () => {
    expect(stripUrlsAndMarkdownLinks("Acesse https://passaporteburguer.com.br/cardapio já")).toBe("Acesse já");
    expect(stripUrlsAndMarkdownLinks("Acesse http://x.io/a")).toBe("Acesse");
    expect(stripUrlsAndMarkdownLinks("Acesse www.passaporteburguer.com.br/menu")).toBe("Acesse");
  });

  it("remove domínio alucinado (app.menu-rapido...) e domínio sem esquema", () => {
    expect(stripUrlsAndMarkdownLinks("Pede em app.menu-rapido.passaporte/xyz")).toBe("Pede em");
    expect(stripUrlsAndMarkdownLinks("Pede em passaporteburguer.com.br/pedido")).toBe("Pede em");
  });

  it("não mexe em texto normal, preços e números", () => {
    const txt = "Total R$ 35,00. Nova York 1x. Vai chegar em 40 min.";
    expect(stripUrlsAndMarkdownLinks(txt)).toBe(txt);
  });

  it("limpa a pontuação que sobrou de um link removido na linha", () => {
    expect(stripUrlsAndMarkdownLinks("Cardápio aqui: https://x.com/a")).toBe("Cardápio aqui");
  });

  it("preserva quebras de linha entre as frases", () => {
    expect(stripUrlsAndMarkdownLinks("Oi\n\nLink: https://x.com\nTchau")).toBe("Oi\n\nLink\nTchau");
  });
});

describe("stripRepeatedGreeting (só atua em IN_CONVERSATION)", () => {
  it.each(["Bom dia", "Boa tarde", "Boa noite"])("IN_CONVERSATION remove %s repetido no começo, com ou sem nome", (g) => {
    expect(stripRepeatedGreeting(`${g}! Qual o endereço?`, "IN_CONVERSATION")).toBe("Qual o endereço?");
    expect(stripRepeatedGreeting(`${g}, Joao! Quer mais alguma coisa?`, "IN_CONVERSATION")).toBe("Quer mais alguma coisa?");
  });

  it("remove saudações de horário empilhadas e capitaliza o resto", () => {
    expect(stripRepeatedGreeting("Boa noite! Boa noite, João! qual o endereço?", "IN_CONVERSATION")).toBe("Qual o endereço?");
  });

  it.each(["Show!", "Fechado!", "Perfeito!", "Beleza!", "Opa, anotado!", "Oi, tudo certo!", "Bora lá!"])(
    "IN_CONVERSATION preserva a expressão natural de continuidade: %s",
    (e) => {
      expect(stripRepeatedGreeting(`${e} Qual o endereço?`, "IN_CONVERSATION")).toBe(`${e} Qual o endereço?`);
    },
  );

  it("IN_CONVERSATION: nunca zera a resposta se ela era só a saudação (devolve vazio para o chamador decidir)", () => {
    expect(stripRepeatedGreeting("Boa noite!", "IN_CONVERSATION")).toBe("");
  });

  it("não come palavras parecidas nem trechos no meio do texto", () => {
    expect(stripRepeatedGreeting("Bom diário de pedidos hoje.", "IN_CONVERSATION")).toBe("Bom diário de pedidos hoje.");
    expect(stripRepeatedGreeting("Fechado! Boa noite pra você também.", "IN_CONVERSATION")).toBe("Fechado! Boa noite pra você também.");
  });

  it.each(["FIRST_TODAY", "RETURNING_TODAY"] as const)("%s: nunca altera o texto", (mode) => {
    for (const t of ["Boa noite, Joao! Tudo bem?", "Bom dia! Já sabe o que vai pedir?", "Bora pra mais um!"]) {
      expect(stripRepeatedGreeting(t, mode)).toBe(t);
    }
  });
});
