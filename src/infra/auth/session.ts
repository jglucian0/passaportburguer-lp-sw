import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";

import type { AdminRole } from "@/core/schemas/common";

export const ADMIN_COOKIE = "admin_token";

const ADMIN_TTL_SECONDS = 60 * 60 * 12; // 12h

export type AdminSession = {
  userId: string;
  tenantId: string;
  name: string;
  role: AdminRole;
};

/** Papéis operacionais autorizados a entrar em /admin e /api/admin. */
export function isOperationalRole(role: unknown): role is AdminRole {
  return role === "OWNER" || role === "KITCHEN";
}

type TokenKind = "admin";

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET ausente ou com menos de 32 caracteres.");
  }
  return new TextEncoder().encode(secret);
}

async function sign(
  kind: TokenKind,
  subject: string,
  claims: Record<string, unknown>,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({ ...claims, kind })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(getSecret());
}

async function verify(kind: TokenKind, token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    if (payload.kind !== kind || typeof payload.sub !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

/* ------------------------------ Admin ------------------------------ */

export function signAdminToken(session: AdminSession): Promise<string> {
  return sign(
    "admin",
    session.userId,
    { tenantId: session.tenantId, name: session.name, role: session.role },
    ADMIN_TTL_SECONDS,
  );
}

export async function verifyAdminToken(token: string | undefined): Promise<AdminSession | null> {
  const payload = await verify("admin", token);
  if (!payload) return null;
  if (
    typeof payload.tenantId !== "string" ||
    typeof payload.name !== "string" ||
    !isOperationalRole(payload.role)
  ) {
    return null;
  }
  return {
    userId: payload.sub as string,
    tenantId: payload.tenantId,
    name: payload.name,
    role: payload.role,
  };
}

/* ------------------------- Cookies (server) ------------------------ */

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function setAdminSessionCookie(session: AdminSession): Promise<void> {
  const token = await signAdminToken(session);
  (await cookies()).set(ADMIN_COOKIE, token, cookieOptions(ADMIN_TTL_SECONDS));
}

export async function clearAdminSessionCookie(): Promise<void> {
  (await cookies()).set(ADMIN_COOKIE, "", cookieOptions(0));
}

export async function getAdminSession(): Promise<AdminSession | null> {
  return verifyAdminToken((await cookies()).get(ADMIN_COOKIE)?.value);
}



