"use server";

import { getAuthSession } from "@/infra/auth/customer-session";
import { redeemReward } from "@/infra/miles/miles";
import { checkRateLimit } from "@/infra/security/rate-limit";

import { failure, success, type ActionResult } from "./result";

/** Troca milhas por um cupom de desconto pessoal. O cliente vem da sessão, nunca do formulário. */
export async function redeemMilesReward(
  rewardId: unknown,
): Promise<ActionResult<{ couponCode: string; discountCents: number }>> {
  const session = await getAuthSession();
  if (!session) return failure("Sessão expirada. Entre novamente.");
  if (typeof rewardId !== "string" || !/^[0-9a-f-]{36}$/i.test(rewardId)) return failure("Recompensa inválida.");

  const limit = await checkRateLimit({
    identifier: session.customerId,
    route: "miles-redeem",
    limit: 8,
    windowSeconds: 600,
    failClosed: true,
  });
  if (!limit.allowed) return failure("Muitas tentativas. Aguarde um pouco.");

  const result = await redeemReward(session.tenantId, session.customerId, rewardId);
  if (!result.ok) return failure(result.error);
  return success({ couponCode: result.couponCode, discountCents: result.discountCents });
}
