"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { ActionFailure, ActionResult } from "@/actions/result";

export function actionErrorMessage(result: ActionFailure): string {
  const fieldMessage = Object.values(result.fieldErrors ?? {})
    .flat()
    .filter(Boolean)[0];
  return fieldMessage ? `${result.error} ${fieldMessage}` : result.error;
}

/** Executa uma Server Action, controla pending/erro e revalida a tela (router.refresh) em sucesso. */
export function useRunAction() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run<T>(action: () => Promise<ActionResult<T>>, onSuccess?: (data: T) => void) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(actionErrorMessage(result));
          return;
        }
        onSuccess?.(result.data);
        router.refresh();
      } catch {
        setError("Não foi possível concluir a ação. Tente novamente.");
      }
    });
  }

  return { run, isPending, error, setError };
}
