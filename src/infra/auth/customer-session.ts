import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

import { db } from "@/infra/db";
import { customers, sessions } from "@/infra/db/schema";
import { getClientIp } from "@/infra/security/rate-limit";
import { getTenantRef } from "@/infra/tenant/resolve";

export const CUSTOMER_COOKIE = "customer_token";
/** 30 dias. A sessão vive no cookie HttpOnly emitido pelo servidor (Set-Cookie), nunca em document.cookie (o ITP do Safari apagaria em 7 dias). */
export const CUSTOMER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const SESSION_TTL_SECONDS = CUSTOMER_SESSION_TTL_SECONDS;

export type AuthSession = {
  sessionId: string;
  customerId: string;
  tenantId: string;
  phone: string;
  name: string;
};

export class UnauthorizedError extends Error {
  constructor() {
    super("Não autorizado.");
  }
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function customerCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

/** Cria a sessão no banco (só o hash do token) e grava o token no cookie. */
export async function createCustomerSession(customerId: string): Promise<void> {
  const h = await headers();
  const token = randomBytes(32).toString("hex");
  const now = new Date();

  /* Higiene: sessões deste cliente já vencidas somem. */
  await db.delete(sessions).where(and(eq(sessions.userId, customerId), lt(sessions.expiresAt, now)));
  await db.insert(sessions).values({
    userId: customerId,
    tokenHash: hashToken(token),
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    ipAddress: getClientIp(h),
    expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000),
  });

  (await cookies()).set(CUSTOMER_COOKIE, token, customerCookieOptions(SESSION_TTL_SECONDS));
}

/** Sessão válida (existe, não expirou, não foi revogada, é desta loja) ou null. */
export async function getAuthSession(): Promise<AuthSession | null> {
  const token = (await cookies()).get(CUSTOMER_COOKIE)?.value;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;

  const ref = await getTenantRef();
  if (!ref) return null;

  const [row] = await db
    .select({
      sessionId: sessions.id,
      customerId: customers.id,
      tenantId: customers.tenantId,
      phone: customers.phone,
      name: customers.name,
    })
    .from(sessions)
    .innerJoin(customers, eq(customers.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
        isNull(sessions.revokedAt),
        eq(customers.tenantId, ref.id),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** Guarda central das rotas/ações privadas do cliente: lança `UnauthorizedError` sem sessão válida. */
export async function requireAuthSession(): Promise<AuthSession> {
  const session = await getAuthSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
}

/** Revoga a sessão atual (se houver) e apaga o cookie. */
export async function revokeCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(CUSTOMER_COOKIE)?.value;
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
  }
  jar.set(CUSTOMER_COOKIE, "", customerCookieOptions(0));
}

/** Encerra todas as sessões ativas do cliente (ex.: após redefinir a senha). */
export async function revokeAllSessions(customerId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, customerId), isNull(sessions.revokedAt)));
}
