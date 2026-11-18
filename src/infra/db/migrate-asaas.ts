/**
 * Migração da integração Asaas (idempotente e aditiva).
 * Uso: npm run db:migrate-asaas
 *
 * - payment_method ganha CREDIT_CARD
 * - customers.asaas_customer_id, orders.idempotency_key (+ único por tenant)
 * - tabela payments (trilha de auditoria; sem PAN/CVV/validade)
 * - payment_events passa a aceitar eventos do Asaas (event_type, provider_payment_id, order_id opcional)
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida.");
  const sql = neon(url);

  await sql`ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'CREDIT_CARD'`;

  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS asaas_customer_id text`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key text`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS orders_tenant_idempotency_uq ON orders (tenant_id, idempotency_key)`;

  await sql`
    CREATE TABLE IF NOT EXISTS payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      provider text NOT NULL DEFAULT 'asaas',
      provider_payment_id text NOT NULL,
      provider_customer_id text NOT NULL,
      method text NOT NULL,
      amount_cents integer NOT NULL,
      status text NOT NULL DEFAULT 'PENDING',
      pix_payload text,
      pix_qr_code_base64 text,
      pix_expiration_date timestamptz,
      invoice_url text,
      paid_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_payment_uq ON payments (provider_payment_id)`;
  await sql`CREATE INDEX IF NOT EXISTS payments_order_idx ON payments (order_id)`;

  await sql`ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'UNKNOWN'`;
  await sql`ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS provider_payment_id text`;
  await sql`ALTER TABLE payment_events ALTER COLUMN order_id DROP NOT NULL`;
  await sql`ALTER TABLE payment_events ALTER COLUMN amount_cents DROP NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS payment_events_provider_payment_idx ON payment_events (provider_payment_id)`;

  console.log("asaas ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
