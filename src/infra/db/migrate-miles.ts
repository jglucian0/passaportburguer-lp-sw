/**
 * Programa de milhas (idempotente). Rode antes: npm run db:migrate-coupons
 * Uso: npm run db:migrate-miles
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida.");
  const sql = neon(url);

  await sql`
    CREATE TABLE IF NOT EXISTS miles_settings (
      tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      enabled boolean NOT NULL DEFAULT false,
      miles_per_real integer NOT NULL DEFAULT 5,
      validity_months integer NOT NULL DEFAULT 12,
      reward_coupon_valid_days integer NOT NULL DEFAULT 15,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS miles_rewards (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name text NOT NULL,
      miles_cost integer NOT NULL,
      discount_cents integer NOT NULL,
      min_order_cents integer NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS miles_rewards_tenant_idx ON miles_rewards (tenant_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS miles_ledger (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      type text NOT NULL,
      miles integer NOT NULL,
      order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
      reward_id uuid REFERENCES miles_rewards(id) ON DELETE SET NULL,
      coupon_id uuid REFERENCES coupons(id) ON DELETE SET NULL,
      description text NOT NULL,
      expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS miles_ledger_customer_idx ON miles_ledger (customer_id, created_at)`;
  // Crédito e estorno de um pedido acontecem no máximo uma vez (idempotência do webhook/duplo clique).
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS miles_ledger_order_type_uq ON miles_ledger (order_id, type) WHERE order_id IS NOT NULL AND type IN ('EARN','REVERSAL')`;
  await sql`
    CREATE TABLE IF NOT EXISTS miles_missions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name text NOT NULL,
      period text NOT NULL,
      target_orders integer NOT NULL,
      min_order_cents integer NOT NULL DEFAULT 0,
      bonus_miles integer NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS miles_missions_tenant_idx ON miles_missions (tenant_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS miles_mission_awards (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      mission_id uuid NOT NULL REFERENCES miles_missions(id) ON DELETE CASCADE,
      customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      period_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS miles_mission_awards_uq ON miles_mission_awards (mission_id, customer_id, period_key)`;
  // Regras de resgate/cashback e bônus de boas-vindas.
  await sql`ALTER TABLE miles_settings ADD COLUMN IF NOT EXISTS welcome_bonus_miles integer NOT NULL DEFAULT 150`;
  await sql`ALTER TABLE miles_settings ADD COLUMN IF NOT EXISTS cashback_miles_per_real integer NOT NULL DEFAULT 200`;
  await sql`ALTER TABLE miles_settings ADD COLUMN IF NOT EXISTS cashback_min_miles integer NOT NULL DEFAULT 500`;
  await sql`ALTER TABLE miles_settings ADD COLUMN IF NOT EXISTS cashback_cap_percent integer NOT NULL DEFAULT 30`;
  await sql`ALTER TABLE miles_settings ADD COLUMN IF NOT EXISTS redeem_min_order_cents integer NOT NULL DEFAULT 3500`;
  await sql`ALTER TABLE miles_settings ADD COLUMN IF NOT EXISTS rolling_validity_days integer NOT NULL DEFAULT 45`;
  await sql`ALTER TABLE miles_settings ADD COLUMN IF NOT EXISTS tier_window_days integer NOT NULL DEFAULT 90`;
  await sql`ALTER TABLE miles_settings ADD COLUMN IF NOT EXISTS executive_min_orders integer NOT NULL DEFAULT 4`;
  await sql`ALTER TABLE miles_settings ADD COLUMN IF NOT EXISTS executive_multiplier_pct integer NOT NULL DEFAULT 120`;
  await sql`ALTER TABLE miles_settings ADD COLUMN IF NOT EXISTS first_class_min_orders integer NOT NULL DEFAULT 10`;
  await sql`ALTER TABLE miles_settings ADD COLUMN IF NOT EXISTS first_class_multiplier_pct integer NOT NULL DEFAULT 150`;
  await sql`ALTER TABLE miles_settings ADD COLUMN IF NOT EXISTS tier_benefit_cents integer NOT NULL DEFAULT 400`;
  await sql`ALTER TABLE miles_settings ADD COLUMN IF NOT EXISTS tier_benefit_min_order_cents integer NOT NULL DEFAULT 5000`;
  await sql`ALTER TABLE miles_settings ADD COLUMN IF NOT EXISTS first_class_free_shipping boolean NOT NULL DEFAULT true`;
  await sql`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS free_shipping boolean NOT NULL DEFAULT false`;
  await sql`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS max_discount_percent integer`;
  await sql`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS free_product_id uuid REFERENCES products(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE miles_rewards ADD COLUMN IF NOT EXISTS free_product_id uuid REFERENCES products(id) ON DELETE SET NULL`;
  // O bônus de boas-vindas é pago no máximo uma vez por cliente.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS miles_ledger_welcome_uq ON miles_ledger (customer_id) WHERE type = 'BONUS' AND description = 'Bônus de boas-vindas'`;
  console.log("miles ok.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
