/**
 * Cria o enum coupon_type e a tabela coupons (idempotente).
 * Uso: npm run db:migrate-coupons
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida.");
  const sql = neon(url);

  await sql`
    DO $$ BEGIN
      CREATE TYPE coupon_type AS ENUM ('PERCENT', 'FIXED');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
  await sql`
    CREATE TABLE IF NOT EXISTS coupons (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      code text NOT NULL,
      type coupon_type NOT NULL,
      value integer NOT NULL,
      min_order_cents integer NOT NULL DEFAULT 0,
      max_uses integer,
      used_count integer NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS coupons_tenant_code_uq ON coupons (tenant_id, code)`;
  /* Cupom aplicado ao pedido: validade, cupom pessoal (campanhas) e desconto gravado no pedido. */
  await sql`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS expires_at timestamptz`;
  await sql`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id uuid REFERENCES coupons(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code text`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_cents integer NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_consumed_at timestamptz`;
  console.log("coupons ok.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
