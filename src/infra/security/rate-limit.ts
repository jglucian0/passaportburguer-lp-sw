import { lt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/infra/db";
import { rateLimits } from "@/infra/db/schema";

type HeaderReader = { get(name: string): string | null };

/** IP real do cliente na Vercel (primeiro item do x-forwarded-for). */
export function getClientIp(headers: HeaderReader): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown"
  );
}

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

/**
 * Janela fixa persistente (Postgres), segura para serverless: um único UPSERT atômico
 * incrementa o contador, ou reinicia a janela quando ela já expirou.
 * Se o banco falhar, libera a requisição (e loga) para não derrubar o site junto.
 */
export async function checkRateLimit(opts: {
  identifier: string;
  route: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const key = `${opts.route}:${opts.identifier}`;
  const windowMs = opts.windowSeconds * 1000;
  const freshReset = new Date(Date.now() + windowMs);

  try {
    const [row] = await db
      .insert(rateLimits)
      .values({ key, count: 1, resetAt: freshReset })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`CASE WHEN ${rateLimits.resetAt} <= now() THEN 1 ELSE ${rateLimits.count} + 1 END`,
          resetAt: sql`CASE WHEN ${rateLimits.resetAt} <= now() THEN ${freshReset.toISOString()}::timestamptz ELSE ${rateLimits.resetAt} END`,
        },
      })
      .returning({ count: rateLimits.count, resetAt: rateLimits.resetAt });

    /* Limpeza oportunista (~2% das chamadas) dos registros já expirados. */
    if (Math.random() < 0.02) {
      void db
        .delete(rateLimits)
        .where(lt(rateLimits.resetAt, new Date()))
        .catch(() => undefined);
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((row.resetAt.getTime() - Date.now()) / 1000));
    return {
      allowed: row.count <= opts.limit,
      remaining: Math.max(0, opts.limit - row.count),
      retryAfterSeconds,
    };
  } catch (error) {
    console.error("[rate-limit] falha ao consultar o banco:", error);
    return { allowed: true, remaining: opts.limit, retryAfterSeconds: 0 };
  }
}

export function tooManyRequests(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "Muitas tentativas. Aguarde um pouco e tente novamente." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" } },
  );
}

/** Para API Routes: devolve a resposta 429 (ou null se a requisição pode seguir). */
export async function enforceRateLimit(
  request: Request,
  route: string,
  limit: number,
  windowSeconds: number,
): Promise<NextResponse | null> {
  const result = await checkRateLimit({
    identifier: getClientIp(request.headers),
    route,
    limit,
    windowSeconds,
  });
  return result.allowed ? null : tooManyRequests(result.retryAfterSeconds);
}
