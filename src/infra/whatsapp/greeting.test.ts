import { describe, expect, it } from "vitest";

import { greetingForHour, resolveGreetingMode } from "./greeting";

// America/Sao_Paulo = UTC-3 (sem horário de verão desde 2019).
const sp = (iso: string) => new Date(`${iso}-03:00`);

describe("resolveGreetingMode (fuso America/Sao_Paulo)", () => {
  const now = sp("2026-11-18T15:00:00");

  it("FIRST_TODAY: nunca houve mensagem", () => {
    expect(resolveGreetingMode(null, sp("2026-11-18T14:00:00"), now)).toBe("FIRST_TODAY");
  });

  it("FIRST_TODAY: a última mensagem foi em outro dia (mesmo a poucas horas, virando a meia-noite)", () => {
    // 23:30 de ontem em SP = 02:30Z de hoje: no UTC seria "hoje", em SP não.
    const last = sp("2026-11-17T23:30:00");
    const early = sp("2026-11-18T01:00:00");
    expect(resolveGreetingMode(last, sp("2026-11-17T23:00:00"), early)).toBe("FIRST_TODAY");
  });

  it("FIRST_TODAY: a última mensagem foi há mais de 6 horas, mesmo hoje", () => {
    const last = sp("2026-11-18T08:00:00");
    expect(resolveGreetingMode(last, sp("2026-11-18T07:55:00"), now)).toBe("FIRST_TODAY");
  });

  it("IN_CONVERSATION: já há mensagens na sessão atual", () => {
    const start = sp("2026-11-18T14:30:00");
    expect(resolveGreetingMode(sp("2026-11-18T14:45:00"), start, now)).toBe("IN_CONVERSATION");
  });

  it("IN_CONVERSATION: mensagem exatamente no início da sessão conta como sessão atual", () => {
    const start = sp("2026-11-18T14:30:00");
    expect(resolveGreetingMode(start, start, now)).toBe("IN_CONVERSATION");
  });

  it("RETURNING_TODAY: conversou hoje, a sessão foi encerrada e o cliente reabre (0 mensagens na sessão)", () => {
    const last = sp("2026-11-18T13:00:00");
    const newSession = sp("2026-11-18T13:05:00"); // reset depois do 'Valeu'
    expect(resolveGreetingMode(last, newSession, now)).toBe("RETURNING_TODAY");
  });

  it("o limite de 6 horas é exato", () => {
    const start = sp("2026-11-18T08:59:00");
    const exactly6h = sp("2026-11-18T09:00:00");
    expect(resolveGreetingMode(exactly6h, start, now)).toBe("IN_CONVERSATION");
    expect(resolveGreetingMode(new Date(exactly6h.getTime() - 1), new Date(0), now)).toBe("FIRST_TODAY");
  });
});

describe("greetingForHour (horário de Brasília)", () => {
  it.each([
    ["2026-11-18T05:00:00", "Bom dia"],
    ["2026-11-18T11:59:00", "Bom dia"],
    ["2026-11-18T12:00:00", "Boa tarde"],
    ["2026-11-18T17:59:00", "Boa tarde"],
    ["2026-11-18T18:00:00", "Boa noite"],
    ["2026-11-18T01:00:00", "Boa noite"],
  ])("%s => %s", (iso, expected) => {
    expect(greetingForHour(sp(iso))).toBe(expected);
  });

  it("usa Brasília, não o fuso da máquina: 22:00Z = 19:00 em SP", () => {
    expect(greetingForHour(new Date("2026-11-18T22:00:00Z"))).toBe("Boa noite");
    expect(greetingForHour(new Date("2026-11-18T14:00:00Z"))).toBe("Bom dia"); // 11:00 em SP
  });
});
