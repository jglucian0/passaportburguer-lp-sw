/**
 * Migração (idempotente): regras de entrega por raio, endereço da loja e ativação de operadores.
 * Uso: npm run db:migrate-delivery
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida.");
  const sql = neon(url);

  await sql`ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS address text`;
  await sql`ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS delivery_rules jsonb`;
  await sql`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true`;
  console.log("store_settings.address, store_settings.delivery_rules e admin_users.is_active ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
