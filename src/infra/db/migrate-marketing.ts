/**
 * Tabelas das campanhas de remarketing (idempotente). Rode antes: npm run db:migrate-coupons
 * Uso: npm run db:migrate-marketing
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida.");
  const sql = neon(url);

  await sql`
    CREATE TABLE IF NOT EXISTS marketing_settings (
      tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      enabled boolean NOT NULL DEFAULT false,
      discount_min_percent integer NOT NULL DEFAULT 5,
      discount_max_percent integer NOT NULL DEFAULT 15,
      fan_bonus_percent integer NOT NULL DEFAULT 5,
      coupon_valid_hours integer NOT NULL DEFAULT 48,
      coupon_min_order_cents integer NOT NULL DEFAULT 0,
      min_days_between integer NOT NULL DEFAULT 7,
      send_from_hour integer NOT NULL DEFAULT 10,
      send_until_hour integer NOT NULL DEFAULT 21,
      target_at_risk boolean NOT NULL DEFAULT true,
      target_lost boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS attribution jsonb`;
  await sql`ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS ad_referral jsonb`;
  await sql`
    CREATE TABLE IF NOT EXISTS marketing_sends (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      phone text NOT NULL,
      segment text NOT NULL,
      is_fan boolean NOT NULL DEFAULT false,
      status text NOT NULL,
      outcome text,
      coupon_id uuid REFERENCES coupons(id) ON DELETE SET NULL,
      discount_percent integer,
      sent_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS marketing_sends_customer_idx ON marketing_sends (customer_id, created_at)`;
  console.log("marketing ok.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
