import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { calculateDeliveryQuote } from "@/core/delivery/quote";
import { cleanText, emailInput, passwordInput } from "@/core/schemas/auth";
import { db } from "@/infra/db";
import { customerAddresses, customers, whatsappSessions, type AddressSnapshot, type WhatsAppDraftCartItem } from "@/infra/db/schema";

import { buildSnapshot } from "./draft-flow";
import { priceCart, type Coords } from "./order-flow";
import { customerPhoneVariants, toCustomerPhone } from "./shared";

/**
 * Dados que o cliente preenche NO cardápio (depois de escolher os itens): entrega/retirada, endereço e,
 * só para quem ainda não tem conta no site, nome + e-mail + senha. O telefone vem sempre do token assinado.
 */
export const checkoutInputSchema = z.object({
  deliveryType: z.enum(["DELIVERY", "PICKUP"]),
  name: z.string().max(120).optional(),
  email: z.string().max(160).optional(),
  password: z.string().max(72).optional(),
  /** Endereço já salvo do cliente (precisa ser dele). */
  savedAddressId: z.string().uuid().nullish(),
  address: z
    .object({
      street: z.string().trim().min(2, "Informe a rua.").max(120),
      number: z.string().trim().min(1, "Informe o número.").max(20),
      complement: z.string().trim().max(80).nullish(),
      reference: z.string().trim().max(120).nullish(),
    })
    .nullish(),
});
export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

export type QuickCheckoutPrefill = {
  /** Sem senha no site: o formulário pede nome, e-mail e senha. */
  needsCredentials: boolean;
  name: string;
  email: string;
  addresses: { id: string; street: string; number: string; complement: string; reference: string }[];
  /** Taxa de entrega do 1º endereço salvo (null = não deu para calcular). O servidor recalcula ao fechar. */
  primaryFeeCents?: number | null;
};

async function findCustomer(tenantId: string, phone: string) {
  const variants = customerPhoneVariants(phone);
  if (variants.length === 0) return null;
  const [row] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), inArray(customers.phone, variants)))
    .limit(1);
  return row ?? null;
}

/** O que o formulário precisa saber do cliente deste telefone (sugestão de endereços, nome, se precisa de senha). */
export async function loadQuickCheckoutPrefill(tenantId: string, phone: string): Promise<QuickCheckoutPrefill> {
  const customer = await findCustomer(tenantId, phone);
  if (!customer) return { needsCredentials: true, name: "", email: "", addresses: [] };
  const rows = await db
    .select()
    .from(customerAddresses)
    .where(and(eq(customerAddresses.tenantId, tenantId), eq(customerAddresses.customerId, customer.id)))
    .limit(5);
  /* Taxa do endereço pré-selecionado, para o cliente ver o total antes do pagamento. */
  let primaryFeeCents: number | null = null;
  const first = rows[0];
  if (first) {
    try {
      const built = await buildSnapshot(tenantId, {
        street: first.street,
        number: first.number,
        complement: first.complement,
        reference: first.reference,
      });
      if (built.ok) {
        const quote = calculateDeliveryQuote(built.coords.lat, built.coords.lon, built.coords.city);
        if (quote.deliverable) primaryFeeCents = quote.feeCents;
      }
    } catch {
      /* geocodificação indisponível: a taxa aparece no pagamento */
    }
  }
  return {
    needsCredentials: !customer.passwordHash,
    name: customer.name,
    email: customer.email ?? "",
    primaryFeeCents,
    addresses: rows.map((a) => ({
      id: a.id,
      street: a.street,
      number: a.number,
      complement: a.complement ?? "",
      reference: a.reference ?? "",
    })),
  };
}

export type PreparedCheckout =
  | { ok: true; customerId: string | null; snapshot: AddressSnapshot | null; credentials: { name: string; email: string; passwordHash: string } | null }
  | { ok: false; status: number; error: string };

/**
 * Valida TUDO antes de gravar qualquer coisa (conta, endereço localizável, loja aberta, área e pedido mínimo),
 * para um erro nunca deixar cadastro pela metade.
 */
export async function prepareCheckout(
  tenantId: string,
  phone: string,
  items: WhatsAppDraftCartItem[],
  input: CheckoutInput,
): Promise<PreparedCheckout> {
  const customer = await findCustomer(tenantId, phone);

  /* Conta no site: quem não tem senha cria agora (nunca sobrescreve senha existente). */
  let credentials: { name: string; email: string; passwordHash: string } | null = null;
  if (!customer?.passwordHash) {
    const name = cleanText(input.name ?? customer?.name ?? "");
    if (name.length < 2) return { ok: false, status: 400, error: "Informe seu nome." };
    const email = emailInput.safeParse(input.email ?? "");
    if (!email.success) return { ok: false, status: 400, error: email.error.issues[0]?.message ?? "Informe um e-mail válido." };
    const password = passwordInput.safeParse(input.password ?? "");
    if (!password.success) return { ok: false, status: 400, error: password.error.issues[0]?.message ?? "Senha inválida." };
    const [taken] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.email, email.data)))
      .limit(1);
    if (taken && taken.id !== customer?.id) return { ok: false, status: 409, error: "Este e-mail já está em uso." };
    credentials = { name: name.slice(0, 80), email: email.data, passwordHash: await bcrypt.hash(password.data, 10) };
  }

  let snapshot: AddressSnapshot | null = null;
  let coords: Coords | null = null;
  if (input.deliveryType === "DELIVERY") {
    let address = input.address ?? null;
    if (!address && input.savedAddressId && customer) {
      const [saved] = await db
        .select()
        .from(customerAddresses)
        .where(
          and(
            eq(customerAddresses.id, input.savedAddressId),
            eq(customerAddresses.customerId, customer.id),
            eq(customerAddresses.tenantId, tenantId),
          ),
        )
        .limit(1);
      if (saved) address = { street: saved.street, number: saved.number, complement: saved.complement, reference: saved.reference };
    }
    if (!address) return { ok: false, status: 400, error: "Informe o endereço de entrega (rua e número)." };
    const built = await buildSnapshot(tenantId, address);
    if (!built.ok) return { ok: false, status: 422, error: built.error };
    snapshot = built.snapshot;
    coords = built.coords;
  }

  /* Loja aberta, área de entrega e pedido mínimo, já com o frete real. */
  const priced = await priceCart(tenantId, items, input.deliveryType, coords, snapshot?.district ?? snapshot?.neighborhood ?? null);
  if (!priced.ok) return { ok: false, status: 422, error: priced.error };

  return { ok: true, customerId: customer?.id ?? null, snapshot, credentials };
}

/** Grava a conta (se nova) e o rascunho completo na sessão, prontos para o fechamento do pedido. */
export async function saveCheckoutSession(
  tenantId: string,
  phone: string,
  items: WhatsAppDraftCartItem[],
  prepared: Extract<PreparedCheckout, { ok: true }>,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  let customerId = prepared.customerId;
  const local = toCustomerPhone(phone);
  if (!local) return { ok: false, status: 400, error: "Telefone inválido." };

  try {
    if (prepared.credentials) {
      const { name, email, passwordHash } = prepared.credentials;
      if (customerId) {
        await db
          .update(customers)
          .set({ name, email, passwordHash, phoneVerifiedAt: new Date() })
          .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
      } else {
        await db
          .insert(customers)
          .values({ tenantId, name, phone: local, email, passwordHash, phoneVerifiedAt: new Date() })
          .onConflictDoNothing();
        customerId = (await findCustomer(tenantId, phone))?.id ?? null;
      }
    }
    if (!customerId) return { ok: false, status: 500, error: "Não foi possível salvar seu cadastro. Tente novamente." };

    const fields = {
      customerId,
      state: "CONFIRMING_ORDER" as const,
      draftCart: items,
      deliveryAddress: prepared.snapshot,
      addressConfirmed: true,
      paymentMethod: null,
    };
    await db
      .insert(whatsappSessions)
      .values({ phone, ...fields })
      .onConflictDoUpdate({
        target: whatsappSessions.phone,
        set: { ...fields, lastInteractionAt: new Date(), updatedAt: new Date() },
      });
    return { ok: true };
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } } | null;
    if (e?.code === "23505" || e?.cause?.code === "23505") return { ok: false, status: 409, error: "Este e-mail já está em uso." };
    throw error;
  }
}
