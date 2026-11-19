import { and, desc, eq, gte, inArray, notInArray } from "drizzle-orm";

import { db } from "@/infra/db";
import { getMilesBalance } from "@/infra/miles/miles";
import { customerAddresses, customers, orderItems, orders, whatsappSessions } from "@/infra/db/schema";

import { getBrazilianPhoneVariants } from "./phone";
import { getTenantId } from "./shared";

/* ------------------------------------------------------------------ */
/* 1. Contexto do cliente (pré-carregado no systemInstruction)           */
/* ------------------------------------------------------------------ */

export type CustomerContext =
  | { isRegistered: false }
  | {
      isRegistered: true;
      name: string;
      firstName: string;
      /** Já tem CPF/CNPJ no cadastro: nunca pedir o documento no chat. (O número não vai ao modelo.) */
      hasDocument: boolean;
      defaultAddress: {
        street: string;
        number: string;
        complement: string | null;
        reference: string | null;
        neighborhood: string | null;
      } | null;
      /** Ex.: "1x Nova York + 1x Batata". Nulo se nunca concluiu um pedido. */
      lastOrderSummary: string | null;
      /** Itens do último pedido (ids reais) para repetir via saveDraftOrder. */
      lastOrderItems: { productId: string | null; name: string; quantity: number; addonIds: string[] }[];
      /** Pedido das últimas 24 h ainda em andamento (a ÚNICA fonte para falar do status do pedido). */
      activeOrder?: { number: number; status: string; deliveryType: "DELIVERY" | "PICKUP" } | null;
      /** Saldo de milhas disponível (programa ativo); nulo se desligado/indisponível. */
      milesBalance?: number | null;
    };

export async function getCustomerContext(phone: string): Promise<CustomerContext> {
  const tenantId = await getTenantId();
  const variants = getBrazilianPhoneVariants(phone);
  if (!tenantId || variants.length === 0) return { isRegistered: false };

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), inArray(customers.phone, variants)))
    .limit(1);
  if (!customer) return { isRegistered: false };

  /* Vincula a sessão ao cliente (best-effort). */
  await db
    .update(whatsappSessions)
    .set({ customerId: customer.id })
    .where(eq(whatsappSessions.phone, phone))
    .catch(() => undefined);

  const [last] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.customerId, customer.id), eq(orders.status, "DELIVERED")))
    .orderBy(desc(orders.createdAt))
    .limit(1);

  const [active] = await db
    .select({ number: orders.orderNumber, status: orders.status, deliveryType: orders.deliveryType })
    .from(orders)
    .where(
      and(
        eq(orders.customerId, customer.id),
        gte(orders.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
        notInArray(orders.status, ["DELIVERED", "CANCELED"]),
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(1)
    .catch(() => []);
  const milesBalance = await getMilesBalance(tenantId, customer.id)
    .then((b) => b.available)
    .catch(() => null);

  let lastOrderItems: Extract<CustomerContext, { isRegistered: true }>["lastOrderItems"] = [];
  if (last) {
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, last.id));
    lastOrderItems = items.map((i) => ({
      productId: i.productId,
      name: i.productNameSnapshot,
      quantity: i.quantity,
      addonIds: (i.addonsSnapshot ?? []).map((a) => a.addon_id).filter((id): id is string => !!id),
    }));
  }

  let defaultAddress: Extract<CustomerContext, { isRegistered: true }>["defaultAddress"] = null;
  const snap = last?.addressSnapshot;
  if (snap) {
    defaultAddress = {
      street: snap.street,
      number: snap.number,
      complement: snap.complement,
      reference: snap.reference,
      neighborhood: snap.district ?? snap.neighborhood,
    };
  } else {
    const [addr] = await db
      .select()
      .from(customerAddresses)
      .where(eq(customerAddresses.customerId, customer.id))
      .limit(1);
    if (addr) {
      defaultAddress = {
        street: addr.street,
        number: addr.number,
        complement: addr.complement,
        reference: addr.reference,
        neighborhood: null,
      };
    }
  }

  return {
    isRegistered: true,
    name: customer.name,
    firstName: customer.name.trim().split(/\s+/)[0] ?? customer.name,
    hasDocument: !!customer.documentNumber,
    defaultAddress,
    lastOrderSummary:
      lastOrderItems.length > 0 ? lastOrderItems.map((i) => `${i.quantity}x ${i.name}`).join(" + ") : null,
    lastOrderItems,
    activeOrder: active ? { number: active.number, status: active.status, deliveryType: active.deliveryType } : null,
    milesBalance,
  };
}
