import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  ctx: null as unknown as ReturnType<typeof import("./fake-db").createFakeDb>,
}));
vi.mock("@/infra/db", async () => {
  const { createFakeDb } = await import("./fake-db");
  f.ctx = createFakeDb();
  return { db: f.ctx.db };
});
const wa = vi.hoisted(() => ({ text: vi.fn().mockResolvedValue({}), cta: vi.fn().mockResolvedValue({}) }));
vi.mock("./client", () => ({ sendTextMessage: wa.text, sendCtaUrlButton: wa.cta }));

import { customerAddresses, customers, orders, whatsappMessages, whatsappSessions } from "@/infra/db/schema";

import { notifyOutForDelivery, notifyPaymentConfirmed } from "./notifications";

const ORDER = "11111111-1111-4111-8111-111111111111";
const SESSION_PHONE = "554399999999"; // a Meta entregou sem o 9º dígito

const order = (over: Record<string, unknown> = {}) => [
  { id: ORDER, customerId: "cu1", orderNumber: 1234, deliveryType: "DELIVERY", status: "RECEIVED", ...over },
];

beforeEach(() => {
  process.env.WHATSAPP_SESSION_SECRET = "test-secret-with-enough-length";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
  wa.text.mockReset().mockResolvedValue({});
  wa.cta.mockReset().mockResolvedValue({});
  f.ctx.rows.clear();
  f.ctx.writes.length = 0;
  f.ctx.rows.set(orders, order());
  f.ctx.rows.set(customers, [{ id: "cu1", name: "Maria", phone: "43999999999", passwordHash: null, documentNumber: null }]);
  f.ctx.rows.set(whatsappSessions, [{ phone: SESSION_PHONE, lastInteractionAt: new Date() }]);
  f.ctx.rows.set(customerAddresses, []);
  f.ctx.rows.set(whatsappMessages, [{ id: "m1" }]); // trava de envio concedida
});

describe("notifyPaymentConfirmed", () => {
  it("avisa no número da sessão e oferece completar o cadastro com token de 24h", async () => {
    await notifyPaymentConfirmed(ORDER);
    expect(wa.text).toHaveBeenCalledWith(
      SESSION_PHONE,
      "Pagamento confirmado! ✅ Seu pedido #1234 já está na chapa no Passaporte Burguer. Avisaremos quando sair para entrega!",
    );
    expect(wa.cta).toHaveBeenCalledTimes(1);
    const [to, body, label, url] = wa.cta.mock.calls[0] as string[];
    expect(to).toBe(SESSION_PHONE);
    expect(body).toMatch(/salvar seu endereço e CPF/);
    expect(label.length).toBeLessThanOrEqual(20);
    expect(url).toMatch(/^https:\/\/app\.test\/completar-cadastro\?token=/);

    const token = decodeURIComponent(url.split("token=")[1]);
    const claims = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
    expect(claims).toMatchObject({ phone: SESSION_PHONE, orderId: ORDER, purpose: "COMPLETE_REGISTRATION" });
    const ttl = claims.exp * 1000 - Date.now();
    expect(ttl).toBeGreaterThan(23.9 * 3600_000);
    expect(ttl).toBeLessThanOrEqual(24 * 3600_000);
  });

  it("retirada: avisa que será pelo balcão", async () => {
    f.ctx.rows.set(orders, order({ deliveryType: "PICKUP" }));
    await notifyPaymentConfirmed(ORDER);
    expect(wa.text.mock.calls[0][1]).toMatch(/pronto para retirada/);
  });

  it("cadastro completo (CPF + endereço) não recebe o convite", async () => {
    f.ctx.rows.set(customers, [{ id: "cu1", name: "Maria", phone: "43999999999", passwordHash: null, documentNumber: "52998224725" }]);
    f.ctx.rows.set(customerAddresses, [{ id: "a1" }]);
    await notifyPaymentConfirmed(ORDER);
    expect(wa.text).toHaveBeenCalledTimes(1);
    expect(wa.cta).not.toHaveBeenCalled();
  });

  it("quem tem conta no site (senha) não recebe o convite", async () => {
    f.ctx.rows.set(customers, [{ id: "cu1", name: "Maria", phone: "43999999999", passwordHash: "x", documentNumber: null }]);
    await notifyPaymentConfirmed(ORDER);
    expect(wa.cta).not.toHaveBeenCalled();
  });

  it("pedido sem sessão de WhatsApp: nada é enviado", async () => {
    f.ctx.rows.set(whatsappSessions, []);
    await notifyPaymentConfirmed(ORDER);
    expect(wa.text).not.toHaveBeenCalled();
  });

  it("sessão fora da janela de 24h da Meta: nada é enviado", async () => {
    f.ctx.rows.set(whatsappSessions, [{ phone: SESSION_PHONE, lastInteractionAt: new Date(Date.now() - 25 * 3600_000) }]);
    await notifyPaymentConfirmed(ORDER);
    expect(wa.text).not.toHaveBeenCalled();
  });

  it("idempotente: trava já tomada (webhook reentregue) não reenvia", async () => {
    f.ctx.rows.set(whatsappMessages, []);
    await notifyPaymentConfirmed(ORDER);
    expect(wa.text).not.toHaveBeenCalled();
    expect(wa.cta).not.toHaveBeenCalled();
  });

  it("falha da Meta não propaga e libera a trava para nova tentativa", async () => {
    wa.text.mockRejectedValueOnce(new Error("meta fora"));
    await expect(notifyPaymentConfirmed(ORDER)).resolves.toBeUndefined();
    expect(f.ctx.writes.some((w) => w.op === "delete" && w.table === whatsappMessages)).toBe(true);
    expect(wa.cta).not.toHaveBeenCalled();
  });
});

describe("notifyOutForDelivery", () => {
  it("avisa quando saiu para entrega", async () => {
    f.ctx.rows.set(orders, order({ status: "OUT_FOR_DELIVERY" }));
    await notifyOutForDelivery(ORDER);
    expect(wa.text).toHaveBeenCalledWith(SESSION_PHONE, expect.stringContaining("#1234 saiu para entrega"));
  });

  it("não avisa fora de OUT_FOR_DELIVERY nem em retirada", async () => {
    await notifyOutForDelivery(ORDER); // status RECEIVED
    f.ctx.rows.set(orders, order({ deliveryType: "PICKUP", status: "OUT_FOR_DELIVERY" }));
    await notifyOutForDelivery(ORDER);
    expect(wa.text).not.toHaveBeenCalled();
  });

  it("idempotente (Saipos reentrega)", async () => {
    f.ctx.rows.set(orders, order({ status: "OUT_FOR_DELIVERY" }));
    f.ctx.rows.set(whatsappMessages, []);
    await notifyOutForDelivery(ORDER);
    expect(wa.text).not.toHaveBeenCalled();
  });
});
