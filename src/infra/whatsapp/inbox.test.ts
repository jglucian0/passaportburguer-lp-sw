import { beforeEach, describe, expect, it, vi } from "vitest";

const returning = vi.fn();
vi.mock("@/infra/db", () => ({
  db: {
    insert: () => ({
      values: () => ({ onConflictDoNothing: () => ({ returning }) }),
    }),
  },
}));
const markRead = vi.fn().mockResolvedValue({});
vi.mock("./client", () => ({ markMessageAsRead: (...a: unknown[]) => markRead(...a) }));

import { bufferInbound } from "./inbox";

const msg = (wamid: string) => ({
  wamid,
  phone: "5543999999999",
  mediaType: "text" as const,
  content: "oi",
  raw: {},
});

describe("bufferInbound (deduplicação por wamid)", () => {
  beforeEach(() => {
    returning.mockReset();
    markRead.mockClear();
  });

  it("mensagem nova entra e é marcada como lida", async () => {
    returning.mockResolvedValueOnce([{ id: "1" }]);
    const fresh = await bufferInbound([msg("w1")]);
    expect(fresh).toHaveLength(1);
    expect(markRead).toHaveBeenCalledWith("w1");
  });

  it("wamid repetido (conflito) é descartado sem reprocessar", async () => {
    returning.mockResolvedValueOnce([]);
    const fresh = await bufferInbound([msg("w1")]);
    expect(fresh).toHaveLength(0);
    expect(markRead).not.toHaveBeenCalled();
  });

  it("falha ao marcar como lida não derruba", async () => {
    returning.mockResolvedValueOnce([{ id: "1" }]);
    markRead.mockRejectedValueOnce(new Error("boom"));
    await expect(bufferInbound([msg("w1")])).resolves.toHaveLength(1);
  });
});
