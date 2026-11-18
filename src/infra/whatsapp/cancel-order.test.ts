import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ ctx: null as unknown as ReturnType<typeof import("./fake-db").createFakeDb> }));
vi.mock("@/infra/db", async () => {
  const { createFakeDb } = await import("./fake-db");
  f.ctx = createFakeDb();
  return { db: f.ctx.db };
});
const asaas = vi.hoisted(() => ({ cancel: vi.fn() }));
vi.mock("@/infra/payments/asaas", () => ({ cancelPendingCharges: asaas.cancel }));
const timeline = vi.hoisted(() => ({ record: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/infra/db/timeline", () => ({ recordTimelineEvent: timeline.record }));
const wa = vi.hoisted(() => ({ text: vi.fn().mockResolvedValue({}) }));
vi.mock("./client", () => ({ sendTextMessage: wa.text }));

import { customers, orders, tenants, whatsappMessages, whatsappSessions } from "@/infra/db/schema";

import { cancelUnpaidOrderTool } from "./cancel-order";
import { executeTool, TOOL_DECLARATIONS } from "./tools";

const PHONE = "5543999999999";
const sessionWrites = () => f.ctx.writes.filter((w) => w.table === whatsappSessions);
const orderUpdates = () => f.ctx.writes.filter((w) => w.table === orders && w.op === "update");
const pausedUntil = (w: { set?: unknown; values?: unknown }) =>
  ((w.set ?? w.values) as { botPausedUntil?: Date | null }).botPausedUntil;

function arrange(status: string, orderNumber = 123) {
  f.ctx.rows.set(tenants, [{ id: "t1" }]);
  f.ctx.rows.set(customers, [{ id: "cu1", phone: "43999999999" }]);
  f.ctx.rows.set(orders, [{ id: "o1", orderNumber, status, paymentMethod: "PIX" }]);
}

beforeEach(() => {
  f.ctx.rows.clear();
  f.ctx.writes.length = 0;
  asaas.cancel.mockReset().mockResolvedValue({ blocked: null, handled: new Set() });
  timeline.record.mockClear();
  wa.text.mockClear();
});

describe("cancelUnpaidOrderTool: pedido AWAITING_PAYMENT", () => {
  it("cancela o pedido, cancela a cobrança no Asaas e zera a sessão, SEM pausar o bot", async () => {
    arrange("AWAITING_PAYMENT");
    const before = Date.now();
    const out = await cancelUnpaidOrderTool({ phone: PHONE, reason: "mudei de ideia" });

    expect(out).toMatchObject({ ok: true, canceled: true, orderNumber: 123 });
    expect(asaas.cancel).toHaveBeenCalledWith("o1");
    expect(orderUpdates()[0].set).toMatchObject({ status: "CANCELED", cancelReason: expect.stringContaining("mudei de ideia") });

    const reset = sessionWrites().find((w) => "draftCart" in ((w.set ?? {}) as object));
    expect(reset?.set).toMatchObject({ draftCart: [], addressConfirmed: false, paymentMethod: null, state: "IDLE" });
    expect((reset?.set as { sessionStartedAt: Date }).sessionStartedAt.getTime()).toBeGreaterThanOrEqual(before);

    // O bot continua ativo: nenhuma escrita define botPausedUntil, nem marca HANDOFF, nem avisa a loja.
    expect(sessionWrites().every((w) => pausedUntil(w) === undefined || pausedUntil(w) === null)).toBe(true);
    expect(f.ctx.writes.some((w) => w.table === whatsappMessages)).toBe(false);
    expect(wa.text).not.toHaveBeenCalled();
    expect(timeline.record).toHaveBeenCalled();
  });

  it("a cobrança já foi paga no Asaas: NÃO cancela o pedido e passa para um humano", async () => {
    arrange("AWAITING_PAYMENT");
    asaas.cancel.mockResolvedValue({ blocked: "PAID", handled: new Set() });
    const out = await cancelUnpaidOrderTool({ phone: PHONE, reason: "cancelar" });
    expect(out).toMatchObject({ ok: false, handoff: true });
    expect(orderUpdates()).toHaveLength(0);
    expect(sessionWrites().some((w) => pausedUntil(w) instanceof Date)).toBe(true);
  });

  it("cobrança que não pôde ser verificada: não cancela e não pausa o bot", async () => {
    arrange("AWAITING_PAYMENT");
    asaas.cancel.mockResolvedValue({ blocked: "UNVERIFIED", handled: new Set() });
    const out = await cancelUnpaidOrderTool({ phone: PHONE, reason: "cancelar" });
    expect(out).toMatchObject({ ok: false });
    expect(orderUpdates()).toHaveLength(0);
    expect(sessionWrites().some((w) => pausedUntil(w) instanceof Date)).toBe(false);
  });
});

describe("cancelUnpaidOrderTool: pedido já pago / em andamento => atendente humano", () => {
  it.each(["RECEIVED", "PREPARING", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP"])(
    "%s: aciona requestHumanHandoff (pausa o bot) e não cancela sozinho",
    async (status) => {
      arrange(status);
      const out = await cancelUnpaidOrderTool({ phone: PHONE, reason: "quero cancelar" });
      expect(out).toMatchObject({ ok: false, handoff: true });
      expect(orderUpdates()).toHaveLength(0);
      expect(asaas.cancel).not.toHaveBeenCalled();
      expect(sessionWrites().some((w) => pausedUntil(w) instanceof Date)).toBe(true);
      expect(f.ctx.writes.some((w) => w.table === whatsappMessages)).toBe(true); // marcador HANDOFF
    },
  );
});

describe("cancelUnpaidOrderTool: sem o que cancelar", () => {
  it("cliente sem pedido: nada é escrito", async () => {
    f.ctx.rows.set(tenants, [{ id: "t1" }]);
    f.ctx.rows.set(customers, [{ id: "cu1", phone: "43999999999" }]);
    f.ctx.rows.set(orders, []);
    expect(await cancelUnpaidOrderTool({ phone: PHONE, reason: "x" })).toMatchObject({ ok: false });
    expect(f.ctx.writes).toHaveLength(0);
  });

  it("telefone sem cadastro: nada é escrito", async () => {
    f.ctx.rows.set(tenants, [{ id: "t1" }]);
    expect(await cancelUnpaidOrderTool({ phone: PHONE, reason: "x" })).toMatchObject({ ok: false });
    expect(f.ctx.writes).toHaveLength(0);
  });

  it.each(["DELIVERED", "CANCELED"])("último pedido %s: não há o que cancelar (sem handoff)", async (status) => {
    arrange(status);
    expect(await cancelUnpaidOrderTool({ phone: PHONE, reason: "x" })).toMatchObject({ ok: false });
    expect(f.ctx.writes).toHaveLength(0);
  });
});

describe("tool cancelUnpaidOrder exposta ao modelo", () => {
  it("o telefone NUNCA é parâmetro do modelo; só o motivo", () => {
    const decl = TOOL_DECLARATIONS.find((t) => t.name === "cancelUnpaidOrder");
    expect(decl).toBeDefined();
    expect(Object.keys(decl!.parameters!.properties as object)).toEqual(["reason"]);
  });

  it("executeTool usa o telefone da conversa", async () => {
    arrange("AWAITING_PAYMENT");
    const out = await executeTool({ phone: PHONE, afterReply: [], cta: null }, "cancelUnpaidOrder", { reason: "desisti", phone: "5511000000000" });
    expect(out).toMatchObject({ ok: true, canceled: true });
  });
});
