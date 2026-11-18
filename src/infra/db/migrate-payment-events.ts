/**
 * Cria a tabela payment_events (idempotente).
 * Uso: npm run db:migrate-payment-events
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida.");
  const sql = neon(url);

  await sql`
    CREATE TABLE IF NOT EXISTS payment_events (
      event_id text PRIMARY KEY,
      order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      amount_cents integer NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS payment_events_order_idx ON payment_events (order_id)`;
  console.log("payment_events ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
