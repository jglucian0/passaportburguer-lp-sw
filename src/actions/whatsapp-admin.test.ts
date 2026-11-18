import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  ctx: null as unknown as ReturnType<typeof import("@/infra/whatsapp/fake-db").createFakeDb>,
  session: null as null | { name: string; role: string; tenantId: string; userId: string },
}));
vi.mock("@/infra/db", async () => {
  const { createFakeDb } = await import("@/infra/whatsapp/fake-db");
  f.ctx = createFakeDb();
  return { db: f.ctx.db };
});
vi.mock("@/infra/auth/active-session", () => ({ getActiveAdminSession: async () => f.session }));
vi.mock("@/infra/whatsapp/client", () => ({ sendTextMessage: vi.fn(), sendCtaUrlButton: vi.fn(), downloadMedia: vi.fn() }));

import { whatsappMessages, whatsappSessions } from "@/infra/db/schema";

import { listWhatsAppChats, resumeWhatsAppBot, takeOverWhatsAppChat } from "./whatsapp-admin";

const PHONE = "5543999999999";

beforeEach(() => {
  f.ctx.rows.clear();
  f.ctx.writes.length = 0;
  f.session = { name: "Ana", role: "KITCHEN", tenantId: "t1", userId: "u1" };
  f.ctx.rows.set(whatsappSessions, [{ phone: PHONE }]);
});

describe("Atendimentos WhatsApp (admin)", () => {
  it("sem sessão de admin, nenhuma ação funciona e nada é gravado", async () => {
    f.session = null;
    expect((await listWhatsAppChats()).ok).toBe(false);
    expect((await takeOverWhatsAppChat({ phone: PHONE })).ok).toBe(false);
    expect((await resumeWhatsAppBot({ phone: PHONE })).ok).toBe(false);
    expect(f.ctx.writes).toHaveLength(0);
  });

  it("assumir: botPausedUntil = agora + 30 min e trilha com o nome do atendente", async () => {
    const before = Date.now();
    const res = await takeOverWhatsAppChat({ phone: PHONE });
    expect(res.ok).toBe(true);

    const update = f.ctx.writes.find((w) => w.op === "update" && w.table === whatsappSessions);
    const until = (update?.set as { botPausedUntil: Date }).botPausedUntil.getTime();
    expect(until - before).toBeGreaterThanOrEqual(30 * 60_000 - 50);
    expect(until - before).toBeLessThan(30 * 60_000 + 5_000);

    const audit = f.ctx.writes.find((w) => w.table === whatsappMessages);
    expect((audit?.values as { role: string; content: string }).role).toBe("system");
    expect((audit?.values as { content: string }).content).toContain("Ana");
  });

  it("reativar: botPausedUntil = null", async () => {
    const res = await resumeWhatsAppBot({ phone: PHONE });
    expect(res.ok).toBe(true);
    const update = f.ctx.writes.find((w) => w.op === "update" && w.table === whatsappSessions);
    expect(update?.set).toMatchObject({ botPausedUntil: null });
  });

  it("recusa telefone inválido e conversa inexistente", async () => {
    expect((await takeOverWhatsAppChat({ phone: "abc" })).ok).toBe(false);
    expect((await takeOverWhatsAppChat({})).ok).toBe(false);
    f.ctx.rows.set(whatsappSessions, []);
    const res = await takeOverWhatsAppChat({ phone: PHONE });
    expect(res.ok).toBe(false);
    expect(f.ctx.writes.find((w) => w.table === whatsappMessages)).toBeUndefined();
  });

  it("lista só pausa vigente: pausa vencida aparece como não pausada", async () => {
    f.ctx.rows.set(whatsappSessions, [
      { phone: PHONE, customerName: "Maria", state: "AWAITING_PAYMENT", lastInteractionAt: new Date(), botPausedUntil: new Date(Date.now() - 1000) },
      { phone: "5511988887777", customerName: null, state: "GREETING", lastInteractionAt: new Date(), botPausedUntil: new Date(Date.now() + 600_000) },
    ]);
    const res = await listWhatsAppChats();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data[0]).toMatchObject({ customerName: "Maria", state: "AWAITING_PAYMENT", botPausedUntil: null });
    expect(res.data[1].botPausedUntil).not.toBeNull();
  });
});
