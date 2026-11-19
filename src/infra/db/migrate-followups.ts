/**
 * Fila de retorno automático do WhatsApp + opt-out de marketing (idempotente).
 * Uso: npm run db:migrate-followups
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida.");
  const sql = neon(url);

  await sql`ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS marketing_opt_out_at timestamptz`;
  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_followups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      phone text NOT NULL,
      kind text NOT NULL DEFAULT 'REOPEN',
      status text NOT NULL DEFAULT 'PENDING',
      scheduled_for timestamptz NOT NULL,
      last_customer_message_at timestamptz NOT NULL,
      sent_at timestamptz,
      outcome text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS whatsapp_followups_due_idx ON whatsapp_followups (status, scheduled_for)`;
  // No máximo um retorno pendente por telefone.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_followups_pending_uq ON whatsapp_followups (phone) WHERE status = 'PENDING'`;
  console.log("followups ok.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
