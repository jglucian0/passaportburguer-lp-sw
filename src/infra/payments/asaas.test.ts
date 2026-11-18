import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { after } from "next/server";

import { fake, type Query } from "@/test/fake-db";

vi.mock("@/infra/db", async () => (await import("@/test/fake-db")).makeDbModule());
vi.mock("@/infra/db/store-settings", () => ({ loadStoreSettings: async () => ({ autoAcceptOrders: false }) }));
vi.mock("@/lib/saipos", () => ({ sendOrderToSaipos: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));

import {
  AsaasError,
  PaymentConflictError,
  centsToReais,
  createCreditCardCharge,
  createPixCharge,
  getOrCreateAsaasCustomer,
  parseAsaasDateTime,
  todayInSaoPaulo,
} from "./asaas";

const customer = { id: "c-1", name: "Maria", phone: "44999998888", email: "m@x.com", asaasCustomerId: null };
const order = { id: "7b0f6e0a-6a56-4d52-9a39-0c7a2b6a1f11", totalCents: 4590 };
const cardOrder = { ...order, tenantId: "t1" };

type Call = { method: string; url: string; body: Record<string, unknown> | undefined; headers: Record<string, string> };
let calls: Call[];
let respond: (c: Call) => { status?: number; json: unknown };

beforeEach(() => {
  fake.reset();
  vi.mocked(after).mockClear();
  calls = [];
  vi.stubEnv("ASAAS_API_URL", "https://api-sandbox.asaas.com/v3/");
  vi.stubEnv("ASAAS_API_KEY", "test-key");
  respond = (c) => {
    if (c.url.endsWith("/customers") && c.method === "POST") return { json: { id: "cus_new" } };
    if (c.url.includes("/customers?")) return { json: { data: [] } };
    if (c.url.endsWith("/pixQrCode")) {
      return { json: { encodedImage: "QkFTRTY0", payload: "00020126...", expirationDate: "2026-11-18 23:59:59" } };
    }
    if (c.url.endsWith("/payments") && c.method === "POST") {
      return { json: { id: "pay_1", status: "PENDING", invoiceUrl: "https://sandbox.asaas.com/i/pay_1" } };
    }
    return { json: {} };
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const call: Call = {
        method: init.method ?? "GET",
        url,
        body: init.body ? JSON.parse(init.body as string) : undefined,
        headers: init.headers as Record<string, string>,
      };
      calls.push(call);
      const r = respond(call);
      const status = r.status ?? 200;
      return { ok: status < 400, status, json: async () => r.json } as Response;
    }),
  );
  // Sem cobrança reaproveitável/pendente no banco por padrão.
  fake.handler = () => [];
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("helpers", () => {
  it("centsToReais evita erro de ponto flutuante", () => {
    expect(centsToReais(4590)).toBe(45.9);
    expect(centsToReais(1999)).toBe(19.99);
    expect(centsToReais(1)).toBe(0.01);
  });

  it("todayInSaoPaulo usa o fuso America/Sao_Paulo (00:30 UTC ainda é o dia anterior)", () => {
    expect(todayInSaoPaulo(new Date("2026-11-18T00:30:00Z"))).toBe("2026-11-17");
    expect(todayInSaoPaulo(new Date("2026-11-18T12:00:00Z"))).toBe("2026-11-18");
  });

  it("parseAsaasDateTime interpreta horário de Brasília", () => {
    expect(parseAsaasDateTime("2026-11-18 23:59:59")?.toISOString()).toBe("2026-11-19T02:59:59.000Z");
    expect(parseAsaasDateTime(undefined)).toBeNull();
  });
});

describe("getOrCreateAsaasCustomer", () => {
  it("reaproveita o cus_xxx salvo sem chamar o Asaas", async () => {
    expect(await getOrCreateAsaasCustomer({ ...customer, asaasCustomerId: "cus_old" })).toBe("cus_old");
    expect(calls).toHaveLength(0);
  });

  it("busca por CPF e reaproveita cliente existente (e persiste)", async () => {
    respond = () => ({ json: { data: [{ id: "cus_found" }] } });
    const id = await getOrCreateAsaasCustomer({ ...customer, cpfCnpj: "529.982.247-25" });
    expect(id).toBe("cus_found");
    expect(calls[0].url).toContain("/customers?cpfCnpj=52998224725");
    expect(fake.queries.find((q) => q.kind === "update" && q.table === "customers")?.set).toEqual({
      asaasCustomerId: "cus_found",
    });
  });

  it("cria o cliente com externalReference interno, sem notificações, e persiste", async () => {
    const id = await getOrCreateAsaasCustomer({ ...customer, cpfCnpj: "52998224725" });
    expect(id).toBe("cus_new");
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({
      name: "Maria",
      cpfCnpj: "52998224725",
      mobilePhone: "44999998888",
      externalReference: "c-1",
      notificationDisabled: true,
    });
    expect(post.headers.access_token).toBe("test-key");
    expect(post.url).toBe("https://api-sandbox.asaas.com/v3/customers");
  });
});

describe("createPixCharge", () => {
  it("cobra order.totalCents/100, com externalReference do pedido, e busca o QR Code dinâmico", async () => {
    const result = await createPixCharge({ order, customer: { ...customer, cpfCnpj: "52998224725" } });

    const charge = calls.find((c) => c.url.endsWith("/payments") && c.method === "POST")!;
    expect(charge.body).toMatchObject({
      customer: "cus_new",
      billingType: "PIX",
      value: 45.9,
      externalReference: order.id,
    });
    expect(charge.body!.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(calls.some((c) => c.url.endsWith("/payments/pay_1/pixQrCode"))).toBe(true);

    expect(result).toMatchObject({ paymentId: "pay_1", pixPayload: "00020126...", pixQrCodeBase64: "QkFTRTY0" });
    const insert = fake.queries.find((q) => q.kind === "insert" && q.table === "payments")!;
    expect(insert.values).toMatchObject({
      orderId: order.id,
      providerPaymentId: "pay_1",
      providerCustomerId: "cus_new",
      method: "PIX",
      amountCents: 4590,
      status: "PENDING",
    });
  });

  it("é idempotente: reaproveita QR Code ainda válido sem nova cobrança", async () => {
    fake.handler = (q: Query) =>
      q.kind === "select" && q.table === "payments"
        ? [
            {
              providerPaymentId: "pay_old",
              status: "PENDING",
              pixPayload: "PAYLOAD",
              pixQrCodeBase64: "IMG",
              pixExpirationDate: new Date(Date.now() + 3_600_000),
              invoiceUrl: null,
            },
          ]
        : [];
    const result = await createPixCharge({ order, customer });
    expect(result.paymentId).toBe("pay_old");
    expect(calls).toHaveLength(0);
  });
});

describe("createCreditCardCharge", () => {
  const cardData = {
    holderName: "MARIA S SILVA",
    number: "4111111111111111",
    expiryMonth: "12",
    expiryYear: "2030",
    ccv: "123",
    holderCpfCnpj: "52998224725",
    postalCode: "87020025",
    addressNumber: "100",
    email: "m@x.com",
  };

  it("checkout transparente: envia cartão, titular e remoteIp reais; valor vem do pedido", async () => {
    respond = (c) =>
      c.url.endsWith("/payments") && c.method === "POST"
        ? { json: { id: "pay_card", status: "CONFIRMED" } }
        : { json: { id: "cus_x" } };
    const result = await createCreditCardCharge({ order: cardOrder, customer, cardData, remoteIp: "203.0.113.9" });

    const charge = calls.find((c) => c.url.endsWith("/payments") && c.method === "POST")!;
    expect(charge.body).toMatchObject({
      billingType: "CREDIT_CARD",
      value: 45.9,
      externalReference: order.id,
      remoteIp: "203.0.113.9",
      creditCard: { number: "4111111111111111", ccv: "123", expiryMonth: "12", expiryYear: "2030" },
      creditCardHolderInfo: { cpfCnpj: "52998224725", postalCode: "87020025", addressNumber: "100", phone: "44999998888" },
    });
    expect(result).toMatchObject({ paymentId: "pay_card", status: "CONFIRMED", hosted: false });
  });

  it("NUNCA persiste PAN/CVV/validade: o registro local só tem ids e status", async () => {
    await createCreditCardCharge({ order: cardOrder, customer, cardData, remoteIp: "203.0.113.9" });
    const insert = fake.queries.find((q) => q.kind === "insert" && q.table === "payments")!;
    const stored = JSON.stringify(insert.values);
    expect(stored).not.toContain("4111111111111111");
    expect(stored).not.toContain('"123"');
    expect(stored).not.toContain("2030");
    expect(Object.keys(insert.values!)).not.toEqual(expect.arrayContaining(["number", "ccv", "creditCard"]));
  });

  it("sem cardData gera a fatura hospedada (invoiceUrl) e não envia dados de cartão", async () => {
    const result = await createCreditCardCharge({ order: cardOrder, customer: { ...customer, cpfCnpj: "52998224725" } });
    const charge = calls.find((c) => c.url.endsWith("/payments") && c.method === "POST")!;
    expect(charge.body).not.toHaveProperty("creditCard");
    expect(result).toMatchObject({ hosted: true, invoiceUrl: "https://sandbox.asaas.com/i/pay_1" });
  });

  it("recusa cartão sem IP identificável (exigência antifraude)", async () => {
    await expect(createCreditCardCharge({ order: cardOrder, customer, cardData, remoteIp: "unknown" })).rejects.toBeInstanceOf(
      AsaasError,
    );
    expect(calls).toHaveLength(0);
  });

  it("em erro do Asaas não loga nem expõe o payload (cartão) na exceção", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")].map(
      (s) => s.mockImplementation(() => undefined),
    );
    respond = (c) =>
      c.url.endsWith("/payments") && c.method === "POST"
        ? { status: 400, json: { errors: [{ code: "invalid_creditCard", description: "Transação não autorizada." }] } }
        : { json: { id: "cus_x" } };

    const error = await createCreditCardCharge({ order: cardOrder, customer, cardData, remoteIp: "203.0.113.9" }).catch((e) => e);
    expect(error).toBeInstanceOf(AsaasError);
    expect(error.userMessage).toBe("Transação não autorizada.");
    const everything = JSON.stringify([error.message, error.codes, spies.flatMap((s) => s.mock.calls)]);
    expect(everything).not.toContain("4111111111111111");
    expect(everything).not.toContain("123");
  });
});


/* ------------------------------------------------------------------ */
/* Cenários de homologação (cartão): resposta síncrona                  */
/* ------------------------------------------------------------------ */

describe("cartão: tratamento da resposta síncrona", () => {
  const card = {
    holderName: "MARIA S SILVA",
    number: "4111111111111111",
    expiryMonth: "12",
    expiryYear: "2030",
    ccv: "123",
    holderCpfCnpj: "52998224725",
    postalCode: "87020025",
    addressNumber: "100",
    email: "m@x.com",
  };
  const asaasReturns = (status: string) => {
    respond = (c) =>
      c.url.endsWith("/payments") && c.method === "POST"
        ? { json: { id: "pay_card", status } }
        : { json: { id: "cus_x" } };
  };
  const dbWithOrderUpdate = (q: Query) => {
    if (q.kind === "insert" && q.table === "payments") return [{ id: "p-local" }];
    if (q.kind === "update" && q.table === "orders") return [{ id: order.id }];
    return [];
  };
  const run = () =>
    createCreditCardCharge({ order: cardOrder, customer, cardData: card, remoteIp: "203.0.113.9" });

  it("envia creditCardHolderInfo completo e remoteIp", async () => {
    asaasReturns("CONFIRMED");
    await run();
    const charge = calls.find((c) => c.url.endsWith("/payments") && c.method === "POST")!;
    expect(charge.body!.creditCardHolderInfo).toEqual({
      name: "MARIA S SILVA",
      email: "m@x.com",
      cpfCnpj: "52998224725",
      postalCode: "87020025",
      addressNumber: "100",
      phone: "44999998888",
    });
    expect(charge.body!.remoteIp).toBe("203.0.113.9");
  });

  it("CONFIRMED imediato: grava paidAt, libera o pedido e devolve released=true", async () => {
    asaasReturns("CONFIRMED");
    fake.handler = dbWithOrderUpdate;
    const result = await run();
    expect(result).toMatchObject({ status: "CONFIRMED", released: true });
    const [payment, ord] = fake.batches[0];
    expect(payment.set).toHaveProperty("paidAt");
    expect(payment.set).toMatchObject({ status: "CONFIRMED" });
    expect(ord.set).toMatchObject({ status: "RECEIVED" });
  });

  it("AWAITING_RISK_ANALYSIS: salva RISK_ANALYSIS e NÃO libera o pedido", async () => {
    asaasReturns("AWAITING_RISK_ANALYSIS");
    fake.handler = dbWithOrderUpdate;
    const result = await run();
    expect(result).toMatchObject({ status: "RISK_ANALYSIS", released: false });
    expect(fake.queries.find((q) => q.kind === "insert" && q.table === "payments")!.values).toMatchObject({
      status: "RISK_ANALYSIS",
    });
    expect(fake.batches).toHaveLength(0);
    expect(vi.mocked(after)).not.toHaveBeenCalled();
  });

  it("PENDING: mantém PENDING e NÃO libera o pedido", async () => {
    asaasReturns("PENDING");
    fake.handler = dbWithOrderUpdate;
    expect(await run()).toMatchObject({ status: "PENDING", released: false });
    expect(fake.batches).toHaveLength(0);
  });

  it("recusa síncrona (400): registra FAILED sem dados de cartão e devolve a mensagem amigável", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    respond = (c) =>
      c.url.endsWith("/payments") && c.method === "POST"
        ? {
            status: 400,
            json: { errors: [{ code: "invalid_action", description: "Transação não autorizada. Tente outro cartão." }] },
          }
        : { json: { id: "cus_x" } };
    const error = await run().catch((e) => e);
    expect(error).toBeInstanceOf(AsaasError);
    expect(error.userMessage).toBe("Transação não autorizada. Tente outro cartão.");
    const failed = fake.queries.find((q) => q.kind === "insert" && q.table === "payments")!;
    expect(failed.values).toMatchObject({ status: "FAILED", method: "CREDIT_CARD", amountCents: 4590 });
    expect(String(failed.values!.providerPaymentId)).toMatch(/^failed_/);
    expect(JSON.stringify(failed.values)).not.toContain("4111111111111111");
    expect(fake.batches).toHaveLength(0);
  });
});

describe("cartão: HTTP 200 nunca aprova por si só", () => {
  const card = {
    holderName: "MARIA S SILVA",
    number: "4111111111111111",
    expiryMonth: "12",
    expiryYear: "2030",
    ccv: "123",
    holderCpfCnpj: "52998224725",
    postalCode: "87020025",
    addressNumber: "100",
    email: "m@x.com",
  };

  it.each(["PENDING", "RECEIVED_IN_CASH", "SOMETHING_NEW", undefined])(
    "status %s não libera o pedido (aguarda o webhook)",
    async (status) => {
      respond = (c) =>
        c.url.endsWith("/payments") && c.method === "POST"
          ? { json: { id: "pay_card", status } }
          : { json: { id: "cus_x" } };
      fake.handler = (q: Query) => (q.kind === "insert" && q.table === "payments" ? [{ id: "p-local" }] : []);
      const result = await createCreditCardCharge({
        order: cardOrder,
        customer,
        cardData: card,
        remoteIp: "203.0.113.9",
      });
      expect(result.released).toBe(false);
      expect(vi.mocked(after)).not.toHaveBeenCalled(); // nada de cozinha/Saipos
      expect(result.paymentId).toBe("pay_card");
      expect(fake.batches).toHaveLength(0);
      expect(fake.queries.some((q) => q.kind === "update" && q.table === "orders")).toBe(false);
    },
  );

  it("RECEIVED libera e grava o pagamento como RECEIVED", async () => {
    respond = (c) =>
      c.url.endsWith("/payments") && c.method === "POST"
        ? { json: { id: "pay_card", status: "RECEIVED" } }
        : { json: { id: "cus_x" } };
    fake.handler = (q: Query) =>
      q.kind === "insert" && q.table === "payments"
        ? [{ id: "p-local" }]
        : q.kind === "update" && q.table === "orders"
          ? [{ id: order.id }]
          : [];
    const result = await createCreditCardCharge({
      order: cardOrder,
      customer,
      cardData: card,
      remoteIp: "203.0.113.9",
    });
    expect(result.released).toBe(true);
    expect(fake.batches[0][0].set).toMatchObject({ status: "RECEIVED" });
  });
});

describe("troca de método e reaproveitamento", () => {
  const pendingCard = { id: "p-old", providerPaymentId: "pay_card_old" };

  /** 1ª consulta a payments = findReusablePix; as seguintes = cobranças pendentes a cancelar. */
  function paymentsSelects(first: unknown[], rest: unknown[]) {
    let n = 0;
    fake.handler = (q: Query) => {
      if (q.kind === "select" && q.table === "payments") return n++ === 0 ? first : rest;
      return [];
    };
  }

  it("gerar Pix com cartão PENDING cancela a cobrança anterior (DELETE) e marca CANCELLED antes de criar a nova", async () => {
    paymentsSelects([], [pendingCard]);
    await createPixCharge({ order, customer: { ...customer, cpfCnpj: "52998224725" } });
    const del = calls.findIndex((c) => c.method === "DELETE");
    expect(calls[del].url).toContain("/payments/pay_card_old");
    expect(
      fake.queries.some((q) => q.kind === "update" && q.table === "payments" && q.set?.status === "CANCELLED"),
    ).toBe(true);
    expect(del).toBeLessThan(calls.findIndex((c) => c.method === "POST" && c.url.endsWith("/payments")));
  });

  /** Resposta do Asaas: DELETE falha (400) e o GET devolve o estado real da cobrança antiga. */
  function deleteFailsThenGet(remote: unknown, getStatus = 200) {
    respond = (c) => {
      if (c.method === "DELETE") return { status: 400, json: { errors: [{ code: "x", description: "n/a" }] } };
      if (c.method === "GET" && c.url.endsWith("/payments/pay_card_old")) {
        return getStatus === 200 ? { json: remote } : { status: getStatus, json: { errors: [{ code: "nf" }] } };
      }
      if (c.url.endsWith("/pixQrCode")) return { json: { encodedImage: "I", payload: "P" } };
      if (c.url.endsWith("/payments")) return { json: { id: "pay_new", status: "PENDING" } };
      return { json: { id: "cus_x" } };
    };
    let n = 0;
    fake.handler = (q: Query) => {
      if (q.kind === "select" && q.table === "payments") return n++ === 0 ? [] : [pendingCard];
      if (q.kind === "select" && q.table === "orders") return [{ tenantId: "t1", totalCents: 4590 }];
      if (q.kind === "update" && q.table === "orders") return [{ id: order.id }];
      return [];
    };
  }
  const cancelledLocally = () =>
    fake.queries.some((q) => q.kind === "update" && q.table === "payments" && q.set?.status === "CANCELLED");
  const createdNewCharge = () => calls.some((c) => c.method === "POST" && c.url.endsWith("/payments"));

  it.each(["CONFIRMED", "RECEIVED"])(
    "DELETE falhou porque a cobrança acabou de ser paga (GET %s): libera o pedido, NÃO cancela e NÃO cria nova cobrança",
    async (status) => {
      deleteFailsThenGet({ id: "pay_card_old", status, value: 45.9 });
      const error = await createPixCharge({
        order,
        customer: { ...customer, asaasCustomerId: "cus_x" },
      }).catch((e) => e);
      expect(error).toBeInstanceOf(PaymentConflictError);
      expect(error.reason).toBe("PAID");
      expect(createdNewCharge()).toBe(false);
      expect(cancelledLocally()).toBe(false);
      // pagamento sincronizado + pedido liberado no mesmo lote atômico
      const [payment, ord] = fake.batches[0];
      expect(payment.set).toMatchObject({ status });
      expect(ord.set).toMatchObject({ status: "RECEIVED" });
    },
  );

  it.each([
    ["OVERDUE", { id: "pay_card_old", status: "OVERDUE" }, 200],
    ["DELETED", { id: "pay_card_old", status: "DELETED" }, 200],
    ["deleted:true", { id: "pay_card_old", status: "PENDING", deleted: true }, 200],
    ["404", null, 404],
  ])("DELETE falhou e o GET indica cobrança morta (%s): marca CANCELLED e segue com a nova cobrança", async (_n, remote, getStatus) => {
    deleteFailsThenGet(remote, getStatus as number);
    await expect(
      createPixCharge({ order, customer: { ...customer, asaasCustomerId: "cus_x" } }),
    ).resolves.toMatchObject({ paymentId: "pay_new" });
    expect(cancelledLocally()).toBe(true);
    expect(fake.batches).toHaveLength(0);
  });

  it("DELETE falhou e o GET segue PENDING (não dá para garantir): bloqueia, mantém PENDING e não cria cobrança", async () => {
    deleteFailsThenGet({ id: "pay_card_old", status: "PENDING" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Caminho do cartão não consulta Pix reaproveitável: o 1º select já é o das cobranças pendentes.
    fake.handler = (q: Query) => (q.kind === "select" && q.table === "payments" ? [pendingCard] : []);
    const error = await createCreditCardCharge({ order: cardOrder, customer }).catch((e) => e);
    expect(error).toBeInstanceOf(PaymentConflictError);
    expect(error.reason).toBe("UNVERIFIED");
    expect(createdNewCharge()).toBe(false);
    expect(cancelledLocally()).toBe(false);
  });

  it("DELETE 200 cancela normalmente sem consultar o GET", async () => {
    let n = 0;
    fake.handler = (q: Query) =>
      q.kind === "select" && q.table === "payments" ? (n++ === 0 ? [] : [pendingCard]) : [];
    await createPixCharge({ order, customer: { ...customer, cpfCnpj: "52998224725" } });
    expect(cancelledLocally()).toBe(true);
    expect(calls.some((c) => c.method === "GET" && c.url.endsWith("/payments/pay_card_old"))).toBe(false);
  });

  it("Pix PENDING ainda válido é devolvido do banco sem criar cobrança nova", async () => {
    paymentsSelects(
      [
        {
          providerPaymentId: "pay_pix",
          status: "PENDING",
          pixPayload: "SAVED",
          pixQrCodeBase64: "IMG",
          pixExpirationDate: new Date(Date.now() + 600_000),
          invoiceUrl: null,
        },
      ],
      [],
    );
    const result = await createPixCharge({ order, customer });
    expect(result).toMatchObject({ paymentId: "pay_pix", pixPayload: "SAVED" });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("Pix expirado NÃO é reaproveitado (gera nova cobrança)", async () => {
    paymentsSelects(
      [
        {
          providerPaymentId: "pay_exp",
          status: "PENDING",
          pixPayload: "OLD",
          pixQrCodeBase64: "IMG",
          pixExpirationDate: new Date(Date.now() - 1000),
        },
      ],
      [],
    );
    const result = await createPixCharge({ order, customer: { ...customer, cpfCnpj: "52998224725" } });
    expect(result.paymentId).toBe("pay_1");
  });

  it("trocar para cartão cancela o Pix pendente antes da nova cobrança", async () => {
    paymentsSelects([{ id: "p-pix", providerPaymentId: "pay_pix_old" }], []);
    await createCreditCardCharge({ order: cardOrder, customer });
    expect(calls.find((c) => c.method === "DELETE")?.url).toContain("/payments/pay_pix_old");
  });
});
