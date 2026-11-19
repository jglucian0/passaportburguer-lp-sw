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
  console.log("miles ok.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
