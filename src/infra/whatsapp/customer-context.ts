import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/infra/db";
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
  };
}
