/**
 * Tabelas do bot de WhatsApp (idempotente).
 * Uso: npm run db:migrate-whatsapp
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida.");
  const sql = neon(url);

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions (
      phone text PRIMARY KEY,
      customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
      state text NOT NULL DEFAULT 'GREETING',
      draft_cart jsonb,
      delivery_address jsonb,
      bot_paused_until timestamptz,
      last_interaction_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS whatsapp_sessions_customer_idx ON whatsapp_sessions (customer_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      wamid text UNIQUE,
      phone text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      media_type text NOT NULL DEFAULT 'text',
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS whatsapp_messages_phone_idx ON whatsapp_messages (phone, created_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_inbox_buffer (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      phone text NOT NULL,
      wamid text NOT NULL UNIQUE,
      payload jsonb NOT NULL,
      processed boolean NOT NULL DEFAULT false,
      received_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS whatsapp_inbox_phone_idx ON whatsapp_inbox_buffer (phone, processed, received_at)`;
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS document_number text`;
  await sql`ALTER TABLE whatsapp_inbox_buffer ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE whatsapp_inbox_buffer ADD COLUMN IF NOT EXISTS locked_until timestamptz`;
  console.log("whatsapp ok.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
