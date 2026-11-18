import { beforeEach, describe, expect, it, vi } from "vitest";

import { calculateCart } from "@/core/cart/calculate-cart";
import { checkoutSchema } from "@/core/schemas/checkout";
import type { CatalogProduct } from "@/core/schemas/product";

const P1 = "7b0f6e0a-6a56-4d52-9a39-0c7a2b6a1f11";
const ADDON = "8c1f7e1b-7b67-4e63-8b4a-1d8b3b7b2a22";
const GROUP = "9d2a8f2c-8c78-4f74-9c5b-2e9c4c8c3b33";

const catalog = [
  {
    id: P1,
    name: "Burger",
    priceCents: 3000,
    isAvailable: true,
    addonGroups: [
      {
        id: GROUP,
        name: "Extras",
        minSelections: 0,
        maxSelections: 3,
        addons: [{ id: ADDON, name: "Bacon", priceCents: 500, maxQuantity: 3, isAvailable: true }],
      },
    ],
  },
] as unknown as CatalogProduct[];

const base = {
  customerName: "Maria Silva",
  customerPhone: "44999998888",
  deliveryType: "PICKUP",
  paymentMethod: "CASH",
  items: [{ productId: P1, quantity: 2, addons: [{ addonId: ADDON, quantity: 1 }] }],
};

describe("manipulação de preço: o servidor recalcula tudo", () => {
  it("campos de preço/total/frete forjados no payload são descartados pelo schema", () => {
    const forged = {
      ...base,
      totalCents: 1,
      subtotalCents: 1,
      deliveryFeeCents: 0,
      items: [
        {
          productId: P1,
          quantity: 2,
          priceCents: 1,
          unitPriceCents: 1,
          addons: [{ addonId: ADDON, quantity: 1, priceCents: 0 }],
        },
      ],
    };
    const data = checkoutSchema.parse(forged) as Record<string, unknown>;
    expect(data).not.toHaveProperty("totalCents");
    expect(data).not.toHaveProperty("subtotalCents");
    expect(data).not.toHaveProperty("deliveryFeeCents");
    const item = (data.items as Record<string, unknown>[])[0];
    expect(item).not.toHaveProperty("priceCents");
    expect(item).not.toHaveProperty("unitPriceCents");
    expect((item.addons as Record<string, unknown>[])[0]).not.toHaveProperty("priceCents");
  });

  it("total = (preço do banco + adicionais do banco) × quantidade", () => {
    const parsed = checkoutSchema.parse(base);
    const calc = calculateCart({ items: parsed.items, catalog, deliveryType: "PICKUP", minOrderCents: 0 });
    expect(calc).toMatchObject({ ok: true, subtotalCents: (3000 + 500) * 2, totalCents: 7000 });
  });

  it("adicional que não pertence ao produto é rejeitado", () => {
    const calc = calculateCart({
      items: [{ productId: P1, quantity: 1, addons: [{ addonId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", quantity: 1 }] }],
      catalog,
      deliveryType: "PICKUP",
      minOrderCents: 0,
    });
    expect(calc.ok).toBe(false);
  });

  it("quantidade inválida e observação gigante são recusadas pelo Zod", () => {
    for (const quantity of [0, -1, 51, 1.5]) {
      expect(checkoutSchema.safeParse({ ...base, items: [{ productId: P1, quantity, addons: [] }] }).success).toBe(false);
    }
    expect(checkoutSchema.safeParse({ ...base, notes: "x".repeat(2001) }).success).toBe(false);
  });

  it("pagamento online exige CPF e troco só vale para dinheiro", () => {
    expect(checkoutSchema.safeParse({ ...base, paymentMethod: "PIX" }).success).toBe(false);
    expect(
      checkoutSchema.safeParse({ ...base, paymentMethod: "PIX", documentNumber: "52998224725", changeForCents: 5000 })
        .success,
    ).toBe(false);
  });
});

describe("rate limit: falha fechada para card testing", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  async function loadWithBrokenDb() {
    vi.doMock("@/infra/db", () => ({
      db: {
        insert: () => {
          throw new Error("db down");
        },
      },
    }));
    return import("@/infra/security/rate-limit");
  }

  it("com o banco fora, o limite de cartão NEGA (failClosed)", async () => {
    const { checkRateLimit } = await loadWithBrokenDb();
    const r = await checkRateLimit({ identifier: "c1", route: "pay-card", limit: 5, windowSeconds: 600, failClosed: true });
    expect(r.allowed).toBe(false);
  });

  it("limites genéricos continuam liberando para não derrubar o site", async () => {
    const { checkRateLimit } = await loadWithBrokenDb();
    const r = await checkRateLimit({ identifier: "ip", route: "x", limit: 5, windowSeconds: 60 });
    expect(r.allowed).toBe(true);
  });
});
