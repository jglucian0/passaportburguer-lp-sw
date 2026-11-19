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

import { whatsappInboxBuffer, whatsappSessions } from "@/infra/db/schema";

import { DEBOUNCE_MS, TURN_LOCK_MS, processAfterDebounce } from "./inbox";

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
const sessionWrites = () => f.ctx.writes.filter((w) => w.table === whatsappSessions);
const lockWrite = (w: { set?: unknown; values?: unknown }) =>
  ((w.set ?? w.values) as { processingLockUntil?: Date | null }).processingLockUntil;

beforeEach(() => {
  agent.run.mockReset().mockResolvedValue(true);
  f.ctx.rows.clear();
  f.ctx.writes.length = 0;
  f.ctx.rows.set(whatsappInboxBuffer, [row()]);
});

describe("debounce", () => {
  it("espera 3,5 s de silêncio do cliente (e não mais 5 s)", () => {
    expect(DEBOUNCE_MS).toBe(3500);
  });
});

describe("lock atômico por telefone (processingLockUntil)", () => {
  it("lock ocupado por outro turno: encerra na hora, sem reservar o buffer nem chamar a IA", async () => {
    f.ctx.rows.set(whatsappSessions, []); // o UPDATE condicional não devolveu linha => lock não adquirido
    await processAfterDebounce(PHONE, "w1", 0);
    expect(agent.run).not.toHaveBeenCalled();
    expect(f.ctx.writes.some((w) => w.table === whatsappInboxBuffer)).toBe(false);
    // Quem não obteve o lock NÃO pode liberá-lo (é do outro turno).
    expect(sessionWrites().filter((w) => lockWrite(w) === null)).toHaveLength(0);
  });

  it("dois disparos simultâneos: só um executa o turno", async () => {
    // Banco falso com semântica de lock: o 1º upsert adquire; enquanto não liberar, o 2º não.
    let held = false;
    f.ctx.rows.set(whatsappSessions, () => {
      if (held) return [];
      held = true;
      return [{ botPausedUntil: null }];
    });
    let release!: () => void;
    agent.run.mockImplementation(() => new Promise<boolean>((r) => (release = () => r(true))));

    const first = processAfterDebounce(PHONE, "w1", 0);
    await new Promise((r) => setTimeout(r, 10));
    await processAfterDebounce(PHONE, "w1", 0); // concorrente: sai sem processar
    expect(agent.run).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(agent.run).toHaveBeenCalledTimes(1);
  });

  it("adquire por 30 s e libera (null) ao final do turno", async () => {
    f.ctx.rows.set(whatsappSessions, [{ botPausedUntil: null }]);
    expect(TURN_LOCK_MS).toBe(30_000);
    await processAfterDebounce(PHONE, "w1", 0);
    const writes = sessionWrites();
    const acquire = writes.find((w) => lockWrite(w) instanceof Date)!;
    const until = lockWrite(acquire) as Date;
    expect(until.getTime() - Date.now()).toBeGreaterThan(28_000);
    expect(until.getTime() - Date.now()).toBeLessThanOrEqual(30_000);
    expect(lockWrite(writes.at(-1)!)).toBeNull();
  });

  it("libera o lock mesmo quando o turno lança exceção (finally)", async () => {
    f.ctx.rows.set(whatsappSessions, [{ botPausedUntil: null }]);
    agent.run.mockRejectedValue(new Error("boom"));
    await processAfterDebounce(PHONE, "w1", 0);
    expect(lockWrite(sessionWrites().at(-1)!)).toBeNull();
  });

  it("mensagem que chegou durante o turno é atendida em seguida (sem ficar encalhada)", async () => {
    f.ctx.rows.set(whatsappSessions, [{ botPausedUntil: null }]);
    let started = false;
    f.ctx.rows.set(whatsappInboxBuffer, () =>
      // Depois do 1º turno aparece w2, que não estava no lote.
      started ? [row({ id: "r2", wamid: "w2" }), row()] : [row()],
    );
    agent.run.mockImplementation(async () => {
      started = true;
      return true;
    });
    await processAfterDebounce(PHONE, "w1", 0);
    expect(agent.run).toHaveBeenCalledTimes(2);
  });

  it("fila sequencial: o turno seguinte roda AINDA com o lock; o lock só é liberado depois do último turno", async () => {
    f.ctx.rows.set(whatsappSessions, [{ botPausedUntil: null }]);
    let started = false;
    f.ctx.rows.set(whatsappInboxBuffer, () => (started ? [row({ id: "r2", wamid: "w2" }), row()] : [row()]));
    const events: string[] = [];
    agent.run.mockImplementation(async () => {
      started = true;
      events.push(`turn${agent.run.mock.calls.length}`);
      return true;
    });
    // Registra a liberação do lock na ordem em que acontece.
    const originalUpdate = f.ctx.db.update;
    f.ctx.db.update = ((t: unknown) => {
      const chain = originalUpdate(t) as { set: (v: unknown) => unknown };
      const set = chain.set.bind(chain);
      chain.set = (v: unknown) => {
        if (t === whatsappSessions && (v as { processingLockUntil?: unknown }).processingLockUntil === null) events.push("release");
        return set(v);
      };
      return chain;
    }) as typeof f.ctx.db.update;

    await processAfterDebounce(PHONE, "w1", 0);
    expect(events).toEqual(["turn1", "turn2", "release"]);
  });
});
