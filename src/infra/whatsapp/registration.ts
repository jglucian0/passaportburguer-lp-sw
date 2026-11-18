import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { OTHER_ZONE_NAME } from "@/core/store/maringa-zones";
import { resolveDeliveryZone } from "@/core/delivery/quote";
import { cleanText } from "@/core/schemas/auth";
import { documentError, onlyDigits } from "@/core/validation/document";
import { db } from "@/infra/db";
import { loadDeliveryZones } from "@/infra/db/queries";
import { customerAddresses, customers, orders, whatsappSessions } from "@/infra/db/schema";
import { checkRateLimit } from "@/infra/security/rate-limit";

import { geocodeAddress } from "./geocode";
import { businessWhatsAppNumber } from "./quick-cart";
import { verifyWhatsAppToken, type WhatsAppTokenPayload } from "./session-token";
import { customerPhoneVariants, getTenantId, toCustomerPhone } from "./shared";

/**
 * O telefone NUNCA vem do corpo: `.strict()` recusa qualquer campo extra (inclusive `phone`)
 * e a identidade é exclusivamente a do token assinado.
 */
export const registrationBodySchema = z
  .object({
    token: z.string().min(10).max(2000),
    name: z
      .string()
      .max(120)
      .transform(cleanText)
      .pipe(
        z
          .string()
          .min(5, "Informe seu nome completo.")
          .max(80, "Nome muito longo.")
          .refine((v) => v.includes(" "), "Informe nome e sobrenome."),
      ),
    document: z.string().max(18),
    street: z.string().trim().min(2, "Informe a rua.").max(120),
    number: z.string().trim().min(1, "Informe o número.").max(20),
    complement: z.string().trim().max(80).nullish(),
    reference: z.string().trim().max(120).nullish(),
  })
  .strict();

export type RegistrationResult = { status: number; body: Record<string, unknown> };

function verifyRegistrationToken(token: string): WhatsAppTokenPayload | null {
  const claims = verifyWhatsAppToken(token);
  return claims && claims.purpose === "COMPLETE_REGISTRATION" ? claims : null;
}

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

/** Endereço do pedido recém-pago (só se o pedido for deste cliente), para pré-preencher o formulário. */
async function orderAddress(customerId: string, orderId: string | undefined) {
  if (!orderId) return null;
  const [order] = await db
    .select({ customerId: orders.customerId, address: orders.addressSnapshot })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order || order.customerId !== customerId || !order.address) return null;
  return order.address;
}

export type RegistrationPrefill = {
  name: string;
  address: { street: string; number: string; complement: string; reference: string };
};

export async function loadRegistrationPrefill(claims: WhatsAppTokenPayload): Promise<RegistrationPrefill> {
  const tenantId = await getTenantId();
  const customer = tenantId ? await findCustomer(tenantId, claims.phone) : null;
  const a = customer ? await orderAddress(customer.id, claims.orderId) : null;
  return {
    name: customer?.name ?? "",
    address: {
      street: a?.street ?? "",
      number: a?.number ?? "",
      complement: a?.complement ?? "",
      reference: a?.reference ?? "",
    },
  };
}

export function registrationTokenClaims(token: string): WhatsAppTokenPayload | null {
  return verifyRegistrationToken(token);
}

export async function completeRegistration(raw: unknown): Promise<RegistrationResult> {
  const parsed = registrationBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 400, body: { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." } };
  }
  const data = parsed.data;

  const claims = verifyRegistrationToken(data.token);
  if (!claims) {
    return { status: 401, body: { ok: false, error: "Link inválido ou expirado. Peça um novo no WhatsApp." } };
  }
  const phone = claims.phone; // única fonte do telefone

  const docError = documentError(data.document);
  if (docError || onlyDigits(data.document).length !== 11) {
    return { status: 422, body: { ok: false, error: docError ?? "Informe um CPF válido." } };
  }
  const document = onlyDigits(data.document);

  const limit = await checkRateLimit({ identifier: phone, route: "complete-registration", limit: 10, windowSeconds: 600 });
  if (!limit.allowed) return { status: 429, body: { ok: false, error: "Muitas tentativas. Aguarde alguns minutos." } };

  const tenantId = await getTenantId();
  const local = toCustomerPhone(phone);
  if (!tenantId || !local) return { status: 400, body: { ok: false, error: "Telefone inválido." } };

  /* Cria (telefone já verificado pelo WhatsApp) ou atualiza o cliente deste telefone. */
  let customer = await findCustomer(tenantId, phone);
  if (!customer) {
    await db
      .insert(customers)
      .values({ tenantId, name: data.name, phone: local, phoneVerifiedAt: new Date(), documentNumber: document })
      .onConflictDoNothing();
    customer = await findCustomer(tenantId, phone);
    if (!customer) return { status: 500, body: { ok: false, error: "Não foi possível salvar. Tente novamente." } };
  }
  await db
    .update(customers)
    .set({
      documentNumber: document,
      phoneVerifiedAt: customer.phoneVerifiedAt ?? new Date(),
      // Conta já concluída no site mantém o nome que o cliente escolheu lá.
      ...(customer.passwordHash ? {} : { name: data.name }),
    })
    .where(and(eq(customers.id, customer.id), eq(customers.tenantId, tenantId)));

  /* Zona do endereço: a do pedido pago se rua/número não mudaram; senão geocodifica. Falha não bloqueia. */
  const snap = await orderAddress(customer.id, claims.orderId);
  const same =
    snap &&
    snap.street.toLowerCase() === data.street.toLowerCase() &&
    snap.number.toLowerCase() === data.number.toLowerCase();
  let zoneId: string | null = same ? snap.deliveryZoneId : null;
  if (!same) {
    const geo = await geocodeAddress(data.street, data.number).catch(() => null);
    if (geo) {
      const zones = await loadDeliveryZones(tenantId, { includeInactive: true });
      zoneId = resolveDeliveryZone(zones, geo.neighborhood, OTHER_ZONE_NAME)?.id ?? null;
    }
  }

  const saved = await db
    .select({ street: customerAddresses.street, number: customerAddresses.number })
    .from(customerAddresses)
    .where(and(eq(customerAddresses.tenantId, tenantId), eq(customerAddresses.customerId, customer.id)));
  const exists = saved.some(
    (a) => a.street.toLowerCase() === data.street.toLowerCase() && a.number.toLowerCase() === data.number.toLowerCase(),
  );
  if (!exists) {
    await db.insert(customerAddresses).values({
      tenantId,
      customerId: customer.id,
      deliveryZoneId: zoneId,
      street: data.street,
      number: data.number,
      complement: data.complement || null,
      reference: data.reference || null,
    });
  }

  /* Vincula a sessão: o próximo contato cai no Fluxo A (cliente cadastrado). */
  await db
    .insert(whatsappSessions)
    .values({ phone, customerId: customer.id })
    .onConflictDoUpdate({
      target: whatsappSessions.phone,
      set: { customerId: customer.id, updatedAt: new Date() },
    });

  const number = businessWhatsAppNumber();
  return { status: 200, body: { ok: true, redirectUrl: number ? `https://wa.me/${number}` : "https://wa.me/" } };
}
