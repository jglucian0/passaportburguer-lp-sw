import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const base =
  "w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, "min-h-20 py-2", className)} {...props} />;
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
      {error ? <span className="block text-xs text-red-400">{error}</span> : null}
    </label>
  );
}
