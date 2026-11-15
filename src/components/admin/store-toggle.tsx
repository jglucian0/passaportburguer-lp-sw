"use client";

import { DoorClosed, DoorOpen, Loader2 } from "lucide-react";

import { setStoreManuallyClosed } from "@/actions/admin";
import { Button } from "@/components/ui/button";

import { useRunAction } from "./use-run-action";

/** Botão "Fechar Loja Agora" / "Reabrir loja". */
export function StoreToggle({ isManuallyClosed }: { isManuallyClosed: boolean }) {
  const { run, isPending, error } = useRunAction();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant={isManuallyClosed ? "primary" : "danger"}
        size="sm"
        disabled={isPending}
        onClick={() => run(() => setStoreManuallyClosed({ isManuallyClosed: !isManuallyClosed }))}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isManuallyClosed ? (
          <DoorOpen className="h-4 w-4" />
        ) : (
          <DoorClosed className="h-4 w-4" />
        )}
        {isManuallyClosed ? "Reabrir loja" : "Fechar loja agora"}
      </Button>
      {error ? <span className="text-xs text-red-400">{error}</span> : null}
    </div>
  );
}
