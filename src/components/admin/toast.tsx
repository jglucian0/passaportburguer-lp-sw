"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect } from "react";

export type ToastState = { kind: "success" | "error"; message: string } | null;

/** Aviso flutuante simples; some sozinho após 4s. */
export function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;
  const ok = toast.kind === "success";
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed right-4 top-20 z-50 flex max-w-sm items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg ${
        ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      {ok ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <XCircle className="h-5 w-5 shrink-0" />}
      {toast.message}
    </div>
  );
}
