import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ ctx: null as unknown as ReturnType<typeof import("./fake-db").createFakeDb> }));
vi.mock("@/infra/db", async () => {
  const { createFakeDb } = await import("./fake-db");
  f.ctx = createFakeDb();
  return { db: f.ctx.db };
});

import { whatsappSessions } from "@/infra/db/schema";

import { echoPauseMinutes, extractEchoRecipients, pauseBotForOwnerReply } from "./echo";

type Payload = { entry: Array<{ changes: Array<{ field: string; value: { message_echoes: Array<Record<string, unknown>> } }> }> };

const echoPayload = (to: string, field = "smb_message_echoes"): Payload => ({
  entry: [
    {
      changes: [
        {
          field,
          value: {
            message_echoes: [{ from: "5544996098333", to, id: "wamid.X", type: "text", text: { body: "Oi, já te atendo" } }],
          },
        },
      ],
    },
  ],
});

beforeEach(() => {
  f.ctx.writes.length = 0;
  delete process.env.WHATSAPP_ECHO_PAUSE_MINUTES;
});

describe("webhook smb_message_echoes (coexistência)", () => {
  it("extrai o telefone do CLIENTE (campo `to`) das respostas feitas pelo celular", () => {
    expect(extractEchoRecipients(echoPayload("5544999998888"))).toEqual(["5544999998888"]);
  });

  it("ignora outros campos e payloads sem eco; não duplica", () => {
    expect(extractEchoRecipients(echoPayload("5544999998888", "messages"))).toEqual([]);
    expect(extractEchoRecipients({})).toEqual([]);
    const dup = echoPayload("5544999998888");
    dup.entry[0].changes[0].value.message_echoes.push({ from: "x", to: "5544999998888", id: "w2", type: "text" });
    expect(extractEchoRecipients(dup)).toEqual(["5544999998888"]);
  });

  it("pausa padrão de 60 min, configurável (1 a 1440)", () => {
    expect(echoPauseMinutes()).toBe(60);
    process.env.WHATSAPP_ECHO_PAUSE_MINUTES = "15";
    expect(echoPauseMinutes()).toBe(15);
    process.env.WHATSAPP_ECHO_PAUSE_MINUTES = "0";
    expect(echoPauseMinutes()).toBe(60);
    process.env.WHATSAPP_ECHO_PAUSE_MINUTES = "99999";
    expect(echoPauseMinutes()).toBe(60);
  });

  it("pausa o bot daquele chat por X minutos e registra no histórico", async () => {
    const before = Date.now();
    await pauseBotForOwnerReply("5544999998888", 60);
    const write = f.ctx.writes.find((w) => w.table === whatsappSessions && w.op === "insert");
    const until = (write?.values as { botPausedUntil: Date }).botPausedUntil.getTime();
    expect(until).toBeGreaterThanOrEqual(before + 60 * 60_000 - 1000);
    expect(until).toBeLessThanOrEqual(Date.now() + 60 * 60_000 + 1000);
    expect(f.ctx.writes.some((w) => w.op === "insert" && JSON.stringify(w.values).includes("celular"))).toBe(true);
  });
});
