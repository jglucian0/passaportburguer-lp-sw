import { describe, expect, it } from "vitest";

import { errorSummary } from "./log";

describe("errorSummary (LGPD)", () => {
  it("descarta a linha params do drizzle (telefone/texto do cliente)", () => {
    const err = new Error(
      "Failed query: insert into whatsapp_messages (phone, content) values ($1, $2)\nparams: 5543999999999,quero um burger, meu CPF 529.982.247-25",
    );
    const out = errorSummary(err);
    expect(out).toContain("Failed query");
    expect(out).not.toContain("5543999999999");
    expect(out).not.toContain("529.982");
    expect(out).not.toContain("params");
  });

  it("inclui o código SQL quando existe (também no cause)", () => {
    const err = Object.assign(new Error("boom"), { cause: { code: "23505" } });
    expect(errorSummary(err)).toContain("[23505]");
  });

  it("valor que não é Error não vaza o conteúdo", () => {
    expect(errorSummary({ phone: "5543999999999" })).toBe("erro desconhecido");
  });
});
