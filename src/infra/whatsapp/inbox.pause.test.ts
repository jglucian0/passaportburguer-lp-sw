import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  ctx: null as unknown as ReturnType<typeof import("./fake-db").createFakeDb>,
}));
vi.mock("@/infra/db", async () => {
  const { createFakeDb } = await import("./fake-db");
  f.ctx = createFakeDb();
  return { db: f.ctx.db };
});
const agent = vi.hoisted(() => ({ run: vi.fn().mockResolvedValue(true) }));
vi.mock("./agent", () => ({ runBotTurn: agent.run }));
vi.mock("./client", () => ({ markMessageAsRead: vi.fn() }));

import { whatsappInboxBuffer, whatsappMessages, whatsappSessions } from "@/infra/db/schema";

import { processAfterDebounce } from "./inbox";

const PHONE = "5543999999999";
const msg = { wamid: "w1", phone: PHONE, mediaType: "text", content: "oi", raw: {} };
const row = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  wamid: "w1",
  payload: msg,
  receivedAt: new Date(),
  attempts: 1,
  ...over,
});
const bufferUpdates = () => f.ctx.writes.filter((w) => w.op === "update" && w.table === whatsappInboxBuffer);

beforeEach(() => {
  agent.run.mockReset().mockResolvedValue(true);
  f.ctx.rows.clear();
  f.ctx.writes.length = 0;
  f.ctx.rows.set(whatsappInboxBuffer, [row()]);
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

describe("processAfterDebounce — garantia de não-perda", () => {
  beforeEach(() => f.ctx.rows.set(whatsappSessions, [{ botPausedUntil: null }]));

  it("reserva o lote (attempts + lock) ao começar, sem marcar processed", async () => {
    await processAfterDebounce(PHONE, "w1", 0);
    const claim = bufferUpdates()[0].set as Record<string, unknown>;
    expect(claim).toHaveProperty("attempts");
    expect(claim.lockedUntil).toBeInstanceOf(Date);
    expect(claim).not.toHaveProperty("processed");
  });

  it("só marca processed=true depois que o turno concluiu (resposta enviada)", async () => {
    let processedBeforeTurn = false;
    agent.run.mockImplementation(async () => {
      processedBeforeTurn = bufferUpdates().some((w) => (w.set as { processed?: boolean }).processed === true);
      return true;
    });
    await processAfterDebounce(PHONE, "w1", 0);
    expect(processedBeforeTurn).toBe(false);
    const last = bufferUpdates().at(-1)?.set;
    expect(last).toMatchObject({ processed: true, lockedUntil: null });
  });

  it("turno falhou (false): o item NÃO é marcado processed; só libera o lock para nova tentativa", async () => {
    agent.run.mockResolvedValue(false);
    await processAfterDebounce(PHONE, "w1", 0);
    expect(bufferUpdates().some((w) => (w.set as { processed?: boolean }).processed === true)).toBe(false);
    expect(bufferUpdates().at(-1)?.set).toEqual({ lockedUntil: null });
  });

  it("turno que lança exceção também volta à fila", async () => {
    agent.run.mockRejectedValue(new Error("boom"));
    await processAfterDebounce(PHONE, "w1", 0);
    expect(bufferUpdates().some((w) => (w.set as { processed?: boolean }).processed === true)).toBe(false);
    expect(bufferUpdates().at(-1)?.set).toEqual({ lockedUntil: null });
  });

  it("attempts >= 3 e falhou de novo: desiste (processed=true) para não entrar em loop", async () => {
    f.ctx.rows.set(whatsappInboxBuffer, [row({ attempts: 3 })]);
    agent.run.mockResolvedValue(false);
    await processAfterDebounce(PHONE, "w1", 0);
    expect(bufferUpdates().at(-1)?.set).toMatchObject({ processed: true, lockedUntil: null });
  });

  it("lote misto: só os itens que esgotaram as tentativas são dados como processados", async () => {
    f.ctx.rows.set(whatsappInboxBuffer, [
      row({ id: "velho", wamid: "w0", attempts: 3, receivedAt: new Date(Date.now() - 5000) }),
      row({ id: "novo", attempts: 1 }),
    ]);
    agent.run.mockResolvedValue(false);
    await processAfterDebounce(PHONE, "w0", 0); // o banco falso devolve a 1ª linha como a mais recente
    const sets = bufferUpdates().slice(1).map((w) => w.set);
    expect(sets).toContainEqual(expect.objectContaining({ processed: true }));
    expect(sets).toContainEqual({ lockedUntil: null });
  });
});
