import { NextResponse } from "next/server";

import { checkAccountBody } from "@/core/schemas/auth";
import { fail, findCustomerByPhone, parseBody } from "@/infra/auth/account";
import { enforceRateLimit } from "@/infra/security/rate-limit";
import { getTenantRef } from "@/infra/tenant/resolve";

export const dynamic = "force-dynamic";

/**
 * Todo acesso valida o número por código (não existe senha). Aqui só se decide a ordem da tela:
 * número novo (ou nunca validado) informa nome + CPF antes do código; cliente conhecido vai direto ao código, mesmo com
 * o cadastro incompleto (ex.: nasceu pelo WhatsApp só com nome): depois do código a tela pede SÓ o que falta.
 * Nunca devolve o nome (só depois do código o cliente é chamado pelo nome).
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "auth:check-account", 8, 60);
  if (limited) return limited;

  const body = await parseBody(request, checkAccountBody);
  if (body.error) return body.error;

  const ref = await getTenantRef();
  if (!ref) return fail("Loja não encontrada.", 404);

  const customer = await findCustomerByPhone(ref.id, body.data.phone);
  const needsProfile = !customer || customer.phoneVerifiedAt === null;
  return NextResponse.json({ flow: "verify", needsProfile }, { headers: { "Cache-Control": "no-store" } });
}
