import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  ctx: null as unknown as ReturnType<typeof import("./fake-db").createFakeDb>,
}));
vi.mock("@/infra/db", async () => {
  const { createFakeDb } = await import("./fake-db");
  f.ctx = createFakeDb();
  return { db: f.ctx.db };
});
const agent = vi.hoisted(() => ({ run: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./agent", () => ({ runBotTurn: agent.run }));
vi.mock("./client", () => ({ markMessageAsRead: vi.fn() }));

import { whatsappInboxBuffer, whatsappMessages, whatsappSessions } from "@/infra/db/schema";

import { processAfterDebounce } from "./inbox";

const PHONE = "5543999999999";
const msg = { wamid: "w1", phone: PHONE, mediaType: "text", content: "oi", raw: {} };

beforeEach(() => {
  agent.run.mockClear();
  f.ctx.rows.clear();
  f.ctx.writes.length = 0;
  f.ctx.rows.set(whatsappInboxBuffer, [{ wamid: "w1", payload: msg, receivedAt: new Date() }]);
});

describe("processAfterDebounce — transbordo humano", () => {
  it("bot pausado: salva a mensagem no histórico e NÃO aciona a IA", async () => {
    f.ctx.rows.set(whatsappSessions, [{ botPausedUntil: new Date(Date.now() + 600_000) }]);
    await processAfterDebounce(PHONE, "w1", 0);
    expect(f.ctx.writes.some((w) => w.table === whatsappMessages && w.op === "insert")).toBe(true);
    expect(agent.run).not.toHaveBeenCalled();
  });

  it("pausa vencida ou ausente: aciona a IA com o lote", async () => {
    f.ctx.rows.set(whatsappSessions, [{ botPausedUntil: new Date(Date.now() - 1000) }]);
    await processAfterDebounce(PHONE, "w1", 0);
    expect(agent.run).toHaveBeenCalledTimes(1);
    expect(agent.run.mock.calls[0][0]).toBe(PHONE);
  });

  it("chegou mensagem mais nova de outra execução: esta encerra sem processar", async () => {
    f.ctx.rows.set(whatsappSessions, [{ botPausedUntil: null }]);
    await processAfterDebounce(PHONE, "w0", 0); // a mais recente pendente é w1, não w0
    expect(agent.run).not.toHaveBeenCalled();
    expect(f.ctx.writes).toHaveLength(0);
  });
});
