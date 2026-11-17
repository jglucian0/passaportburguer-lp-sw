"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";

import { getAdminStoreStatus, setStoreOpenOverride, type AdminStoreStatus } from "@/actions/admin";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const REFRESH_MS = 60_000;

/** Switch destacado "Loja Aberta / Loja Fechada" do cabeçalho do admin. */
export function StoreStatusSwitch() {
  const [status, setStatus] = useState<AdminStoreStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    try {
      const next = await getAdminStoreStatus();
      if (next) setStatus(next);
      setFailed(next === null);
    } catch {
      /* mantém o último estado conhecido */
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  function apply(isOpenOverride: boolean | null) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setStoreOpenOverride({ isOpenOverride });
        if (!result.ok) setError(result.error);
        await refresh();
      } catch {
        setError("Falha ao atualizar a loja.");
      }
    });
  }

  if (!status) {
    // Nunca some do cabeçalho: carregando mostra esqueleto; falhou, mostra "tentar de novo".
    return failed ? (
      <button
        type="button"
        onClick={() => void refresh()}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-400/15 px-3 text-sm font-bold text-amber-300 hover:bg-amber-400/25"
      >
        <RotateCcw className="h-4 w-4" /> Status da loja
      </button>
    ) : (
      <div className="h-9 w-44 animate-pulse rounded-full bg-white/10" aria-hidden />
    );
  }

  const { isOpen } = status;

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border px-3 py-1.5",
          isOpen ? "border-emerald-500/40 bg-emerald-500/15" : "border-red-500/40 bg-red-500/15",
        )}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <span className={cn("h-2.5 w-2.5 rounded-full", isOpen ? "bg-emerald-400" : "bg-red-400")} />
        )}
        <span className={cn("text-sm font-extrabold", isOpen ? "text-emerald-300" : "text-red-300")}>
          {isOpen ? "Loja Aberta" : "Loja Fechada"}
        </span>
        <Switch
          aria-label={isOpen ? "Fechar a loja" : "Abrir a loja"}
          checked={isOpen}
          disabled={isPending}
          onCheckedChange={(checked) => apply(checked)}
          className={cn(isOpen ? "data-[state=checked]:bg-emerald-500" : "bg-red-500/60")}
        />
      </div>
      {status.hasOverride ? (
        <button
          type="button"
          onClick={() => apply(null)}
          disabled={isPending}
          title="Voltar a seguir o horário de funcionamento"
          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Automático</span>
        </button>
      ) : null}
      {error ? <span className="text-xs text-red-400">{error}</span> : null}
    </div>
  );
}
