import { NextResponse } from "next/server";

import { checkAccountBody } from "@/core/schemas/auth";
import { fail, findCustomerByPhone, isRegistered, parseBody } from "@/infra/auth/account";
import { enforceRateLimit } from "@/infra/security/rate-limit";
import { getTenantRef } from "@/infra/tenant/resolve";

export const dynamic = "force-dynamic";

/** Cenário A ("password"): conta verificada → só senha. Cenário B ("verify"): valida o WhatsApp uma vez. */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "auth:check-account", 8, 60);
  if (limited) return limited;

  const body = await parseBody(request, checkAccountBody);
  if (body.error) return body.error;

  const ref = await getTenantRef();
  if (!ref) return fail("Loja não encontrada.", 404);

  const customer = await findCustomerByPhone(ref.id, body.data.phone);
  return NextResponse.json(
    { flow: customer && isRegistered(customer) ? "password" : "verify" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
