import { describe, expect, it } from "vitest";

import { cpfInput, registerBody, whatsappCheckBody } from "./auth";

describe("cadastro sem senha (nome + CPF)", () => {
  it("aceita CPF com máscara e devolve só dígitos", () => {
    expect(cpfInput.parse("529.982.247-25")).toBe("52998224725");
  });

  it("recusa CPF inválido, repetido e CNPJ", () => {
    expect(cpfInput.safeParse("111.111.111-11").success).toBe(false);
    expect(cpfInput.safeParse("529.982.247-24").success).toBe(false);
    expect(cpfInput.safeParse("11.222.333/0001-81").success).toBe(false);
  });

  it("registerBody só aceita nome e CPF (senha/e-mail são recusados)", () => {
    expect(registerBody.safeParse({ name: "Maria Silva", document: "529.982.247-25" }).success).toBe(true);
    expect(registerBody.safeParse({ name: "Maria Silva", document: "529.982.247-25", password: "x" }).success).toBe(false);
    expect(registerBody.safeParse({ name: "M", document: "529.982.247-25" }).success).toBe(false);
  });

  it("código de validação: 6 dígitos (digitado) ou PASS-XXXX (legado)", () => {
    const parse = (code: string) => whatsappCheckBody.safeParse({ phone: "44999998888", code }).success;
    expect(parse("123456")).toBe(true);
    expect(parse("pass-ab12")).toBe(true);
    expect(parse("12345")).toBe(false);
    expect(parse("12345a")).toBe(false);
  });
});
