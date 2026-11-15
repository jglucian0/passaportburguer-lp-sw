"use client";

import { Loader2, Stamp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { lookupOrdersByPhone } from "@/actions/storefront";
import { Input } from "@/components/ui/input";
import { formatPhone } from "@/lib/utils";

import { CUSTOMER_PREFILL_KEY } from "./cart-storage";

function readSavedPhone(): string {
  try {
    const raw = window.localStorage.getItem(CUSTOMER_PREFILL_KEY);
    if (!raw) return "";
    const saved = JSON.parse(raw) as { phone?: string };
    return saved.phone ? formatPhone(saved.phone) : "";
  } catch {
    return "";
  }
}

function savePhone(phone: string): void {
  try {
    const raw = window.localStorage.getItem(CUSTOMER_PREFILL_KEY);
    const saved = raw ? (JSON.parse(raw) as { name?: string; phone?: string }) : {};
    window.localStorage.setItem(CUSTOMER_PREFILL_KEY, JSON.stringify({ ...saved, phone }));
  } catch {
    /* armazenamento indisponível: o cliente digita de novo na próxima vez */
  }
}

export function PhoneLookup() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const autoTried = useRef(false);

  function search(value: string, silent: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await lookupOrdersByPhone({ phone: value });
      if (result.ok) {
        savePhone(value);
        router.refresh();
      } else if (!silent) {
        const fieldMessage = Object.values(result.fieldErrors ?? {}).flat().filter(Boolean)[0];
        setError(fieldMessage ?? result.error);
      }
    });
  }

  /* Telefone salvo (busca anterior ou checkout): carrega o histórico sem redigitar. */
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    const saved = readSavedPhone();
    if (!saved) return;
    setPhone(saved);
    search(saved, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    search(phone, false);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="relative space-y-4 overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      {/* Carimbo postal decorativo */}
      <Stamp
        aria-hidden="true"
        className="pointer-events-none absolute -right-2 -top-2 h-20 w-20 rotate-12 text-slate-200"
        strokeWidth={1.25}
      />

      <div className="relative">
        <h2 className="text-lg font-extrabold text-[#0A2540]">Acompanhe seus pedidos</h2>
        <p className="mt-1 text-sm text-slate-500">Informe o WhatsApp usado no pedido.</p>
      </div>

      <label className="relative block space-y-1.5">
        <span className="text-sm font-medium text-slate-700">WhatsApp</span>
        <Input
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(formatPhone(e.target.value))}
          placeholder="(99) 99999-9999"
          required
          className="h-12 rounded-xl border-slate-300 bg-white text-base text-slate-900 placeholder:text-slate-400 focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/30"
        />
      </label>

      {error ? (
        <p className="relative rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="relative flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#F59E0B] text-base font-bold text-[#0A2540] transition hover:brightness-105 disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Buscar pedidos
      </button>
    </form>
  );
}
