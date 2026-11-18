import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_COOKIE, verifyAdminToken } from "@/infra/auth/session";

const ADMIN_LOGIN_PATH = "/admin/login";

function isProtectedApi(pathname: string): boolean {
  return pathname.startsWith("/api/admin/") || pathname.startsWith("/api/upload/");
}

function isAdminPage(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Webhooks são servidor-a-servidor (sem Origin) e se autenticam por assinatura/segredo. */
function skipsCsrfCheck(pathname: string): boolean {
  return pathname.startsWith("/api/webhooks/");
}

/** CSRF: em métodos que alteram estado, o Origin tem de ser o próprio host. */
function isSameOrigin(request: NextRequest): boolean {
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").toLowerCase();
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host.toLowerCase() === host;
    } catch {
      return false;
    }
  }
  /* Sem Origin: só vale se o navegador declara requisição do mesmo site. */
  const site = request.headers.get("sec-fetch-site");
  return site === "same-origin" || site === "none";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/api/") &&
    UNSAFE_METHODS.has(request.method) &&
    !skipsCsrfCheck(pathname) &&
    !isSameOrigin(request)
  ) {
    return NextResponse.json({ error: "Origem não permitida." }, { status: 403 });
  }

  /* Resolução de tenant: host (domínio customizado) + slug padrão do ambiente.
     A consulta ao banco ocorre nas camadas seguintes (cache), nunca no edge. */
  const headers = new Headers(request.headers);
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "")
    .split(":")[0]
    .toLowerCase();
  headers.set("x-tenant-host", host);
  headers.set("x-tenant-slug", process.env.DEFAULT_TENANT_SLUG ?? "passaporteburguer");
  headers.delete("x-tenant-id");

  const needsAuth =
    (isAdminPage(pathname) && pathname !== ADMIN_LOGIN_PATH) || isProtectedApi(pathname);
  const isLogin = pathname === ADMIN_LOGIN_PATH;

  if (needsAuth || isLogin) {
    const session = await verifyAdminToken(request.cookies.get(ADMIN_COOKIE)?.value);

    if (needsAuth && !session) {
      if (isProtectedApi(pathname)) {
        return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
      }
      const loginUrl = new URL(ADMIN_LOGIN_PATH, request.url);
      return NextResponse.redirect(loginUrl);
    }

    if (isLogin && session) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }

    if (session) {
      headers.set("x-tenant-id", session.tenantId);
      headers.set("x-admin-user-id", session.userId);
      headers.set("x-admin-role", session.role);
    }
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)"],
};
