import type { Metadata } from "next";

import { LoginForm } from "@/components/admin/login-form";

export const metadata: Metadata = { title: "Entrar | Admin", robots: { index: false, follow: false } };

export default function AdminLoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <LoginForm />
    </main>
  );
}
