import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  ctx: null as unknown as ReturnType<typeof import("@/infra/whatsapp/fake-db").createFakeDb>,
}));
vi.mock("@/infra/db", async () => {
  const { createFakeDb } = await import("@/infra/whatsapp/fake-db");
  f.ctx = createFakeDb();
  return { db: f.ctx.db };
});
vi.mock("@/infra/db/queries", () => ({
  loadDeliveryZones: async () => [
    { id: "zone-other", neighborhood: "Demais bairros de Maringá", feeCents: 0, estimatedMinutes: 40, isActive: true },
  ],
}));
vi.mock("@/infra/security/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) }));
vi.mock("@/infra/whatsapp/geocode", () => ({
  geocodeAddress: async () => ({ lat: -23.42, lon: -51.94, city: "Maringá", neighborhood: "Zona 07", postalCode: null }),
}));

import { customerAddresses, customers, orders, tenants, whatsappSessions } from "@/infra/db/schema";
import { signWhatsAppToken } from "@/infra/whatsapp/session-token";

import { POST } from "./route";

const PHONE = "5543999999999"; // dono do token
const OTHER = "5511988888888";
const VALID_CPF = "529.982.247-25";
const ORDER = "11111111-1111-4111-8111-111111111111";

const call = (body: unknown) =>
  POST(new Request("http://localhost/api/whatsapp/complete-registration", { method: "POST", body: JSON.stringify(body) }) as never);

const token = (over: { phone?: string; purpose?: "COMPLETE_REGISTRATION" | "QUICK_MENU"; orderId?: string } = {}) =>
  signWhatsAppToken(
    { phone: over.phone ?? PHONE, purpose: over.purpose ?? "COMPLETE_REGISTRATION", orderId: over.orderId },
    1440,
  );

const form = (over: Record<string, unknown> = {}) => ({
  token: token(),
  name: "Maria da Silva",
  document: VALID_CPF,
  street: "Rua A",
  number: "10",
  ...over,
});

const written = (table: unknown, op: string) => f.ctx.writes.filter((w) => w.table === table && w.op === op);

beforeEach(() => {
  process.env.WHATSAPP_SESSION_SECRET = "test-secret-with-enough-length";
  process.env.WHATSAPP_BUSINESS_NUMBER = "5543996098333";
  f.ctx.rows.clear();
  f.ctx.writes.length = 0;
  f.ctx.rows.set(tenants, [{ id: "t1" }]);
  f.ctx.rows.set(customers, [{ id: "cu1", name: "Maria", phone: "43999999999", passwordHash: null, phoneVerifiedAt: null }]);
  f.ctx.rows.set(customerAddresses, []);
});

describe("POST /api/whatsapp/complete-registration", () => {
  it("não existe mais senha/e-mail: campos extras são recusados (400) e nada é gravado", async () => {
    const res = await call(form({ email: "maria@example.com", password: "senha-forte-123" }));
    expect(res.status).toBe(400);
    expect(f.ctx.writes).toHaveLength(0);
  });

  it("salva CPF e endereço, vincula a sessão do telefone do TOKEN e devolve o redirect", async () => {
    const res = await call(form());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, redirectUrl: "https://wa.me/5543996098333" });

    expect(written(customers, "update")[0].set).toMatchObject({ documentNumber: "52998224725", name: "Maria da Silva" });
    expect(written(customerAddresses, "insert")[0].values).toMatchObject({
      customerId: "cu1",
      street: "Rua A",
      number: "10",
      deliveryZoneId: "zone-other",
    });
    expect(written(whatsappSessions, "insert")[0].values).toMatchObject({ phone: PHONE, customerId: "cu1" });
  });

  it("o telefone não pode vir do corpo: campo `phone` extra é recusado (400) e nada é gravado", async () => {
    const res = await call(form({ phone: OTHER }));
    expect(res.status).toBe(400);
    expect(f.ctx.writes).toHaveLength(0);
  });

  it("identidade = token: outro telefone no token grava só para ele", async () => {
    f.ctx.rows.set(customers, [{ id: "cu2", name: "João", phone: "11988888888", passwordHash: null, phoneVerifiedAt: null }]);
    await call(form({ token: token({ phone: OTHER }) }));
    expect(written(whatsappSessions, "insert")[0].values).toMatchObject({ phone: OTHER, customerId: "cu2" });
    expect(JSON.stringify(f.ctx.writes.map((w) => [w.values, w.set]))).not.toContain("43999999999");
  });

  it("cliente novo é criado com o telefone do token (já verificado), sem senha", async () => {
    let created = false;
    f.ctx.rows.set(customers, () =>
      created ? [{ id: "new", phone: "43999999999", passwordHash: null, phoneVerifiedAt: new Date() }] : [],
    );
    const orig = f.ctx.db.insert;
    f.ctx.db.insert = ((t: unknown) => {
      if (t === customers) created = true;
      return orig(t);
    }) as typeof orig;
    const res = await call(form());
    f.ctx.db.insert = orig;
    expect(res.status).toBe(200);
    const values = written(customers, "insert")[0].values as Record<string, unknown>;
    expect(values).toMatchObject({ phone: "43999999999", documentNumber: "52998224725" });
    expect(values.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(values.passwordHash).toBeUndefined();
  });

  it("usa a zona do pedido pago quando rua e número não mudam", async () => {
    f.ctx.rows.set(orders, [
      { customerId: "cu1", address: { street: "Rua A", number: "10", deliveryZoneId: "zone-pedido", complement: null, reference: null } },
    ]);
    await call(form({ token: token({ orderId: ORDER }) }));
    expect(written(customerAddresses, "insert")[0].values).toMatchObject({ deliveryZoneId: "zone-pedido" });
  });

  it("ignora endereço de pedido que não é do cliente do token", async () => {
    f.ctx.rows.set(orders, [{ customerId: "outro", address: { street: "Rua A", number: "10", deliveryZoneId: "zone-alheia" } }]);
    await call(form({ token: token({ orderId: ORDER }) }));
    expect(written(customerAddresses, "insert")[0].values).not.toMatchObject({ deliveryZoneId: "zone-alheia" });
  });

  it("401 para token expirado, adulterado e de outro propósito", async () => {
    vi.useFakeTimers();
    const old = token();
    vi.advanceTimersByTime(25 * 60 * 60_000);
    const expired = await call(form({ token: old }));
    vi.useRealTimers();
    expect(expired.status).toBe(401);

    const [, sig] = token().split(".");
    const forged = Buffer.from(JSON.stringify({ phone: OTHER, purpose: "COMPLETE_REGISTRATION", exp: 9999999999 })).toString("base64url");
    expect((await call(form({ token: `${forged}.${sig}` }))).status).toBe(401);
    expect((await call(form({ token: token({ purpose: "QUICK_MENU" }) }))).status).toBe(401);
    expect(f.ctx.writes).toHaveLength(0);
  });

  it("422 para CPF inválido (dígitos verificadores) e para CNPJ", async () => {
    expect((await call(form({ document: "111.111.111-11" }))).status).toBe(422);
    expect((await call(form({ document: "529.982.247-24" }))).status).toBe(422);
    expect((await call(form({ document: "11.222.333/0001-81" }))).status).toBe(422);
    expect(f.ctx.writes).toHaveLength(0);
  });

  it("400 sem sobrenome ou sem rua", async () => {
    expect((await call(form({ name: "Maria" }))).status).toBe(400);
    expect((await call(form({ street: "" }))).status).toBe(400);
  });
});
