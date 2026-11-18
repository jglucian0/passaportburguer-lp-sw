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

describe("stripRepeatedGreeting", () => {
  it('shouldGreet=false bloqueia "Boa noite, Joao!"', () => {
    expect(stripRepeatedGreeting("Boa noite, Joao! Quer mais alguma coisa?", false)).toBe("Quer mais alguma coisa?");
  });

  it('shouldGreet=false bloqueia "Bora pra mais um!"', () => {
    expect(stripRepeatedGreeting("Bora pra mais um! Qual vai ser?", false)).toBe("Qual vai ser?");
    expect(stripRepeatedGreeting("Bora pra mais um!", false)).toBe("");
  });

  it("remove os demais bordões e saudações (Oi, Olá, Opa, Fala, Bom dia, Bora lá, Bora embarcar nessa)", () => {
    for (const g of ["Oi!", "Olá, Maria!", "Opa!", "Fala, João!", "Bom dia!", "Boa tarde!", "Bora lá!", "Bora embarcar nessa!"]) {
      expect(stripRepeatedGreeting(`${g} Pode mandar o endereço?`, false)).toBe("Pode mandar o endereço?");
    }
  });

  it("remove saudações empilhadas", () => {
    expect(stripRepeatedGreeting("Oi, João! Bora lá! Qual lanche?", false)).toBe("Qual lanche?");
  });

  it("não come conteúdo que só começa parecido", () => {
    expect(stripRepeatedGreeting("Opa, Nova York não está disponível hoje.", false)).toBe(
      "Nova York não está disponível hoje.",
    );
    expect(stripRepeatedGreeting("Oitenta pratos saem por dia.", false)).toBe("Oitenta pratos saem por dia.");
    expect(stripRepeatedGreeting("Fale com a gente se precisar.", false)).toBe("Fale com a gente se precisar.");
  });

  it("shouldGreet=true deixa o texto intacto", () => {
    expect(stripRepeatedGreeting("Boa noite, Joao!", true)).toBe("Boa noite, Joao!");
    expect(stripRepeatedGreeting("Bora pra mais um!", true)).toBe("Bora pra mais um!");
  });

  it("só mexe no INÍCIO do texto", () => {
    expect(stripRepeatedGreeting("Fechado! Oi de novo é com a gente.", false)).toBe("Fechado! Oi de novo é com a gente.");
  });
});
