import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdReferral, Attribution } from "@/lib/attribution";

/* ------------------------------------------------------------------ */
/* Tipos auxiliares (JSONB)                                            */
/* ------------------------------------------------------------------ */

export type DayOpeningHours = {
  enabled: boolean;
  open: string; // "HH:mm"
  close: string; // "HH:mm"
};

/** Chaves "0" (domingo) a "6" (sábado). */
export type OpeningHours = Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", DayOpeningHours>;

/** Faixa de frete por distância: vale até `maxKm` (a faixa começa onde a anterior termina). */
export type DeliveryBand = {
  maxKm: number;
  feeCents: number;
};

/** Regras de cobertura por raio a partir do endereço base da loja. */
export type DeliveryRules = {
  restrictToCity: boolean;
  city: string;
  maxRadiusKm: number;
  baseAddress: string;
  bands: DeliveryBand[];
};

export type AddressSnapshot = {
  neighborhood: string;
  street: string;
  number: string;
  complement: string | null;
  reference: string | null;
  deliveryZoneId: string | null;
  /** Pino confirmado pelo cliente no mapa (ausente em pedidos antigos/manuais). */
  latitude?: number | null;
  longitude?: number | null;
  /** Dados reais do endereço geocodificado (o campo neighborhood guarda o nome da zona de frete). */
  city?: string | null;
  district?: string | null;
  postalCode?: string | null;
};

export type SaiposSyncStatus = "PENDING" | "SYNCED" | "FAILED" | "DISABLED";
export type FinancialAlertType = "REFUNDED" | "CHARGEBACK";
export type SaiposCancelStatus = "NOT_APPLICABLE" | "CANCELLED" | "MANUAL_ACTION_REQUIRED" | "RECONCILED";

export type OrderItemAddonSnapshot = {
  /** Id do adicional no cardápio (usado para resolver o saiposCode). Ausente em pedidos antigos. */
  addon_id?: string;
  name: string;
  price_cents: number;
  quantity: number;
};

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const adminRoleEnum = pgEnum("admin_role", ["OWNER", "KITCHEN"]);

export const orderStatusEnum = pgEnum("order_status", [
  "AWAITING_PAYMENT",
  "RECEIVED",
  "PREPARING",
  "OUT_FOR_DELIVERY",
  "READY_FOR_PICKUP",
  "DELIVERED",
  "CANCELED",
]);

export const deliveryTypeEnum = pgEnum("delivery_type", ["DELIVERY", "PICKUP"]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "PIX",
  "CREDIT_CARD",
  "CARD_ON_DELIVERY",
  "CASH",
]);

/* ------------------------------------------------------------------ */
/* 1. tenants                                                          */
/* ------------------------------------------------------------------ */

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    customDomain: text("custom_domain"),
    phoneWhatsapp: text("phone_whatsapp"),
    logoUrl: text("logo_url"),
    primaryColor: text("primary_color").notNull().default("#f5a623"),
    minOrderCents: integer("min_order_cents").notNull().default(0),
    isManuallyClosed: boolean("is_manually_closed").notNull().default(false),
    openingHours: jsonb("opening_hours").$type<OpeningHours>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tenants_slug_uq").on(t.slug),
    uniqueIndex("tenants_custom_domain_uq").on(t.customDomain),
  ],
);

/* ------------------------------------------------------------------ */
/* 1b. store_settings (1 registro por tenant)                          */
/* ------------------------------------------------------------------ */

export const storeSettings = pgTable(
  "store_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** true = aberta à força; false = fechada à força; null = segue o horário. */
    isOpenOverride: boolean("is_open_override"),
    autoAcceptOrders: boolean("auto_accept_orders").notNull().default(false),
    estimatedDeliveryMinutes: integer("estimated_delivery_minutes").notNull().default(40),
    openingHours: jsonb("opening_hours").$type<OpeningHours>().notNull(),
    /** Endereço físico da loja (exibição). */
    address: text("address"),
    /** Cobertura/faixas de frete por raio; nulo = padrão de `DEFAULT_DELIVERY_RULES`. */
    deliveryRules: jsonb("delivery_rules").$type<DeliveryRules>(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("store_settings_tenant_uq").on(t.tenantId)],
);

/* ------------------------------------------------------------------ */
/* 2. admin_users                                                      */
/* ------------------------------------------------------------------ */

export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: adminRoleEnum("role").notNull().default("KITCHEN"),
    /** Acesso desativado = não entra nem opera (sessões existentes caem). */
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("admin_users_tenant_idx").on(t.tenantId),
    uniqueIndex("admin_users_tenant_email_uq").on(t.tenantId, t.email),
  ],
);

/* ------------------------------------------------------------------ */
/* 3. categories                                                       */
/* ------------------------------------------------------------------ */

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("categories_tenant_idx").on(t.tenantId, t.sortOrder)],
);

/* ------------------------------------------------------------------ */
/* 4. products                                                         */
/* ------------------------------------------------------------------ */

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    priceCents: integer("price_cents").notNull(),
    imageUrl: text("image_url"),
    isAvailable: boolean("is_available").notNull().default(true),
    isFeatured: boolean("is_featured").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Código PDV do produto no Saipos (opcional). */
    saiposCode: text("saipos_code"),
  },
  (t) => [
    index("products_tenant_idx").on(t.tenantId),
    index("products_category_idx").on(t.categoryId, t.sortOrder),
  ],
);

/* ------------------------------------------------------------------ */
/* 5. addon_groups                                                     */
/* ------------------------------------------------------------------ */

export const addonGroups = pgTable(
  "addon_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    minSelections: integer("min_selections").notNull().default(0),
    maxSelections: integer("max_selections").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("addon_groups_tenant_idx").on(t.tenantId),
    index("addon_groups_product_idx").on(t.productId, t.sortOrder),
  ],
);

/* ------------------------------------------------------------------ */
/* 6. addons                                                           */
/* ------------------------------------------------------------------ */

export const addons = pgTable(
  "addons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    addonGroupId: uuid("addon_group_id")
      .notNull()
      .references(() => addonGroups.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priceCents: integer("price_cents").notNull().default(0),
    /** Quantidade máxima deste adicional por item (o grupo ainda limita o total). */
    maxQuantity: integer("max_quantity").notNull().default(1),
    isAvailable: boolean("is_available").notNull().default(true),
    /** Código PDV do adicional no Saipos (opcional). */
    saiposCode: text("saipos_code"),
  },
  (t) => [
    index("addons_tenant_idx").on(t.tenantId),
    index("addons_group_idx").on(t.addonGroupId),
  ],
);

/* ------------------------------------------------------------------ */
/* 7. delivery_zones                                                   */
/* ------------------------------------------------------------------ */

export const deliveryZones = pgTable(
  "delivery_zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    neighborhood: text("neighborhood").notNull(),
    feeCents: integer("fee_cents").notNull().default(0),
    estimatedMinutes: integer("estimated_minutes").notNull().default(40),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [index("delivery_zones_tenant_idx").on(t.tenantId)],
);

/* ------------------------------------------------------------------ */
/* 8. customers                                                        */
/* ------------------------------------------------------------------ */

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Apenas dígitos. */
    phone: text("phone").notNull(),
    /** Preenchido quando o WhatsApp foi validado e o cadastro concluído (validação única). */
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    /** E-mail de recuperação de senha (minúsculo). */
    email: text("email"),
    /** Id do cliente no Asaas (cus_xxx): reaproveitado para não duplicar cadastro a cada pedido. */
    asaasCustomerId: text("asaas_customer_id"),
    /** CPF (só dígitos), coletado no cadastro pós-pagamento do WhatsApp. Dado pessoal: nunca logar. */
    documentNumber: text("document_number"),
    /** Hash bcrypt da senha; nulo enquanto o cadastro não foi concluído. */
    passwordHash: text("password_hash"),
    /** Senhas erradas consecutivas; zera ao acertar ou ao bloquear. */
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    /** Login bloqueado até este instante (anti-brute force). */
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("customers_tenant_idx").on(t.tenantId),
    uniqueIndex("customers_tenant_phone_uq").on(t.tenantId, t.phone),
    uniqueIndex("customers_tenant_email_uq").on(t.tenantId, t.email),
  ],
);

/* ------------------------------------------------------------------ */
/* 8-s. sessions (sessões revogáveis; só o hash SHA-256 do token)       */
/* ------------------------------------------------------------------ */

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_uq").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

/* ------------------------------------------------------------------ */
/* 8-r. rate_limits (janela fixa por chave "rota:ip")                   */
/* ------------------------------------------------------------------ */

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("rate_limits_reset_idx").on(t.resetAt)],
);

/* ------------------------------------------------------------------ */
/* 8a. password_resets (código de 6 dígitos por e-mail, 15 min)        */
/* ------------------------------------------------------------------ */

export const passwordResets = pgTable(
  "password_resets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** HMAC-SHA256 do código (nunca o código em claro). */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Tentativas erradas; o código é descartado ao atingir o limite. */
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("password_resets_customer_idx").on(t.customerId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* 8b. whatsapp_otps (login sem senha)                                 */
/* ------------------------------------------------------------------ */

export const whatsappOtps = pgTable(
  "whatsapp_otps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Padrão internacional, apenas dígitos. */
    phone: text("phone").notNull(),
    /** Código de embarque único (ex: PASS-4829), enviado pelo cliente via wa.me. */
    code: text("code").notNull(),
    verified: boolean("verified").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("whatsapp_otps_phone_idx").on(t.phone, t.createdAt),
    uniqueIndex("whatsapp_otps_code_uq").on(t.code),
  ],
);

/* ------------------------------------------------------------------ */
/* 9. customer_addresses                                             */
/* ------------------------------------------------------------------ */

export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    deliveryZoneId: uuid("delivery_zone_id").references(() => deliveryZones.id, {
      onDelete: "set null",
    }),
    street: text("street").notNull(),
    number: text("number").notNull(),
    complement: text("complement"),
    reference: text("reference"),
  },
  (t) => [
    index("customer_addresses_tenant_idx").on(t.tenantId),
    index("customer_addresses_customer_idx").on(t.customerId),
  ],
);

/* ------------------------------------------------------------------ */
/* 10. orders                                                          */
/* ------------------------------------------------------------------ */

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    /** Sequencial legível por tenant (ex: 101). Exibido como "#101". */
    orderNumber: integer("order_number").notNull(),
    status: orderStatusEnum("status").notNull().default("RECEIVED"),
    deliveryType: deliveryTypeEnum("delivery_type").notNull(),
    /** Imutável após criação. Nulo para PICKUP. */
    addressSnapshot: jsonb("address_snapshot").$type<AddressSnapshot>(),
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    changeForCents: integer("change_for_cents"),
    subtotalCents: integer("subtotal_cents").notNull(),
    deliveryFeeCents: integer("delivery_fee_cents").notNull().default(0),
    /** Cupom aplicado só sobre os itens (nunca sobre a taxa). total = subtotal - desconto + taxa. */
    discountCents: integer("discount_cents").notNull().default(0),
    couponId: uuid("coupon_id"),
    couponCode: text("coupon_code"),
    /** Preenchido quando o cupom foi consumido (pagamento confirmado): garante consumo único. */
    couponConsumedAt: timestamp("coupon_consumed_at", { withTimezone: true }),
    totalCents: integer("total_cents").notNull(),
    notes: text("notes"),
    /** CPF (11) ou CNPJ (14) na nota fiscal, só dígitos. Opcional. */
    documentNumber: text("document_number"),
    /** Origem do pedido (UTM, anúncio, canal). Ver src/lib/attribution.ts. */
    attribution: jsonb("attribution").$type<Attribution>(),
    cancelReason: text("cancel_reason"),
    /** Chave gerada no checkout: impede pedido duplicado por duplo clique/reenvio (única por tenant). */
    idempotencyKey: text("idempotency_key"),
    /** Integração Saipos: id do pedido no Saipos, estado do envio e último erro. */
    saiposOrderId: text("saipos_order_id"),
    saiposSyncStatus: text("saipos_sync_status")
      .$type<SaiposSyncStatus>()
      .notNull()
      .default("PENDING"),
    saiposLastError: text("saipos_last_error"),
    saiposSyncedAt: timestamp("saipos_synced_at", { withTimezone: true }),
    /** Estorno/chargeback após a aprovação do pagamento (nulo = nenhum). */
    financialAlertType: text("financial_alert_type").$type<FinancialAlertType>(),
    /** Conciliação com o PDV Saipos após estorno/chargeback. */
    saiposCancelStatus: text("saipos_cancel_status")
      .$type<SaiposCancelStatus>()
      .notNull()
      .default("NOT_APPLICABLE"),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    /** Nome do OWNER que confirmou o ajuste manual no Saipos. */
    reconciledBy: text("reconciled_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("orders_tenant_idx").on(t.tenantId),
    index("orders_tenant_saipos_cancel_idx").on(t.tenantId, t.saiposCancelStatus),
    uniqueIndex("orders_tenant_number_uq").on(t.tenantId, t.orderNumber),
    index("orders_tenant_status_idx").on(t.tenantId, t.status),
    index("orders_tenant_updated_idx").on(t.tenantId, t.updatedAt),
    index("orders_saipos_order_idx").on(t.saiposOrderId),
    index("orders_customer_idx").on(t.customerId, t.createdAt),
    uniqueIndex("orders_tenant_idempotency_uq").on(t.tenantId, t.idempotencyKey),
  ],
);

/* ------------------------------------------------------------------ */
/* 11. order_items                                                     */
/* ------------------------------------------------------------------ */

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    productNameSnapshot: text("product_name_snapshot").notNull(),
    unitPriceCentsSnapshot: integer("unit_price_cents_snapshot").notNull(),
    quantity: integer("quantity").notNull(),
    addonsSnapshot: jsonb("addons_snapshot")
      .$type<OrderItemAddonSnapshot[]>()
      .notNull()
      .default([]),
    totalItemCents: integer("total_item_cents").notNull(),
  },
  (t) => [
    index("order_items_tenant_idx").on(t.tenantId),
    index("order_items_order_idx").on(t.orderId),
  ],
);

/* ------------------------------------------------------------------ */
/* Relações                                                            */
/* ------------------------------------------------------------------ */

export const tenantsRelations = relations(tenants, ({ many }) => ({
  adminUsers: many(adminUsers),
  categories: many(categories),
  products: many(products),
  deliveryZones: many(deliveryZones),
  customers: many(customers),
  orders: many(orders),
}));

export const adminUsersRelations = relations(adminUsers, ({ one }) => ({
  tenant: one(tenants, { fields: [adminUsers.tenantId], references: [tenants.id] }),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  tenant: one(tenants, { fields: [categories.tenantId], references: [tenants.id] }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  tenant: one(tenants, { fields: [products.tenantId], references: [tenants.id] }),
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  addonGroups: many(addonGroups),
}));

export const addonGroupsRelations = relations(addonGroups, ({ one, many }) => ({
  product: one(products, { fields: [addonGroups.productId], references: [products.id] }),
  addons: many(addons),
}));

export const addonsRelations = relations(addons, ({ one }) => ({
  group: one(addonGroups, { fields: [addons.addonGroupId], references: [addonGroups.id] }),
}));

export const deliveryZonesRelations = relations(deliveryZones, ({ one }) => ({
  tenant: one(tenants, { fields: [deliveryZones.tenantId], references: [tenants.id] }),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [customers.tenantId], references: [tenants.id] }),
  addresses: many(customerAddresses),
  orders: many(orders),
}));

export const customerAddressesRelations = relations(customerAddresses, ({ one }) => ({
  customer: one(customers, {
    fields: [customerAddresses.customerId],
    references: [customers.id],
  }),
  deliveryZone: one(deliveryZones, {
    fields: [customerAddresses.deliveryZoneId],
    references: [deliveryZones.id],
  }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  tenant: one(tenants, { fields: [orders.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));

/* ------------------------------------------------------------------ */
/* Tipos inferidos                                                     */
/* ------------------------------------------------------------------ */

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type AddonGroup = typeof addonGroups.$inferSelect;
export type NewAddonGroup = typeof addonGroups.$inferInsert;
export type Addon = typeof addons.$inferSelect;
export type NewAddon = typeof addons.$inferInsert;
export type DeliveryZone = typeof deliveryZones.$inferSelect;
export type NewDeliveryZone = typeof deliveryZones.$inferInsert;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type CustomerAddress = typeof customerAddresses.$inferSelect;
export type NewCustomerAddress = typeof customerAddresses.$inferInsert;
/* ------------------------------------------------------------------ */
/* coupons (cupons promocionais)                                       */
/* ------------------------------------------------------------------ */

export const couponTypeEnum = pgEnum("coupon_type", ["PERCENT", "FIXED"]);

export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    type: couponTypeEnum("type").notNull(),
    /** PERCENT: 1–100. FIXED: centavos. */
    value: integer("value").notNull(),
    minOrderCents: integer("min_order_cents").notNull().default(0),
    /** null = ilimitado. */
    maxUses: integer("max_uses"),
    usedCount: integer("used_count").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    /** null = sem validade. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Cupom pessoal (campanhas): só este cliente pode usar. null = qualquer cliente. */
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    /** Teto do desconto em % do valor dos itens (cupons de cashback de milhas). null = sem teto. */
    maxDiscountPercent: integer("max_discount_percent"),
    /** Cupom de item grátis (milhas): desconta 1 unidade deste produto, que precisa estar no pedido. */
    freeProductId: uuid("free_product_id").references(() => products.id, { onDelete: "set null" }),
    /** Cupom de frete grátis (benefício de nível): zera a taxa de entrega. */
    freeShipping: boolean("free_shipping").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("coupons_tenant_code_uq").on(t.tenantId, t.code)],
);

export type Coupon = typeof coupons.$inferSelect;

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;

export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];
export type DeliveryType = (typeof deliveryTypeEnum.enumValues)[number];
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
export type AdminRole = (typeof adminRoleEnum.enumValues)[number];

/* ------------------------------------------------------------------ */
/* payments (cobranças no Asaas; trilha de auditoria)                  */
/* Nunca armazenar PAN, CVV ou validade do cartão: só ids/tokens do    */
/* gateway (PCI-DSS / LGPD).                                           */
/* ------------------------------------------------------------------ */

export type PaymentProvider = "asaas";
export type OnlinePaymentMethod = "PIX" | "CREDIT_CARD";
export type PaymentStatus =
  | "PENDING"
  /** Cartão aguardando análise de risco do Asaas. */
  | "RISK_ANALYSIS"
  | "CONFIRMED"
  | "RECEIVED"
  | "OVERDUE"
  | "REFUNDED"
  | "CHARGEBACK"
  | "FAILED"
  /** Cobrança removida no Asaas (troca de método, nova tentativa ou pedido expirado). */
  | "CANCELLED";

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    provider: text("provider").$type<PaymentProvider>().notNull().default("asaas"),
    /** Id da cobrança no gateway (pay_xxx). */
    providerPaymentId: text("provider_payment_id").notNull(),
    /** Id do cliente no gateway (cus_xxx). */
    providerCustomerId: text("provider_customer_id").notNull(),
    method: text("method").$type<OnlinePaymentMethod>().notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: text("status").$type<PaymentStatus>().notNull().default("PENDING"),
    pixPayload: text("pix_payload"),
    pixQrCodeBase64: text("pix_qr_code_base64"),
    pixExpirationDate: timestamp("pix_expiration_date", { withTimezone: true }),
    invoiceUrl: text("invoice_url"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("payments_provider_payment_uq").on(t.providerPaymentId),
    index("payments_order_idx").on(t.orderId),
  ],
);

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;

/* ------------------------------------------------------------------ */
/* order_timeline_events (histórico cronológico do pedido)             */
/* ------------------------------------------------------------------ */

export type OrderTimelineEventType =
  | "ORDER_CREATED"
  | "ORDER_CANCELED"
  | "PAYMENT_CONFIRMED"
  | "SENT_TO_SAIPOS"
  | "PAYMENT_REFUNDED"
  | "PAYMENT_CHARGEBACK"
  | "SAIPOS_CANCEL_ATTEMPT"
  | "SAIPOS_RECONCILED";

export const orderTimelineEvents = pgTable(
  "order_timeline_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    type: text("type").$type<OrderTimelineEventType>().notNull(),
    title: text("title").notNull(),
    description: text("description"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    /** Chave de idempotência (ex.: `<eventId>:refund`): retentativas do webhook não duplicam o registro. */
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("order_timeline_order_idx").on(t.orderId, t.createdAt),
    uniqueIndex("order_timeline_dedupe_uq").on(t.dedupeKey),
  ],
);

export type OrderTimelineEvent = typeof orderTimelineEvents.$inferSelect;

/* ------------------------------------------------------------------ */
/* payment_events (idempotência de webhooks de pagamento)              */
/* ------------------------------------------------------------------ */

export const paymentEvents = pgTable(
  "payment_events",
  {
    /** ID único do evento enviado pelo gateway (evt_xxx no Asaas). */
    eventId: text("event_id").primaryKey(),
    eventType: text("event_type").notNull().default("UNKNOWN"),
    providerPaymentId: text("provider_payment_id"),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }),
    /** Legado (webhook PIX genérico). */
    amountCents: integer("amount_cents"),
    /** Coluna física `received_at` mantida por compatibilidade com o webhook PIX genérico. */
    processedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payment_events_order_idx").on(t.orderId),
    index("payment_events_provider_payment_idx").on(t.providerPaymentId),
  ],
);

/* ------------------------------------------------------------------ */
/* WhatsApp Bot (Meta Cloud API)                                       */
/* ------------------------------------------------------------------ */

export type WhatsAppSessionState =
  | "IDLE"
  | "GREETING"
  | "BROWSING"
  | "CONFIRMING_ORDER"
  | "AWAITING_PAYMENT"
  | "COMPLETED";

export type WhatsAppDraftCartItem = {
  productId: string;
  quantity: number;
  notes?: string | null;
  addons?: { addonId: string; quantity: number }[];
};

export type WhatsAppMessageRole = "user" | "assistant" | "system";
export type WhatsAppMediaType = "text" | "audio" | "image" | "sticker" | "interactive";

/** Sessão da conversa. PK = telefone E.164 só com dígitos (ex.: 5543999999999). */
export const whatsappSessions = pgTable(
  "whatsapp_sessions",
  {
    phone: text("phone").primaryKey(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    state: text("state").$type<WhatsAppSessionState>().notNull().default("GREETING"),
    draftCart: jsonb("draft_cart").$type<WhatsAppDraftCartItem[]>(),
    deliveryAddress: jsonb("delivery_address").$type<AddressSnapshot>(),
    /** Transbordo humano: enquanto > now(), a IA não responde. */
    botPausedUntil: timestamp("bot_paused_until", { withTimezone: true }),
    /** Lock atômico do turno: enquanto > now(), outro processo já está respondendo este telefone. */
    processingLockUntil: timestamp("processing_lock_until", { withTimezone: true }),
    /** O cliente já confirmou o endereço de entrega: não perguntar de novo. */
    addressConfirmed: boolean("address_confirmed").notNull().default(false),
    /** Forma de pagamento já escolhida neste pedido (null = ainda não escolheu). */
    paymentMethod: text("payment_method").$type<PaymentMethod>(),
    /** O cliente pediu para não receber mensagens de marketing/retorno (PARAR). */
    marketingOptOutAt: timestamp("marketing_opt_out_at", { withTimezone: true }),
    /** Anúncio "Clique para o WhatsApp" que originou a conversa (vale 7 dias). */
    adReferral: jsonb("ad_referral").$type<AdReferral>(),
    /** Início do pedido atual: o histórico enviado à IA só considera mensagens a partir daqui. */
    sessionStartedAt: timestamp("session_started_at", { withTimezone: true }).notNull().defaultNow(),
    lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("whatsapp_sessions_customer_idx").on(t.customerId)],
);

/** Histórico + deduplicação (wamid único da Meta). */
export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wamid: text("wamid").unique(),
    phone: text("phone").notNull(),
    role: text("role").$type<WhatsAppMessageRole>().notNull(),
    content: text("content").notNull(),
    mediaType: text("media_type").$type<WhatsAppMediaType>().notNull().default("text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("whatsapp_messages_phone_idx").on(t.phone, t.createdAt)],
);

/** Buffer de debounce: mensagens "picadas" são agrupadas antes de processar. */
export const whatsappInboxBuffer = pgTable(
  "whatsapp_inbox_buffer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull(),
    wamid: text("wamid").notNull().unique(),
    payload: jsonb("payload").notNull(),
    processed: boolean("processed").notNull().default(false),
    /** Quantas vezes um turno tentou processar este item (>= 3: desiste, para não entrar em loop). */
    attempts: integer("attempts").notNull().default(0),
    /** Reserva temporária enquanto um turno processa; expira sozinha se o processo morrer no meio. */
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("whatsapp_inbox_phone_idx").on(t.phone, t.processed, t.receivedAt)],
);

/* ------------------------------------------------------------------ */
/* whatsapp_followups (retorno automático ao cliente)                  */
/* ------------------------------------------------------------------ */

export type WhatsAppFollowupKind = "REOPEN" | "ABANDONED_CHAT";
export type WhatsAppFollowupStatus = "PENDING" | "SENT" | "CANCELLED" | "SKIPPED";

/** Fila de mensagens ativas. Uma pendente por telefone; o cron envia quando a loja abre. */
export const whatsappFollowups = pgTable(
  "whatsapp_followups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull(),
    kind: text("kind").$type<WhatsAppFollowupKind>().notNull().default("REOPEN"),
    status: text("status").$type<WhatsAppFollowupStatus>().notNull().default("PENDING"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    /** Última mensagem do cliente: a janela de 24 h do texto livre conta a partir dela. */
    lastCustomerMessageAt: timestamp("last_customer_message_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** "template" ou "text" (como foi enviado) ou o motivo do cancelamento/descarte. */
    outcome: text("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("whatsapp_followups_due_idx").on(t.status, t.scheduledFor)],
);

/* ------------------------------------------------------------------ */
/* marketing (campanhas de remarketing)                                */
/* ------------------------------------------------------------------ */

/** Configuração das campanhas (uma linha por loja). Sem linha = padrões e campanhas desligadas. */
export const marketingSettings = pgTable("marketing_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  discountMinPercent: integer("discount_min_percent").notNull().default(5),
  discountMaxPercent: integer("discount_max_percent").notNull().default(15),
  /** Bônus (em pontos percentuais) somado ao sorteio para clientes fãs, limitado ao máximo. */
  fanBonusPercent: integer("fan_bonus_percent").notNull().default(5),
  couponValidHours: integer("coupon_valid_hours").notNull().default(48),
  couponMinOrderCents: integer("coupon_min_order_cents").notNull().default(0),
  /** Intervalo mínimo entre duas mensagens de marketing para o mesmo cliente. */
  minDaysBetween: integer("min_days_between").notNull().default(7),
  sendFromHour: integer("send_from_hour").notNull().default(10),
  sendUntilHour: integer("send_until_hour").notNull().default(21),
  targetAtRisk: boolean("target_at_risk").notNull().default(true),
  targetLost: boolean("target_lost").notNull().default(true),
  targetNew: boolean("target_new").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FunnelEventType = "VISIT" | "VIEW_PRODUCT" | "ADD_TO_CART" | "CHECKOUT";

/** Funil do cardápio (visitas anônimas, sem dados pessoais): o visitante é um id aleatório do navegador. */
export const funnelEvents = pgTable(
  "funnel_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    visitorId: text("visitor_id").notNull(),
    event: text("event").$type<FunnelEventType>().notNull(),
    productId: uuid("product_id"),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("funnel_events_tenant_idx").on(t.tenantId, t.createdAt)],
);

export type MarketingSendStatus = "SENT" | "SKIPPED" | "FAILED";

/** Registro de cada tentativa de campanha: limite por cliente, auditoria e atribuição (cupom -> pedido). */
export const marketingSends = pgTable(
  "marketing_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(),
    segment: text("segment").notNull(),
    isFan: boolean("is_fan").notNull().default(false),
    status: text("status").$type<MarketingSendStatus>().notNull(),
    /** "text" | "template" quando enviado; motivo quando não (ex.: WAITING_TEMPLATE, SEND_FAILED). */
    outcome: text("outcome"),
    couponId: uuid("coupon_id").references(() => coupons.id, { onDelete: "set null" }),
    discountPercent: integer("discount_percent"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("marketing_sends_customer_idx").on(t.customerId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* milhas (programa de fidelidade)                                     */
/* ------------------------------------------------------------------ */

/** Configuração do programa (uma linha por loja). Sem linha = padrões, programa DESLIGADO. */
export const milesSettings = pgTable("miles_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  /** Milhas ganhas por R$ 1,00 em itens (já com desconto de cupom, sem a taxa de entrega). */
  milesPerReal: integer("miles_per_real").notNull().default(10),
  /** Validade das milhas ganhas, em meses (0 = não expiram). */
  validityMonths: integer("validity_months").notNull().default(12),
  /** Validade renovável: dias após o último pedido pago (0 = desligado). */
  rollingValidityDays: integer("rolling_validity_days").notNull().default(45),
  tierWindowDays: integer("tier_window_days").notNull().default(90),
  executiveMinOrders: integer("executive_min_orders").notNull().default(4),
  executiveMultiplierPct: integer("executive_multiplier_pct").notNull().default(120),
  firstClassMinOrders: integer("first_class_min_orders").notNull().default(10),
  firstClassMultiplierPct: integer("first_class_multiplier_pct").notNull().default(150),
  /** Benefício mensal da Executiva e Primeira Classe: desconto (centavos) em pedidos acima do mínimo. 0 = desligado. */
  tierBenefitCents: integer("tier_benefit_cents").notNull().default(400),
  tierBenefitMinOrderCents: integer("tier_benefit_min_order_cents").notNull().default(5000),
  /** Benefício mensal da Primeira Classe: cupom de frete grátis. */
  firstClassFreeShipping: boolean("first_class_free_shipping").notNull().default(true),
  /** Validade do cupom gerado no resgate, em dias. */
  rewardCouponValidDays: integer("reward_coupon_valid_days").notNull().default(15),
  /** Milhas de boas-vindas, pagas uma vez por cliente no primeiro pedido pago (0 = sem bônus). */
  welcomeBonusMiles: integer("welcome_bonus_miles").notNull().default(150),
  /** Cashback livre: quantas milhas valem R$ 1,00 de desconto. */
  cashbackMilesPerReal: integer("cashback_miles_per_real").notNull().default(200),
  /** Cashback livre: mínimo de milhas por resgate. */
  cashbackMinMiles: integer("cashback_min_miles").notNull().default(500),
  /** Teto do desconto de cashback, em % do valor dos itens do pedido (0 = sem teto). */
  cashbackCapPercent: integer("cashback_cap_percent").notNull().default(30),
  /** Pedido mínimo (itens) para usar qualquer cupom gerado por milhas. */
  redeemMinOrderCents: integer("redeem_min_order_cents").notNull().default(3500),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Recompensas da "loja de milhas": X milhas viram um cupom de desconto pessoal. */
export const milesRewards = pgTable(
  "miles_rewards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    milesCost: integer("miles_cost").notNull(),
    /** Desconto em centavos, só sobre os itens. */
    discountCents: integer("discount_cents").notNull(),
    minOrderCents: integer("min_order_cents").notNull().default(0),
    /** Item grátis: se preenchido, a recompensa é 1 unidade deste produto (o desconto em R$ vira o preço dele). */
    freeProductId: uuid("free_product_id").references(() => products.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("miles_rewards_tenant_idx").on(t.tenantId)],
);

export type MilesEntryType = "EARN" | "REDEEM" | "REVERSAL" | "BONUS" | "ADJUST";

/** Extrato: todo crédito/débito de milhas. O saldo é calculado a partir daqui (nunca guardado). */
export const milesLedger = pgTable(
  "miles_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    type: text("type").$type<MilesEntryType>().notNull(),
    /** Positivo = crédito, negativo = débito. */
    miles: integer("miles").notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    rewardId: uuid("reward_id").references(() => milesRewards.id, { onDelete: "set null" }),
    couponId: uuid("coupon_id").references(() => coupons.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    /** Só nos créditos: depois desta data as milhas não valem mais. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("miles_ledger_customer_idx").on(t.customerId, t.createdAt)],
);

/** Missões ("Peça 3x no mês +300 milhas"): o progresso sai dos pedidos; o bônus cai uma vez por período. */
export const milesMissions = pgTable(
  "miles_missions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "WEEK" (segunda a domingo) ou "MONTH" (mês civil), no horário de Brasília. */
    period: text("period").$type<"WEEK" | "MONTH">().notNull(),
    targetOrders: integer("target_orders").notNull(),
    /** Só contam pedidos com itens (já com desconto) a partir deste valor. */
    minOrderCents: integer("min_order_cents").notNull().default(0),
    bonusMiles: integer("bonus_miles").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("miles_missions_tenant_idx").on(t.tenantId)],
);

/** Bônus já pago: a chave única (missão, cliente, período) impede pagar duas vezes. */
export const milesMissionAwards = pgTable(
  "miles_mission_awards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    missionId: uuid("mission_id")
      .notNull()
      .references(() => milesMissions.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("miles_mission_awards_uq").on(t.missionId, t.customerId, t.periodKey)],
);
