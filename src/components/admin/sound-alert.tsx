"use client";

import { Bell, BellOff, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

const POLL_INTERVAL_MS = 15_000;

type Ping = { total: number; lastUpdatedAt: string | null };

/**
 * Consulta GET /api/admin/orders/ping a cada 15s, somente com a aba visível.
 * Ao detectar mudança atualiza a tela; ao detectar novo pedido toca o alerta (Web Audio API).
 * O navegador exige um clique do usuário para liberar áudio, daí o botão "Ativar som".
 */
export function SoundAlert() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [online, setOnline] = useState(true);
  const enabledRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const lastPingRef = useRef<Ping | null>(null);

  const beep = useCallback(() => {
    const ctx = audioRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();

    [880, 1175, 880, 1175].forEach((frequency, index) => {
      const start = ctx.currentTime + index * 0.3;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.4, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.28);
    });
  }, []);

  const poll = useCallback(async () => {
    if (document.visibilityState !== "visible") return;

    try {
      const response = await fetch("/api/admin/orders/ping", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/admin/login";
        return;
      }
      if (!response.ok) throw new Error("ping failed");

      const data = (await response.json()) as Ping;
      setOnline(true);

      const previous = lastPingRef.current;
      lastPingRef.current = data;

      if (previous && (previous.total !== data.total || previous.lastUpdatedAt !== data.lastUpdatedAt)) {
        router.refresh();
        if (data.total > previous.total && enabledRef.current) beep();
      }
    } catch {
      setOnline(false);
    }
  }, [router, beep]);

  useEffect(() => {
    void poll();
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [poll]);

  function toggle() {
    if (enabled) {
      enabledRef.current = false;
      setEnabled(false);
      return;
    }
    if (!audioRef.current) {
      const AudioContextClass =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioRef.current = new AudioContextClass();
    }
    enabledRef.current = true;
    setEnabled(true);
    beep(); // confirma que o som está funcionando
  }

  return (
    <div className="flex items-center gap-2">
      {!online ? (
        <span className="inline-flex items-center gap-1 text-xs text-amber-400">
          <WifiOff className="h-4 w-4" /> Sem conexão
        </span>
      ) : null}
      <Button variant={enabled ? "secondary" : "primary"} size="sm" onClick={toggle}>
        {enabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
        {enabled ? "Som ativado" : "Ativar som"}
      </Button>
    </div>
  );
}
