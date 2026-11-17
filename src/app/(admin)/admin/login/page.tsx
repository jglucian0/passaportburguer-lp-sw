import type { Metadata } from "next";

import { LoginForm } from "@/components/admin/login-form";

export const metadata: Metadata = { title: "Entrar | Admin", robots: { index: false, follow: false } };

/** Grade sutil estilo mapa (linhas finas + pontos) sobre o Azul Noturno. */
const GRID_BG: React.CSSProperties = {
  backgroundImage: [
    "radial-gradient(circle at 50% 0%, rgba(245,158,11,0.10), transparent 55%)",
    "linear-gradient(rgba(148,163,184,0.07) 1px, transparent 1px)",
    "linear-gradient(90deg, rgba(148,163,184,0.07) 1px, transparent 1px)",
  ].join(","),
  backgroundSize: "100% 100%, 44px 44px, 44px 44px",
};

export default function AdminLoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#071329] p-4" style={GRID_BG}>
      <LoginForm />
    </main>
  );
}
