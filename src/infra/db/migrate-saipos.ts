/**
 * Colunas da integração Saipos (idempotente).
 * Pedidos já existentes ficam como DISABLED (nunca serão enviados retroativamente).
 * Uso: npm run db:migrate-saipos
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida.");
  const sql = neon(url);

  const [existing] = await sql`
    SELECT 1 AS found FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'saipos_sync_status'`;

  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS saipos_order_id text`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS saipos_sync_status text NOT NULL DEFAULT 'PENDING'`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS saipos_last_error text`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS saipos_synced_at timestamptz`;
  if (!existing) {
    await sql`UPDATE orders SET saipos_sync_status = 'DISABLED'`;
  }
  await sql`CREATE INDEX IF NOT EXISTS orders_saipos_order_idx ON orders (saipos_order_id)`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS saipos_code text`;
  await sql`ALTER TABLE addons ADD COLUMN IF NOT EXISTS saipos_code text`;
  console.log("saipos ok.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
