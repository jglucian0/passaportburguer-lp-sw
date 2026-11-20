import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { calculateDeliveryQuote } from "@/core/delivery/quote";
import { cleanText, cpfInput } from "@/core/schemas/auth";
import { db } from "@/infra/db";
import { customerAddresses, customers, whatsappSessions, type AddressSnapshot, type WhatsAppDraftCartItem } from "@/infra/db/schema";

import { isProfileComplete } from "@/infra/auth/account";

import { buildSnapshot } from "./draft-flow";
import { priceCart, type Coords } from "./order-flow";
import { customerPhoneVariants, toCustomerPhone } from "./shared";

/**
 * Dados que o cliente preenche NO cardápio (depois de escolher os itens): entrega/retirada, endereço e,
 * só para quem ainda não tem nome/CPF cadastrados, nome + CPF (sem senha, sem validar o número: o token assinado
 * do WhatsApp já prova o telefone). O telefone vem sempre do token.
 */
export const checkoutInputSchema = z.object({
  deliveryType: z.enum(["DELIVERY", "PICKUP"]),
  /** "Consumir no local": retirada no salão (vai para a cozinha com essa observação). */
  dineIn: z.boolean().optional(),
  /** Opção já marcada na tela de pagamento (sempre online; lá o cliente ainda pode trocar). */
  paymentMethod: z.enum(["PIX", "CREDIT_CARD"]).optional(),
  /** Observações do pedido (cozinha/entregador). */
  notes: z.string().trim().max(300).optional(),
  name: z.string().max(120).optional(),
  /** CPF (com ou sem máscara); só exigido de quem ainda não tem CPF salvo. */
  document: z.string().max(18).optional(),
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
  /** Cadastro incompleto (sem nome ou sem CPF): o formulário pede só o que falta. */
  needsProfile: boolean;
  /** Nome já cadastrado ("" se não houver): cliente conhecido é chamado pelo nome e não digita nada. */
  name: string;
  /** CPF já salvo (o número nunca vai para o navegador). */
  hasDocument: boolean;
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
  if (!customer) return { needsProfile: true, name: "", hasDocument: false, addresses: [] };
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
    needsProfile: !isProfileComplete(customer),
    name: customer.name,
    hasDocument: !!customer.documentNumber,
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
  | { ok: true; customerId: string | null; snapshot: AddressSnapshot | null; profile: { name: string; documentNumber: string } | null }
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

  /* Cadastro: só nome + CPF, e só o que ainda falta. Quem já tem os dois segue direto (nada é pedido de novo). */
  let profile: { name: string; documentNumber: string } | null = null;
  const knownName = (customer?.name ?? "").trim();
  if (knownName.length < 2 || !customer?.documentNumber) {
    const name = knownName.length >= 2 ? knownName : cleanText(input.name ?? "").slice(0, 80);
    if (name.length < 2) return { ok: false, status: 400, error: "Informe seu nome." };
    let documentNumber = customer?.documentNumber ?? null;
    if (!documentNumber) {
      const doc = cpfInput.safeParse(input.document ?? "");
      if (!doc.success) return { ok: false, status: 400, error: doc.error.issues[0]?.message ?? "Informe um CPF válido." };
      documentNumber = doc.data;
    }
    profile = { name, documentNumber };
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

  return { ok: true, customerId: customer?.id ?? null, snapshot, profile };
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
    if (prepared.profile) {
      const { name, documentNumber } = prepared.profile;
      if (customerId) {
        await db
          .update(customers)
          .set({ name, documentNumber, phoneVerifiedAt: new Date() })
          .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
      } else {
        await db
          .insert(customers)
          .values({ tenantId, name, phone: local, documentNumber, phoneVerifiedAt: new Date() })
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
