/**
 * Estorno/chargeback: colunas de conciliação em orders + tabela order_timeline_events (idempotente).
 * Uso: npm run db:migrate-financial-alerts
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida.");
  const sql = neon(url);

  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS financial_alert_type text`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS saipos_cancel_status text NOT NULL DEFAULT 'NOT_APPLICABLE'`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS reconciled_at timestamptz`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS reconciled_by text`;
  await sql`CREATE INDEX IF NOT EXISTS orders_tenant_saipos_cancel_idx ON orders (tenant_id, saipos_cancel_status)`;

  await sql`
    CREATE TABLE IF NOT EXISTS order_timeline_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      type text NOT NULL,
      title text NOT NULL,
      description text,
      metadata jsonb,
      dedupe_key text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS order_timeline_order_idx ON order_timeline_events (order_id, created_at)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS order_timeline_dedupe_uq ON order_timeline_events (dedupe_key)`;
  console.log("financial alerts ok.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
