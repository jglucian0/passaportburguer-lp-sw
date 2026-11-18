"use client";

import { Bell, BellOff, Headset, History, Plus, Rows3, Search, WifiOff, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { advanceOrder } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getNextStatus } from "@/core/orders/state-machine";
import type { OrderStatus } from "@/core/schemas/common";
import { cn } from "@/lib/utils";
import type { CatalogCategoryWithStatus } from "@/infra/db/queries";
import type { AdminOrderView } from "@/infra/db/admin-orders";

import { OrderTimelineDialog, SaiposAdjustBanner } from "./financial-alerts";
import { HistoryDrawer, matchesOrderQuery } from "./history-drawer";
import { ManualOrderDialog } from "./manual-order-dialog";
import { KdsOrderCard } from "./kds-order-card";
import { OrderTicketDialog } from "./order-ticket";
import { Toast, type ToastState } from "./toast";
import { WhatsAppChatsDrawer } from "./whatsapp-chats-drawer";
import { actionErrorMessage } from "./use-run-action";

const POLL_INTERVAL_MS = 8_000;
const CLOCK_INTERVAL_MS = 15_000;
const AUTO_ACCEPT_KEY = "kds:auto-accept";

type Column = {
  id: "awaiting" | "new" | "preparing" | "dispatch";
  title: string;
  statuses: OrderStatus[];
  /** Coluna extra exibida só quando há pedidos (PIX aguardando pagamento). */
  onlyWhenFilled?: boolean;
  /** Borda superior colorida do cabeçalho e cor do contador. */
  accent: string;
  badge: string;
};

type TypeFilter = "ALL" | "DELIVERY" | "PICKUP";
const FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "DELIVERY", label: "Entrega" },
  { value: "PICKUP", label: "Retirada" },
];

const COLUMNS: Column[] = [
  { id: "awaiting", title: "Aguardando pagamento", statuses: ["AWAITING_PAYMENT"], onlyWhenFilled: true, accent: "border-t-slate-400", badge: "bg-slate-200 text-slate-800" },
  { id: "new", title: "Novos", statuses: ["RECEIVED"], accent: "border-t-sky-500", badge: "bg-sky-100 text-sky-800" },
  { id: "preparing", title: "Na Chapa", statuses: ["PREPARING"], accent: "border-t-amber-500", badge: "bg-amber-100 text-amber-800" },
  { id: "dispatch", title: "Em Rota / Pronto", statuses: ["OUT_FOR_DELIVERY", "READY_FOR_PICKUP"], accent: "border-t-violet-500", badge: "bg-violet-100 text-violet-800" },
];

type OrdersResponse = { orders: AdminOrderView[]; serverTime: string };

export function KdsBoard({
  initialOrders,
  initialNow,
  storeName,
  menu,
  headerExtra,
  canReconcile = false,
}: {
  initialOrders: AdminOrderView[];
  /** Instante do servidor (ms) — evita divergência de hidratação nos cronômetros. */
  initialNow: number;
  storeName: string;
  menu: CatalogCategoryWithStatus[];
  headerExtra?: ReactNode;
  /** Proprietário (OWNER) pode confirmar o ajuste no Saipos. */
  canReconcile?: boolean;
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [now, setNow] = useState(initialNow);
  const [online, setOnline] = useState(true);
  const [soundOn, setSoundOn] = useState(false);
  const [autoAccept, setAutoAccept] = useState(false);
  const [filter, setFilter] = useState<TypeFilter>("ALL");
  const [query, setQuery] = useState("");
  const [detailed, setDetailed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [printing, setPrinting] = useState<AdminOrderView | null>(null);
  const [timelineOrder, setTimelineOrder] = useState<AdminOrderView | null>(null);

  const [dragged, setDragged] = useState<AdminOrderView | null>(null);
  const [overColumn, setOverColumn] = useState<Column["id"] | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const movesRef = useRef(new Map<string, OrderStatus>());

  const soundOnRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  /** Todo pedido já visto: só o que NÃO está aqui e chega como "Novo" dispara o alerta. */
  const seenRef = useRef(new Set(initialOrders.map((o) => o.id)));
  const autoAcceptedRef = useRef(new Set<string>());
  const autoAcceptRef = useRef(false);

  const beep = useCallback(() => {
    const ctx = audioRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();

    // Sininho: ondas senoidais com parciais inarmônicos (timbre metálico), ataque seco e decaimento longo.
    const PARTIALS: { ratio: number; level: number; decay: number }[] = [
      { ratio: 1, level: 0.5, decay: 1.4 },
      { ratio: 2.76, level: 0.22, decay: 0.8 },
      { ratio: 5.4, level: 0.1, decay: 0.45 },
    ];
    // "ding-ding" duas vezes (Sol6 → Dó7) para chamar atenção sem ser estridente.
    [1568, 2093, 1568, 2093].forEach((fundamental, index) => {
      const start = ctx.currentTime + index * 0.45;
      PARTIALS.forEach(({ ratio, level, decay }) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = fundamental * ratio;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(level, start + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + decay);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(start);
        oscillator.stop(start + decay + 0.05);
      });
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/orders", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        window.location.href = "/admin/login";
        return;
      }
      if (!response.ok) throw new Error("orders failed");

      const data = (await response.json()) as OrdersResponse;
      setOnline(true);
      // Movimentos otimistas ainda em voo não podem ser desfeitos por um polling antigo.
      setOrders(
        data.orders.map((o) => {
          const pending = movesRef.current.get(o.id);
          return pending ? { ...o, status: pending } : o;
        }),
      );
      setNow(new Date(data.serverTime).getTime());

      const fresh = data.orders.filter((o) => o.status === "RECEIVED" && !seenRef.current.has(o.id));
      for (const order of data.orders) seenRef.current.add(order.id);
      if (fresh.length > 0 && soundOnRef.current) beep();
    } catch {
      setOnline(false);
    }
  }, [beep]);

  /* Polling a cada 8s (somente com a aba visível) + relógio dos cronômetros. */
  useEffect(() => {
    const poll = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const pollTimer = window.setInterval(poll, POLL_INTERVAL_MS);
    const clockTimer = window.setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(pollTimer);
      window.clearInterval(clockTimer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refresh]);

  /* Preferência de aceite automático por dispositivo. */
  useEffect(() => {
    try {
      if (window.localStorage.getItem(AUTO_ACCEPT_KEY) === "1") {
        autoAcceptRef.current = true;
        setAutoAccept(true);
      }
    } catch {
      /* armazenamento indisponível */
    }
  }, []);

  /* Aceite automático: move cada pedido "Novo" para "Na Chapa" uma única vez. */
  useEffect(() => {
    if (!autoAccept) return;
    const pending = orders.filter((o) => o.status === "RECEIVED" && !autoAcceptedRef.current.has(o.id));
    if (pending.length === 0) return;

    for (const order of pending) autoAcceptedRef.current.add(order.id);
    void Promise.allSettled(pending.map((o) => advanceOrder({ orderId: o.id }))).then(() => refresh());
  }, [autoAccept, orders, refresh]);

  function toggleSound() {
    if (soundOn) {
      soundOnRef.current = false;
      setSoundOn(false);
      return;
    }
    // O navegador só libera áudio após um gesto do usuário: o AudioContext nasce neste clique.
    if (!audioRef.current) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioRef.current = new Ctor();
    }
    soundOnRef.current = true;
    setSoundOn(true);
    beep(); // confirma que o som está funcionando
  }

  function toggleAutoAccept(checked: boolean) {
    autoAcceptRef.current = checked;
    setAutoAccept(checked);
    try {
      window.localStorage.setItem(AUTO_ACCEPT_KEY, checked ? "1" : "0");
    } catch {
      /* ignora */
    }
  }

  /** Única coluna válida para o card arrastado: a que contém o próximo status do fluxo. */
  const validColumnId = dragged
    ? (() => {
        const next = getNextStatus(dragged.status, dragged.deliveryType);
        return next ? (COLUMNS.find((c) => c.statuses.includes(next))?.id ?? null) : null;
      })()
    : null;

  function endDrag() {
    setDragged(null);
    setOverColumn(null);
  }

  async function dropOn(column: Column) {
    const order = dragged;
    endDrag();
    if (!order || column.id !== validColumnId) return;
    const next = getNextStatus(order.status, order.deliveryType);
    if (!next) return;

    const previous = order.status;
    movesRef.current.set(order.id, next);
    setOrders((current) => current.map((o) => (o.id === order.id ? { ...o, status: next } : o)));

    try {
      const result = await advanceOrder({ orderId: order.id, toStatus: next });
      if (!result.ok) throw new Error(actionErrorMessage(result));
      movesRef.current.delete(order.id);
      void refresh();
    } catch (error) {
      movesRef.current.delete(order.id);
      setOrders((current) => current.map((o) => (o.id === order.id ? { ...o, status: previous } : o)));
      setToast({
        kind: "error",
        message: error instanceof Error && error.message ? error.message : "Não foi possível mover o pedido.",
      });
    }
  }

  const history = orders.filter((o) => o.status === "DELIVERED" || o.status === "CANCELED");

  const visibleColumns = COLUMNS.filter(
    (column) => !column.onlyWhenFilled || orders.some((o) => column.statuses.includes(o.status)),
  );

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div>
          <h1 className="text-2xl font-extrabold leading-none">Pedidos</h1>
          <p className="mt-1 text-[11px] text-muted">Atualiza sozinho a cada 8 segundos.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {!online ? (
            <span className="inline-flex items-center gap-1 rounded-lg bg-amber-400 px-2.5 py-1.5 text-xs font-bold text-black">
              <WifiOff className="h-4 w-4" /> Sem conexão
            </span>
          ) : null}
          <label className="relative block w-full sm:w-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar #número ou nome..."
              aria-label="Buscar pedido"
              className="h-10 w-full rounded-xl sm:w-56 border border-slate-200 bg-white pl-8 pr-3 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </label>
          <div role="radiogroup" aria-label="Filtrar por tipo" className="flex rounded-xl border border-slate-200 bg-white p-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={`rounded-lg px-2.5 py-1 text-sm font-bold transition ${filter === f.value ? "bg-[#071329] text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={detailed}
            onClick={() => setDetailed((v) => !v)}
            title="Alternar entre cards compactos e detalhados"
            className={cn(
              "inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-bold",
              detailed ? "border-[#071329] bg-[#071329] text-white" : "border-slate-200 bg-white text-slate-700",
            )}
          >
            <Rows3 className="h-4 w-4" />
            {detailed ? "Detalhado" : "Compacto"}
          </button>
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold">
            <Zap className="h-4 w-4 text-brand" />
            Aceite Automático
            <Switch checked={autoAccept} onCheckedChange={toggleAutoAccept} aria-label="Aceite automático" />
          </label>
          <Button variant={soundOn ? "outline" : "secondary"} className="h-10" onClick={toggleSound}>
            {soundOn ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            {soundOn ? "Silenciar Som" : "Ativar Som"}
          </Button>
          <Button variant="outline" className="h-10" onClick={() => setHistoryOpen(true)}>
            <History className="h-4 w-4" /> Histórico Hoje ({history.length})
          </Button>
          <Button variant="outline" className="h-10" onClick={() => setChatsOpen(true)}>
            <Headset className="h-4 w-4" /> Atendimentos WhatsApp
          </Button>
          <Button className="h-10 w-full sm:w-auto" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Novo Pedido
          </Button>
          {headerExtra}
        </div>
      </div>

      <SaiposAdjustBanner orders={orders} canReconcile={canReconcile} onChanged={() => void refresh()} />

      <div
        className="grid gap-3 md:grid-cols-2 lg:min-h-0 lg:flex-1 lg:grid-cols-[repeat(var(--cols),minmax(0,1fr))] lg:grid-rows-[minmax(0,1fr)]"
        style={{ ["--cols" as string]: visibleColumns.length } as React.CSSProperties}
      >
        {visibleColumns.map((column) => {
          const columnOrders = orders
            .filter(
              (o) =>
                column.statuses.includes(o.status) &&
                (filter === "ALL" || o.deliveryType === filter) &&
                matchesOrderQuery(o, query),
            )
            // Filas ativas: mais antigo primeiro (maior urgência).
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

          return (
            <section
              key={column.id}
              className={cn(
                "flex min-h-0 min-w-0 flex-col gap-2 rounded-2xl transition",
                dragged && column.id !== validColumnId && "opacity-60",
                dragged && column.id === validColumnId && overColumn === column.id && "bg-amber-50/40 ring-2 ring-amber-400",
              )}
              onDragOver={(event) => {
                if (!dragged || column.id !== validColumnId) return; // coluna inválida: não aceita soltar
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (overColumn !== column.id) setOverColumn(column.id);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setOverColumn((c) => (c === column.id ? null : c));
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                void dropOn(column);
              }}
            >
              <h2
                className={`flex shrink-0 items-center justify-between rounded-xl border border-slate-200/90 border-t-4 bg-white px-3 py-2 text-base font-extrabold text-slate-900 shadow-sm ${column.accent}`}
              >
                {column.title}
                <span className={`rounded-full px-2.5 py-0.5 text-sm tabular-nums ${column.badge}`}>
                  {columnOrders.length}
                </span>
              </h2>
              <div className="space-y-2.5 pr-1 [scrollbar-color:#cbd5e1_transparent] [scrollbar-width:thin] lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {dragged && column.id === validColumnId && overColumn === column.id ? (
                <p className="rounded-xl border-2 border-dashed border-amber-400 p-3 text-center text-sm font-bold text-amber-700">
                  Solte aqui para avançar
                </p>
              ) : null}
              {columnOrders.length === 0 ? (
                <p className="rounded-xl border-2 border-dashed border-slate-300 p-6 text-center text-sm text-muted">
                  Nenhum pedido
                </p>
              ) : (
                columnOrders.map((order) => (
                  <KdsOrderCard
                    key={order.id}
                    order={order}
                    now={now}
                    onChanged={() => void refresh()}
                    onPrint={setPrinting}
                    onTimeline={setTimelineOrder}
                    detailed={detailed}
                    dragging={dragged?.id === order.id}
                    onDragStartCard={setDragged}
                    onDragEndCard={endDrag}
                  />
                ))
              )}
              </div>
            </section>
          );
        })}
      </div>
      </div>

      <WhatsAppChatsDrawer open={chatsOpen} onOpenChange={setChatsOpen} />

      <HistoryDrawer open={historyOpen} onOpenChange={setHistoryOpen} orders={history} onPrint={setPrinting} onTimeline={setTimelineOrder} />

      {creating ? (
        <ManualOrderDialog
          menu={menu}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void refresh();
          }}
        />
      ) : null}

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {timelineOrder ? <OrderTimelineDialog order={timelineOrder} onClose={() => setTimelineOrder(null)} /> : null}

      {printing ? (
        <OrderTicketDialog order={printing} storeName={storeName} onClose={() => setPrinting(null)} />
      ) : null}
    </>
  );
}
