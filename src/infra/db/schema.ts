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

export const paymentMethodEnum = pgEnum("payment_method", ["PIX", "CARD_ON_DELIVERY", "CASH"]);

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
    totalCents: integer("total_cents").notNull(),
    notes: text("notes"),
    /** CPF (11) ou CNPJ (14) na nota fiscal, só dígitos. Opcional. */
    documentNumber: text("document_number"),
    cancelReason: text("cancel_reason"),
    /** Integração Saipos: id do pedido no Saipos, estado do envio e último erro. */
    saiposOrderId: text("saipos_order_id"),
    saiposSyncStatus: text("saipos_sync_status")
      .$type<SaiposSyncStatus>()
      .notNull()
      .default("PENDING"),
    saiposLastError: text("saipos_last_error"),
    saiposSyncedAt: timestamp("saipos_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("orders_tenant_idx").on(t.tenantId),
    uniqueIndex("orders_tenant_number_uq").on(t.tenantId, t.orderNumber),
    index("orders_tenant_status_idx").on(t.tenantId, t.status),
    index("orders_tenant_updated_idx").on(t.tenantId, t.updatedAt),
    index("orders_saipos_order_idx").on(t.saiposOrderId),
    index("orders_customer_idx").on(t.customerId, t.createdAt),
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
/* payment_events (idempotência de webhooks de pagamento)              */
/* ------------------------------------------------------------------ */

export const paymentEvents = pgTable(
  "payment_events",
  {
    /** ID único do evento/transação enviado pelo gateway. */
    eventId: text("event_id").primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payment_events_order_idx").on(t.orderId)],
);
