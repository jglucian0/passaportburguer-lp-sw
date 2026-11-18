import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fake, type Query } from "@/test/fake-db";

vi.mock("@/infra/db", async () => (await import("@/test/fake-db")).makeDbModule());
vi.mock("@/infra/db/store-settings", () => ({
  loadStoreSettings: async () => ({ autoAcceptOrders: state.autoAccept }),
}));
vi.mock("@/lib/saipos", () => ({ sendOrderToSaipos: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));

const state = vi.hoisted(() => ({ autoAccept: false }));

import { after } from "next/server";

import { tokenMatches } from "@/infra/payments/webhook-auth";

import { POST } from "./route";

const TOKEN = "tok-secret-123";
const ORDER_ID = "7b0f6e0a-6a56-4d52-9a39-0c7a2b6a1f11";

const baseEvent = {
  id: "evt_1",
  event: "PAYMENT_RECEIVED",
  payment: { id: "pay_1", externalReference: ORDER_ID, value: 45.9, status: "RECEIVED" },
};

function req(body: unknown, token: string | null = TOKEN) {
  return new Request("http://localhost/api/webhooks/asaas", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: token === null ? {} : { "asaas-access-token": token },
  }) as never;
}

let seenEvents: Set<string>;
let order: { id: string; tenantId: string; status: string; totalCents: number };
let orderRowsUpdated: number;

beforeEach(() => {
  fake.reset();
  state.autoAccept = false;
  seenEvents = new Set();
  orderRowsUpdated = 1;
  order = { id: ORDER_ID, tenantId: "t1", status: "AWAITING_PAYMENT", totalCents: 4590 };
  fake.handler = (q: Query) => {
    if (q.kind === "insert" && q.table === "payment_events") {
      const id = q.values!.eventId as string;
      if (seenEvents.has(id)) return [];
      seenEvents.add(id);
      return [{ eventId: id }];
    }
    if (q.kind === "select" && q.table === "payments") {
      return [{ payment: { id: "p-local", status: "PENDING" }, order }];
    }
    if (q.kind === "update" && q.table === "orders") {
      return Array.from({ length: orderRowsUpdated }, () => ({ id: ORDER_ID }));
    }
    return [];
  };
  vi.stubEnv("ASAAS_WEBHOOK_TOKEN", TOKEN);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const orderUpdates = () => fake.batches.flat().filter((q) => q.kind === "update" && q.table === "orders");

describe("autenticação do webhook Asaas", () => {
  it("401 sem o header asaas-access-token", async () => {
    expect((await POST(req(baseEvent, null))).status).toBe(401);
    expect(fake.queries).toHaveLength(0);
  });

  it("401 com token divergente", async () => {
    expect((await POST(req(baseEvent, "outro-token"))).status).toBe(401);
    expect((await POST(req(baseEvent, TOKEN + "x"))).status).toBe(401);
    expect(fake.queries).toHaveLength(0);
  });

  it("401 quando ASAAS_WEBHOOK_TOKEN não está definido (mesmo com header)", async () => {
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", "");
    expect((await POST(req(baseEvent, ""))).status).toBe(401);
    expect((await POST(req(baseEvent, "qualquer"))).status).toBe(401);
  });

  it("tokenMatches compara em tempo constante e rejeita tamanhos diferentes sem lançar", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abc", "abcd")).toBe(false);
    expect(tokenMatches(null, "abc")).toBe(false);
  });
});

describe("validação do payload", () => {
  it("400 para JSON inválido", async () => {
    expect((await POST(req("{nao-json"))).status).toBe(400);
  });

  it("400 quando faltam campos obrigatórios", async () => {
    expect((await POST(req({ ...baseEvent, payment: { id: "pay_1" } }))).status).toBe(400);
    expect((await POST(req({ event: "PAYMENT_RECEIVED", payment: baseEvent.payment }))).status).toBe(400);
    expect(fake.queries).toHaveLength(0);
  });
});

describe("idempotência", () => {
  it("evento repetido responde 200 {duplicate:true} sem reprocessar", async () => {
    const first = await POST(req(baseEvent));
    expect(await first.json()).toMatchObject({ ok: true, updated: 1 });
    const batchesAfterFirst = fake.batches.length;

    const second = await POST(req(baseEvent));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, duplicate: true });
    expect(fake.batches).toHaveLength(batchesAfterFirst);
  });

  it("falha no processamento libera o evento para a retentativa do Asaas", async () => {
    const original = fake.handler;
    fake.handler = (q) => {
      if (q.kind === "select") throw new Error("db fora do ar");
      return original(q);
    };
    const res = await POST(req(baseEvent));
    expect(res.status).toBe(500);
    expect(fake.queries.some((q) => q.kind === "delete" && q.table === "payment_events")).toBe(true);
  });
});

describe("integridade financeira", () => {
  it("valor divergente NÃO aprova o pedido e gera alerta de auditoria", async () => {
    const res = await POST(req({ ...baseEvent, payment: { ...baseEvent.payment, value: 10 } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ flagged: "amount_mismatch" });
    expect(orderUpdates()).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith("[asaas-webhook]", expect.stringContaining("AMOUNT_MISMATCH"));
  });

  it("arredonda reais para centavos sem erro de ponto flutuante (19.99 -> 1999)", async () => {
    order.totalCents = 1999;
    const res = await POST(req({ ...baseEvent, payment: { ...baseEvent.payment, value: 19.99 } }));
    expect(await res.json()).toMatchObject({ updated: 1 });
  });

  it("evento PAYMENT_RECEIVED com status inconsistente é ignorado", async () => {
    const res = await POST(req({ ...baseEvent, payment: { ...baseEvent.payment, status: "PENDING" } }));
    expect(await res.json()).toMatchObject({ ignored: "status_mismatch" });
    expect(orderUpdates()).toHaveLength(0);
  });
});

describe("transições", () => {
  it("PAYMENT_RECEIVED libera o pedido (AWAITING_PAYMENT -> RECEIVED) em um lote atômico", async () => {
    const res = await POST(req(baseEvent));
    expect(await res.json()).toMatchObject({ ok: true, updated: 1 });
    expect(fake.batches).toHaveLength(1);
    const [payment, ord] = fake.batches[0];
    expect(payment.set).toMatchObject({ status: "RECEIVED" });
    expect(ord.set).toMatchObject({ status: "RECEIVED" });
  });

  it("PAYMENT_CONFIRMED com aceite automático vai direto para PREPARING", async () => {
    state.autoAccept = true;
    await POST(
      req({ ...baseEvent, id: "evt_2", event: "PAYMENT_CONFIRMED", payment: { ...baseEvent.payment, status: "CONFIRMED" } }),
    );
    const [payment, ord] = fake.batches[0];
    expect(payment.set).toMatchObject({ status: "CONFIRMED" });
    expect(ord.set).toMatchObject({ status: "PREPARING" });
  });

  it("pagamento após cancelamento não ressuscita o pedido e sinaliza estorno", async () => {
    order.status = "CANCELED";
    orderRowsUpdated = 0;
    const res = await POST(req(baseEvent));
    expect(await res.json()).toMatchObject({ flagged: "paid_after_cancel" });
    expect(console.warn).toHaveBeenCalledWith(
      "[asaas-webhook]",
      expect.stringContaining("PAID_AFTER_CANCEL_REFUND_NEEDED"),
    );
  });

  it("PAYMENT_OVERDUE cancela o pedido que aguarda pagamento", async () => {
    await POST(
      req({ ...baseEvent, id: "evt_3", event: "PAYMENT_OVERDUE", payment: { ...baseEvent.payment, status: "OVERDUE" } }),
    );
    const [payment, ord] = fake.batches[0];
    expect(payment.set).toMatchObject({ status: "OVERDUE" });
    expect(ord.set).toMatchObject({ status: "CANCELED" });
  });

  it("PAYMENT_REFUNDED marca o pagamento e cancela o pedido", async () => {
    await POST(
      req({ ...baseEvent, id: "evt_4", event: "PAYMENT_REFUNDED", payment: { ...baseEvent.payment, status: "REFUNDED" } }),
    );
    const [payment, ord] = fake.batches[0];
    expect(payment.set).toMatchObject({ status: "REFUNDED" });
    expect(ord.set).toMatchObject({ status: "CANCELED", cancelReason: "Pagamento estornado." });
  });

  it("pagamento desconhecido (sem externalReference de pedido nosso) é ignorado com 200", async () => {
    const original = fake.handler;
    fake.handler = (q) => (q.kind === "select" && q.table === "payments" ? [] : original(q));
    const res = await POST(req({ ...baseEvent, payment: { ...baseEvent.payment, externalReference: null } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: "unknown_payment" });
  });
});

describe("LGPD nos logs", () => {
  it("loga apenas eventId/eventType/orderId/status", async () => {
    await POST(
      req({
        ...baseEvent,
        payment: { ...baseEvent.payment, customer: "cus_1", name: "Fulano da Silva", cpfCnpj: "12345678909" },
      }),
    );
    const logged = [...(console.info as ReturnType<typeof vi.fn>).mock.calls, ...(console.warn as ReturnType<typeof vi.fn>).mock.calls]
      .flat()
      .join(" ");
    expect(logged).toContain("evt_1");
    expect(logged).not.toContain("Fulano");
    expect(logged).not.toContain("12345678909");
    expect(logged).not.toContain("cus_1");
  });
});


/* ------------------------------------------------------------------ */
/* Cenários de homologação (cartão)                                     */
/* ------------------------------------------------------------------ */

const ev = (id: string, event: string, status: string) => ({
  ...baseEvent,
  id,
  event,
  payment: { ...baseEvent.payment, status },
});

describe("cartão: aprovação imediata + webhook posterior", () => {
  it("pedido já liberado na resposta síncrona: webhook só atualiza o financeiro, sem reenviar à cozinha", async () => {
    order.status = "RECEIVED"; // já liberado pelo createCreditCardCharge
    orderRowsUpdated = 0;
    const res = await POST(req(ev("evt_c1", "PAYMENT_CONFIRMED", "CONFIRMED")));
    expect(await res.json()).toMatchObject({ ok: true, updated: 0 });
    expect(fake.batches[0][0].set).toMatchObject({ status: "CONFIRMED" });
    expect(vi.mocked(after)).not.toHaveBeenCalled();
  });

  it("webhook duplicado depois da aprovação não reprocessa", async () => {
    const first = await POST(req(ev("evt_c2", "PAYMENT_CONFIRMED", "CONFIRMED")));
    expect(await first.json()).toMatchObject({ updated: 1 });
    expect(vi.mocked(after)).toHaveBeenCalledTimes(1);
    const second = await POST(req(ev("evt_c2", "PAYMENT_CONFIRMED", "CONFIRMED")));
    expect(await second.json()).toEqual({ ok: true, duplicate: true });
    expect(fake.batches).toHaveLength(1);
    expect(vi.mocked(after)).toHaveBeenCalledTimes(1);
  });
});

describe("cartão: recusa via webhook", () => {
  it.each(["PAYMENT_CREDIT_CARD_CAPTURE_REFUSED", "PAYMENT_REPROVED_BY_RISK_ANALYSIS"])(
    "%s => payment FAILED e pedido segue AWAITING_PAYMENT (nova tentativa)",
    async (event) => {
      const res = await POST(req(ev("evt_f_" + event, event, "PENDING")));
      expect(await res.json()).toMatchObject({ ok: true, updated: 1 });
      expect(fake.batches[0][0].set).toMatchObject({ status: "FAILED" });
      expect(orderUpdates()).toHaveLength(0);
    },
  );
});

describe("cartão: análise de risco", () => {
  it("AWAITING_RISK_ANALYSIS => RISK_ANALYSIS sem cancelar nem liberar; depois APPROVED libera", async () => {
    const wait = await POST(req(ev("evt_r1", "PAYMENT_AWAITING_RISK_ANALYSIS", "PENDING")));
    expect(await wait.json()).toMatchObject({ ok: true, updated: 1 });
    expect(fake.batches[0][0].set).toMatchObject({ status: "RISK_ANALYSIS" });
    expect(orderUpdates()).toHaveLength(0);

    const approved = await POST(req(ev("evt_r2", "PAYMENT_APPROVED_BY_RISK_ANALYSIS", "PENDING")));
    expect(await approved.json()).toMatchObject({ ok: true, updated: 1 });
    const [payment, ord] = fake.batches[1];
    expect(payment.set).toMatchObject({ status: "CONFIRMED" });
    expect(ord.set).toMatchObject({ status: "RECEIVED" });
    expect(vi.mocked(after)).toHaveBeenCalledTimes(1);
  });

  it("aprovação na análise de risco com valor divergente NÃO libera", async () => {
    const bad = ev("evt_r3", "PAYMENT_APPROVED_BY_RISK_ANALYSIS", "PENDING");
    bad.payment = { ...bad.payment, value: 1 };
    expect(await (await POST(req(bad))).json()).toMatchObject({ flagged: "amount_mismatch" });
    expect(orderUpdates()).toHaveLength(0);
  });
});

describe("chargeback", () => {
  it.each(["PAYMENT_CHARGEBACK_REQUESTED", "PAYMENT_CHARGEBACK_DISPUTE"])(
    "%s => alerta de alta prioridade, sem alterar pedido/pagamento",
    async (event) => {
      const res = await POST(req(ev("evt_cb_" + event, event, "CONFIRMED")));
      expect(await res.json()).toMatchObject({ flagged: "chargeback" });
      expect(console.warn).toHaveBeenCalledWith(
        "[asaas-webhook]",
        expect.stringContaining("CHARGEBACK_HIGH_PRIORITY_OWNER_ACTION_REQUIRED"),
      );
      expect(orderUpdates()).toHaveLength(0);
    },
  );
});
