/**
 * Cria a tabela store_settings (idempotente) e copia horário/fechamento manual de cada tenant.
 * Uso: npm run db:migrate-settings
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida.");
  const sql = neon(url);

  await sql`
    CREATE TABLE IF NOT EXISTS store_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      is_open_override boolean,
      auto_accept_orders boolean NOT NULL DEFAULT false,
      estimated_delivery_minutes integer NOT NULL DEFAULT 40,
      opening_hours jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS store_settings_tenant_uq ON store_settings (tenant_id)`;

  const inserted = await sql`
    INSERT INTO store_settings (tenant_id, is_open_override, opening_hours)
    SELECT id, CASE WHEN is_manually_closed THEN false ELSE NULL END, opening_hours FROM tenants
    ON CONFLICT (tenant_id) DO NOTHING
    RETURNING tenant_id`;
  console.log(`store_settings ok (${inserted.length} registro(s) criado(s)).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
