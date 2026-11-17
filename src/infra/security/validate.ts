import { NextResponse } from "next/server";
import type { z } from "zod";

/** Valida a query string com um schema Zod `.strict()`. Inválida → resposta 400 pronta. */
export function parseQuery<S extends z.ZodTypeAny>(
  searchParams: URLSearchParams,
  schema: S,
): { data: z.infer<S>; error?: undefined } | { data?: undefined; error: NextResponse } {
  const raw: Record<string, string> = {};
  for (const [key, value] of searchParams) raw[key] = value;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: NextResponse.json(
        { error: "Parâmetros inválidos." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  return { data: parsed.data };
}
