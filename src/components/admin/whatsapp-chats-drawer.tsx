"use client";

import { Bot, Headset, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  listWhatsAppChats,
  resumeWhatsAppBot,
  takeOverWhatsAppChat,
  type WhatsAppChatView,
} from "@/actions/whatsapp-admin";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { actionErrorMessage } from "./use-run-action";

const STATE_LABELS: Record<WhatsAppChatView["state"], string> = {
  GREETING: "Saudação",
  BROWSING: "Escolhendo",
  CONFIRMING_ORDER: "Confirmando pedido",
  AWAITING_PAYMENT: "Aguardando pagamento",
  COMPLETED: "Concluído",
};

const STATE_STYLES: Record<WhatsAppChatView["state"], string> = {
  GREETING: "bg-slate-100 text-slate-700",
  BROWSING: "bg-sky-100 text-sky-800",
  CONFIRMING_ORDER: "bg-amber-100 text-amber-800",
  AWAITING_PAYMENT: "bg-orange-100 text-orange-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
};

/** 5543999999999 -> +55 (43) 99999-9999 */
export function formatWhatsAppPhone(phone: string): string {
  const m = phone.match(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+${m[1]} (${m[2]}) ${m[3]}-${m[4]}` : `+${phone}`;
}

function minutesLeft(iso: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 60_000));
}

function sinceLabel(iso: string, now: number): string {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  return `há ${Math.floor(min / 60)} h`;
}

/** Gaveta "Atendimentos WhatsApp": assumir a conversa (pausa a IA por 30 min) ou reativar a IA. */
export function WhatsAppChatsDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [chats, setChats] = useState<WhatsAppChatView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const result = await listWhatsAppChats();
      if (!result.ok) {
        setError(actionErrorMessage(result));
        return;
      }
      setError(null);
      setChats(result.data);
      setNow(Date.now());
    } catch {
      setError("Não foi possível carregar as conversas.");
    }
  }, []);

  // Atualiza enquanto a gaveta está aberta e a aba visível.
  useEffect(() => {
    if (!open) return;
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 10_000);
    return () => window.clearInterval(id);
  }, [open, load]);

  async function toggle(chat: WhatsAppChatView) {
    setBusy(chat.phone);
    setError(null);
    try {
      const result = chat.botPausedUntil
        ? await resumeWhatsAppBot({ phone: chat.phone })
        : await takeOverWhatsAppChat({ phone: chat.phone });
      if (!result.ok) setError(actionErrorMessage(result));
      await load();
    } catch {
      setError("Não foi possível concluir a ação. Tente novamente.");
    } finally {
      setBusy(null);
    }
  }

  const pausedCount = chats?.filter((c) => c.botPausedUntil).length ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Atendimentos WhatsApp" side="right">
      <div className="space-y-1 border-b border-slate-200 p-4 pr-14">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          Atendimentos WhatsApp
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Atualizar"
            className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </h2>
        <p className="text-xs text-slate-500">
          Conversas das últimas 24h. {pausedCount > 0 ? `${pausedCount} com a IA pausada.` : "A IA atende todas."}
        </p>
      </div>

      {error ? (
        <p role="alert" className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <ul className="flex-1 space-y-2 overflow-y-auto p-4">
        {chats === null ? (
          <li className="flex justify-center p-8 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </li>
        ) : chats.length === 0 ? (
          <li className="rounded-xl border-2 border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            Nenhuma conversa recente
          </li>
        ) : (
          chats.map((chat) => {
            const paused = !!chat.botPausedUntil;
            return (
              <li
                key={chat.phone}
                className={cn(
                  "space-y-2 rounded-xl border p-3 text-sm",
                  paused ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-extrabold">{chat.customerName ?? "Cliente novo"}</p>
                    <p className="text-xs text-slate-500">{formatWhatsAppPhone(chat.phone)}</p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold uppercase",
                      STATE_STYLES[chat.state],
                    )}
                  >
                    {STATE_LABELS[chat.state]}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-slate-500">
                    {paused ? (
                      <span className="font-bold text-amber-700">
                        IA pausada · {minutesLeft(chat.botPausedUntil!, now)} min
                      </span>
                    ) : (
                      `Última mensagem ${sinceLabel(chat.lastInteractionAt, now)}`
                    )}
                  </p>
                  <button
                    type="button"
                    disabled={busy === chat.phone}
                    onClick={() => void toggle(chat)}
                    className={cn(
                      "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-bold transition disabled:opacity-60",
                      paused
                        ? "bg-emerald-600 text-white hover:bg-emerald-700"
                        : "bg-[#071329] text-white hover:bg-[#0A2540]",
                    )}
                  >
                    {busy === chat.phone ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : paused ? (
                      <Bot className="h-4 w-4" />
                    ) : (
                      <Headset className="h-4 w-4" />
                    )}
                    {paused ? "Reativar IA" : "Assumir conversa (Pausar IA por 30m)"}
                  </button>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </Sheet>
  );
}
