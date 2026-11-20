import { describe, expect, it, vi } from "vitest";

vi.mock("@/infra/db", () => ({ db: {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({}), headers: async () => ({}) }));

import { CUSTOMER_SESSION_TTL_SECONDS, customerCookieOptions } from "./customer-session";

describe("cookie de sessão do cliente (30 dias, só via Set-Cookie do servidor)", () => {
  it("dura 30 dias (2592000 s)", () => {
    expect(CUSTOMER_SESSION_TTL_SECONDS).toBe(2_592_000);
  });

  it("HttpOnly, SameSite=Lax, Path=/ e Max-Age de 30 dias", () => {
    expect(customerCookieOptions(CUSTOMER_SESSION_TTL_SECONDS)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 2_592_000,
    });
  });

  it("Secure em produção, e só em produção", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(customerCookieOptions(1).secure).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(customerCookieOptions(1).secure).toBe(false);
    vi.unstubAllEnvs();
  });

  it("logout expira o cookie (Max-Age 0)", () => {
    expect(customerCookieOptions(0).maxAge).toBe(0);
  });
});
