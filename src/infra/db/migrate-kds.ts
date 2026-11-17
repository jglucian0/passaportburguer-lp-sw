/**
 * Migração do KDS (idempotente):
 *  - admin_role: renomeia STAFF -> KITCHEN (linhas existentes são preservadas) e o default passa a KITCHEN;
 *  - order_status: adiciona READY_FOR_PICKUP (retirada pronta).
 *
 * Uso: npm run db:migrate-kds
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida.");
  const sql = neon(url);

  const [staff] = await sql`
    SELECT 1 AS found FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'admin_role' AND e.enumlabel = 'STAFF'`;
  if (staff) {
    await sql`ALTER TYPE admin_role RENAME VALUE 'STAFF' TO 'KITCHEN'`;
    console.log("admin_role: STAFF -> KITCHEN");
  } else {
    console.log("admin_role: já migrado");
  }
  await sql`ALTER TABLE admin_users ALTER COLUMN role SET DEFAULT 'KITCHEN'`;

  await sql`ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'READY_FOR_PICKUP' BEFORE 'DELIVERED'`;
  console.log("order_status: READY_FOR_PICKUP ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
