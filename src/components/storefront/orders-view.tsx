"use client";

import {
  Check,
  ChevronRight,
  LogOut,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plane,
  RotateCcw,
  ShoppingBag,
  User,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { clearCustomerSession, type CustomerOrderView } from "@/actions/storefront";
import { isTerminalStatus } from "@/core/orders/state-machine";
import type { OrderStatus } from "@/core/schemas/common";
import type { CatalogCategory, CatalogDeliveryZone } from "@/core/schemas/product";
import { cn, formatCents, formatDateTime, formatPhone, whatsappLink } from "@/lib/utils";

import { useCart } from "./cart-provider";
import {
  ACTIVE_ORDER_KEY,
  CUSTOMER_PREFILL_KEY,
  clearStoredCart,
  ORDER_PLACED_FLAG,
  type CartLineAddon,
} from "./cart-storage";
import { DESTINATIONS, matchDestination, type Destination } from "./destinations";
import { PassportStamp } from "./passport-stamp";
import { loadSavedAddress, saveAddress, type SavedAddress } from "./use-customer";

const POLL_INTERVAL_MS = 15_000;
const HISTORY_LIMIT = 5;
/** Marco de milhas usado na barra de progresso (resgates ainda não existem). */
const MILES_MILESTONE = 500;
/** Previsão de fallback (min) quando a zona de entrega não informa estimativa. */
const FALLBACK_DELIVERY_MINUTES = 50;
const PICKUP_MINUTES = 30;

/** Os 7 destinos do passaporte, na ordem de exibição, com o nome mostrado ao cliente. */
const PASSPORT_DESTINATIONS: Array<{ id: string; label: string }> = [
  { id: "st-louis", label: "St. Louis" },
  { id: "mexico", label: "México" },
  { id: "tokyo", label: "Tokyo" },
  { id: "buenos-aires", label: "Buenos Aires" },
  { id: "milao", label: "Milão" },
  { id: "cremona", label: "Cremona" },
  { id: "corbin", label: "Corbin" },
];

/* ------------------------------------------------------------------ */
/* 1. Banner de pedido ativo                                           */
/* ------------------------------------------------------------------ */

type Step = { label: string; reached: (s: OrderStatus) => boolean };

function getSteps(deliveryType: CustomerOrderView["deliveryType"]): Step[] {
  const steps: Step[] = [
    { label: "Pedido Recebido", reached: () => true },
    { label: "Na Chapa", reached: (s) => ["PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"].includes(s) },
  ];
  // Retirada não passa por "saiu para entrega".
  if (deliveryType === "DELIVERY") {
    steps.push({ label: "Saiu para Entrega", reached: (s) => ["OUT_FOR_DELIVERY", "DELIVERED"].includes(s) });
  }
  steps.push({ label: "Entregue", reached: (s) => s === "DELIVERED" });
  return steps;
}

function estimateLabel(order: CustomerOrderView, zones: CatalogDeliveryZone[]): string {
  if (order.status === "AWAITING_PAYMENT") return "Após a confirmação do PIX";
  const zone = zones.find((z) => z.id === order.address?.deliveryZoneId);
  const minutes =
    order.deliveryType === "PICKUP" ? PICKUP_MINUTES : (zone?.estimatedMinutes ?? FALLBACK_DELIVERY_MINUTES);
  const at = new Date(new Date(order.createdAt).getTime() + minutes * 60_000);
  return `até ${at.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  })}`;
}

function ActiveOrderBanner({
  order,
  zones,
  whatsapp,
}: {
  order: CustomerOrderView;
  zones: CatalogDeliveryZone[];
  whatsapp: string | null;
}) {
  const steps = getSteps(order.deliveryType);
  let current = 0;
  steps.forEach((step, i) => {
    if (step.reached(order.status)) current = i;
  });

  return (
    <section
      aria-label={`Pedido ${order.orderNumber} em andamento`}
      className="overflow-hidden rounded-2xl border border-[#F59E0B]/40 bg-[#071329] text-white shadow-lg"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F59E0B]/15 text-[#F59E0B]">
            <Plane className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#F59E0B]">
              Pedido em andamento
            </p>
            <h2 className="text-lg font-extrabold leading-tight">Pedido #{order.orderNumber}</h2>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Previsão</p>
          <p className="text-sm font-bold">{estimateLabel(order, zones)}</p>
        </div>
      </div>

      <ol className="flex items-start px-3 pb-5 pt-6 sm:px-5">
        {steps.map((step, index) => {
          const done = index <= current;
          const active = index === current;
          return (
            <li
              key={step.label}
              aria-current={active ? "step" : undefined}
              className="relative flex flex-1 flex-col items-center gap-2 text-center"
            >
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute right-1/2 top-3.5 h-0.5 w-full -translate-y-1/2",
                    done ? "bg-[#F59E0B]" : "bg-white/15",
                  )}
                />
              ) : null}
              <span
                className={cn(
                  "relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold",
                  done ? "border-[#F59E0B] bg-[#F59E0B] text-[#071329]" : "border-white/25 bg-[#071329] text-white/50",
                  active && "ring-4 ring-[#F59E0B]/30",
                )}
              >
                {done ? <Check className="h-4 w-4" strokeWidth={3} /> : index + 1}
              </span>
              <span className={cn("text-[11px] leading-tight", done ? "font-semibold text-white" : "text-white/50")}>
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>

      {order.status === "AWAITING_PAYMENT" ? (
        <p className="border-t border-white/10 bg-amber-400/10 px-5 py-3 text-xs text-amber-100">
          Aguardando a confirmação do pagamento PIX. Assim que confirmado, seu pedido vai para a chapa.
        </p>
      ) : null}

      {whatsapp ? (
        <div className="border-t border-white/10 px-5 py-3">
          <a
            href={whatsappLink(whatsapp, `Olá! Preciso de ajuda com o pedido #${order.orderNumber}.`)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-300 hover:text-white"
          >
            <MessageCircle className="h-4 w-4" strokeWidth={1.75} /> Falar no WhatsApp sobre este pedido
          </a>
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Carimbos e milhas                                                */
/* ------------------------------------------------------------------ */

function StampsCard({
  visited,
  destinations,
}: {
  visited: Set<string>;
  destinations: Array<Destination & { label: string }>;
}) {
  const count = destinations.filter((d) => visited.has(d.id)).length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-extrabold text-[#0A2540]">
          Seus Carimbos ({count}/{destinations.length})
        </h2>
        <span className="text-xs text-slate-500">
          {count === destinations.length ? "Passaporte completo!" : "Colecione todos"}
        </span>
      </div>

      <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
        {destinations.map((d) => {
          const stamped = visited.has(d.id);
          const body = (
            <>
              <PassportStamp
                stamp={d.stamp}
                destinationId={d.id}
                size={64}
                tone="blue"
                className={stamped ? "" : "pointer-events-none"}
              />
              <span className="text-xs font-bold leading-tight text-[#0A2540]">{d.label}</span>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={stamped ? { backgroundColor: `${d.accent}1a`, color: d.accent } : undefined}
              >
                {stamped ? "Carimbado" : "Pedir agora"}
              </span>
            </>
          );

          return (
            <li key={d.id}>
              {stamped ? (
                <div
                  className="flex h-full flex-col items-center gap-1.5 rounded-xl border-2 p-2.5 text-center"
                  style={{ borderColor: d.accent, backgroundColor: `${d.accent}0d` }}
                >
                  {body}
                </div>
              ) : (
                <Link
                  href={`/?destino=${d.id}#cardapio`}
                  aria-label={`${d.label}: ainda não carimbado. Ver no cardápio`}
                  className="flex h-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 p-2.5 text-center text-slate-500 opacity-60 grayscale transition hover:opacity-100 hover:grayscale-0"
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MilesCard({ miles }: { miles: number }) {
  const progress = Math.round(((miles % MILES_MILESTONE) / MILES_MILESTONE) * 100);
  const remaining = MILES_MILESTONE - (miles % MILES_MILESTONE);

  return (
    <section className="flex flex-col rounded-2xl bg-[#071329] p-5 text-white shadow-sm">
      <h2 className="text-lg font-extrabold">Passaporte Milhas</h2>

      <p className="mt-4 text-4xl font-extrabold leading-none text-[#F59E0B]">
        {miles.toLocaleString("pt-BR")}
        <span className="ml-2 text-sm font-semibold text-slate-300">milhas</span>
      </p>
      <p className="mt-2 text-xs text-slate-400">1 milha a cada R$ 1 em pedidos entregues.</p>

      <div className="mt-6">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label="Progresso até o próximo marco de milhas"
          className="h-2.5 overflow-hidden rounded-full bg-white/10"
        >
          <div className="h-full rounded-full bg-[#F59E0B] transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-xs text-slate-300">
          Faltam {remaining.toLocaleString("pt-BR")} milhas para o próximo marco
        </p>
      </div>

      <span className="mt-auto inline-flex w-fit pt-6">
        <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold text-amber-300">
          Resgate de descontos • Em breve
        </span>
      </span>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Últimos embarques                                                */
/* ------------------------------------------------------------------ */

function itemsSummary(order: CustomerOrderView): string {
  return order.items.map((i) => `${i.quantity}x ${i.name}`).join(" • ");
}

function HistoryCard({
  order,
  onReorder,
  justAdded,
}: {
  order: CustomerOrderView;
  onReorder: (order: CustomerOrderView) => void;
  justAdded: boolean;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500">
          {formatDateTime(order.createdAt)} • Pedido #{order.orderNumber}
        </p>
        <p className="mt-1 line-clamp-2 text-sm font-medium text-[#0A2540]">{itemsSummary(order)}</p>
      </div>
      <div className="flex items-center justify-between gap-4 sm:justify-end">
        <span className="text-base font-extrabold text-[#0A2540]">{formatCents(order.totalCents)}</span>
        <button
          type="button"
          onClick={() => onReorder(order)}
          className={cn(
            "inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition active:scale-95",
            justAdded
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-slate-300 text-[#0A2540] hover:border-[#F59E0B] hover:bg-amber-50",
          )}
        >
          {justAdded ? (
            <>
              <Check className="h-4 w-4" strokeWidth={2.5} /> Adicionado
            </>
          ) : (
            <>
              <RotateCcw className="h-4 w-4" strokeWidth={2} /> Pedir novamente
            </>
          )}
        </button>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Dados e endereço                                                 */
/* ------------------------------------------------------------------ */

const fieldClass =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0A2540] outline-none focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/30";

function AddressEditor({
  initial,
  zones,
  onSave,
  onCancel,
}: {
  initial: SavedAddress | null;
  zones: CatalogDeliveryZone[];
  onSave: (address: SavedAddress) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<SavedAddress>(
    initial ?? { zoneId: "", street: "", number: "", complement: "", reference: "" },
  );
  const set = (key: keyof SavedAddress) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const valid = form.street.trim().length > 0 && form.number.trim().length > 0 && form.zoneId !== "";

  return (
    <form
      className="mt-3 grid grid-cols-6 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSave({
          zoneId: form.zoneId,
          street: form.street.trim(),
          number: form.number.trim(),
          complement: form.complement.trim(),
          reference: form.reference.trim(),
        });
      }}
    >
      <select aria-label="Bairro" value={form.zoneId} onChange={set("zoneId")} className={cn(fieldClass, "col-span-6")}>
        <option value="">Bairro</option>
        {zones
          .filter((z) => z.isActive)
          .map((z) => (
            <option key={z.id} value={z.id}>
              {z.neighborhood}
            </option>
          ))}
      </select>
      <input aria-label="Rua" placeholder="Rua" value={form.street} onChange={set("street")} className={cn(fieldClass, "col-span-4")} />
      <input aria-label="Número" placeholder="Nº" value={form.number} onChange={set("number")} className={cn(fieldClass, "col-span-2")} />
      <input aria-label="Complemento" placeholder="Complemento" value={form.complement} onChange={set("complement")} className={cn(fieldClass, "col-span-3")} />
      <input aria-label="Referência" placeholder="Referência" value={form.reference} onChange={set("reference")} className={cn(fieldClass, "col-span-3")} />
      <div className="col-span-6 mt-1 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-9 rounded-lg px-3 text-sm font-medium text-slate-500 hover:text-[#0A2540]">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!valid}
          className="h-9 rounded-lg bg-[#F59E0B] px-4 text-sm font-bold text-[#0A2540] hover:brightness-105 disabled:opacity-50"
        >
          Salvar endereço
        </button>
      </div>
    </form>
  );
}

function ProfileCard({
  name,
  phone,
  address,
  zones,
  onSaveAddress,
  onLogout,
  loggingOut,
}: {
  name: string;
  phone: string;
  address: SavedAddress | null;
  zones: CatalogDeliveryZone[];
  onSaveAddress: (address: SavedAddress) => void;
  onLogout: () => void;
  loggingOut: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const neighborhood = zones.find((z) => z.id === address?.zoneId)?.neighborhood;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-extrabold text-[#0A2540]">Meus dados</h2>
        <button
          type="button"
          onClick={onLogout}
          disabled={loggingOut}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-600 disabled:opacity-50"
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} /> Sair da conta
        </button>
      </div>

      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} />
          <div>
            <dt className="sr-only">Nome</dt>
            <dd className="font-semibold text-[#0A2540]">{name}</dd>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} />
          <div>
            <dt className="sr-only">WhatsApp</dt>
            <dd className="font-semibold text-[#0A2540]">{formatPhone(phone)}</dd>
          </div>
        </div>
      </dl>

      <div className="mt-4 border-t border-slate-100 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2 text-sm">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} />
            {address ? (
              <p className="text-[#0A2540]">
                <span className="font-semibold">
                  {address.street}, {address.number}
                  {address.complement ? ` – ${address.complement}` : ""}
                </span>
                <span className="block text-xs text-slate-500">
                  {[neighborhood, address.reference].filter(Boolean).join(" • ")}
                </span>
              </p>
            ) : (
              <p className="text-slate-500">Nenhum endereço salvo ainda.</p>
            )}
          </div>
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[#0A2540] underline-offset-2 hover:underline"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} /> {address ? "Editar" : "Adicionar"}
            </button>
          ) : null}
        </div>

        {editing ? (
          <AddressEditor
            initial={address}
            zones={zones}
            onCancel={() => setEditing(false)}
            onSave={(a) => {
              onSaveAddress(a);
              setEditing(false);
            }}
          />
        ) : address ? (
          <p className="mt-2 pl-6 text-[11px] text-slate-400">Disponível no checkout em "Usar meu endereço salvo".</p>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Painel                                                              */
/* ------------------------------------------------------------------ */

export function OrdersView({
  tenantId,
  customerName,
  customerPhone,
  orders,
  categories,
  zones,
  whatsapp,
}: {
  tenantId: string;
  customerName: string;
  customerPhone: string;
  orders: CustomerOrderView[];
  categories: CatalogCategory[];
  zones: CatalogDeliveryZone[];
  whatsapp: string | null;
}) {
  const router = useRouter();
  const { addLine, openCart } = useCart();
  const [notice, setNotice] = useState<string | null>(null);
  const [reorderedId, setReorderedId] = useState<string | null>(null);
  const [loggingOut, startLogout] = useTransition();
  const [savedAddress, setSavedAddress] = useState<SavedAddress | null>(null);

  const catalog = useMemo(() => categories.flatMap((c) => c.products), [categories]);
  const active = orders.filter((o) => !isTerminalStatus(o.status));
  const delivered = orders.filter((o) => o.status === "DELIVERED");
  const history = delivered.slice(0, HISTORY_LIMIT);
  const hasActive = active.length > 0;

  /* Destino de cada produto (categoria + nome); itens de produtos removidos caem no nome do snapshot. */
  const destinationByProduct = useMemo(() => {
    const map = new Map<string, Destination>();
    for (const category of categories) {
      for (const product of category.products) {
        const d = matchDestination(category.name, product.name);
        if (d) map.set(product.id, d);
      }
    }
    return map;
  }, [categories]);

  const destinations = useMemo(
    () =>
      PASSPORT_DESTINATIONS.flatMap(({ id, label }) => {
        const d = DESTINATIONS.find((x) => x.id === id);
        return d ? [{ ...d, label }] : [];
      }),
    [],
  );

  /* Carimbo = destino de qualquer pedido não cancelado. */
  const visited = useMemo(() => {
    const ids = new Set<string>();
    for (const order of orders) {
      if (order.status === "CANCELED") continue;
      for (const item of order.items) {
        const d = (item.productId ? destinationByProduct.get(item.productId) : undefined) ?? matchDestination(item.name);
        if (d) ids.add(d.id);
      }
    }
    return ids;
  }, [orders, destinationByProduct]);

  const miles = Math.floor(delivered.reduce((sum, o) => sum + o.totalCents, 0) / 100);

  /* Endereço: o salvo no perfil; senão, o do último pedido de entrega. */
  useEffect(() => {
    const saved = loadSavedAddress();
    if (saved) {
      setSavedAddress(saved);
      return;
    }
    const last = orders.find((o) => o.address)?.address;
    if (last) {
      setSavedAddress({
        zoneId: last.deliveryZoneId ?? "",
        street: last.street,
        number: last.number,
        complement: last.complement ?? "",
        reference: last.reference ?? "",
      });
    }
  }, [orders]);

  // Sinaliza pedido em andamento para o indicador da bottom tab bar.
  useEffect(() => {
    try {
      if (hasActive) window.localStorage.setItem(ACTIVE_ORDER_KEY, "1");
      else window.localStorage.removeItem(ACTIVE_ORDER_KEY);
      window.dispatchEvent(new Event("pb:active-order-change"));
    } catch {
      /* ignorar */
    }
  }, [hasActive]);

  // Pedido recém-criado: limpa o carrinho persistido.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(ORDER_PLACED_FLAG) === tenantId) {
        clearStoredCart(tenantId);
        window.sessionStorage.removeItem(ORDER_PLACED_FLAG);
      }
    } catch {
      /* ignorar */
    }
  }, [tenantId]);

  // Acompanhamento ao vivo: atualiza a cada 15s apenas com a aba visível.
  useEffect(() => {
    if (!hasActive) return;

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };

    const interval = window.setInterval(refreshIfVisible, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [hasActive, router]);

  function handleReorder(order: CustomerOrderView) {
    const productsById = new Map(catalog.map((p) => [p.id, p]));
    const lines: Parameters<typeof addLine>[0][] = [];
    let skipped = 0;

    for (const item of order.items) {
      const product = item.productId ? productsById.get(item.productId) : undefined;
      if (!product || !product.isAvailable) {
        skipped++;
        continue;
      }

      const allAddons = product.addonGroups.flatMap((g) => g.addons);
      const addons: CartLineAddon[] = [];
      let addonsOk = true;

      for (const snap of item.addons) {
        const match = allAddons.find((a) => a.name === snap.name && a.isAvailable);
        if (!match) {
          addonsOk = false;
          break;
        }
        addons.push({ addonId: match.id, name: match.name, priceCents: match.priceCents, quantity: snap.quantity });
      }

      if (!addonsOk) {
        skipped++;
        continue;
      }

      lines.push({
        productId: product.id,
        name: product.name,
        imageUrl: product.imageUrl,
        unitPriceCents: product.priceCents,
        quantity: item.quantity,
        addons,
      });
    }

    if (lines.length === 0) {
      setNotice("Não foi possível repetir este pedido: os itens não estão mais disponíveis.");
      return;
    }

    for (const line of lines) addLine(line);
    setNotice(
      skipped > 0
        ? `${skipped} ${skipped === 1 ? "item não está" : "itens não estão"} mais disponível e ficou de fora.`
        : null,
    );
    setReorderedId(order.id);
    window.setTimeout(() => setReorderedId((id) => (id === order.id ? null : id)), 2500);
    openCart();
  }

  function handleSaveAddress(address: SavedAddress) {
    saveAddress(address);
    setSavedAddress(address);
  }

  function handleLogout() {
    startLogout(async () => {
      try {
        window.localStorage.removeItem(CUSTOMER_PREFILL_KEY);
        saveAddress(null);
        window.localStorage.removeItem(ACTIVE_ORDER_KEY);
        window.dispatchEvent(new Event("pb:customer-change"));
        window.dispatchEvent(new Event("pb:active-order-change"));
      } catch {
        /* ignorar */
      }
      await clearCustomerSession();
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        Olá, <span className="font-semibold text-[#0A2540]">{customerName}</span>!
      </p>

      {notice ? (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {notice}
        </p>
      ) : null}

      {active.map((order) => (
        <ActiveOrderBanner key={order.id} order={order} zones={zones} whatsapp={whatsapp} />
      ))}

      <div className="grid gap-6 md:grid-cols-2">
        <StampsCard visited={visited} destinations={destinations} />
        <MilesCard miles={miles} />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-[#0A2540]">Últimos Embarques</h2>
          <Link
            href="/#cardapio"
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-[#0A2540]"
          >
            Ver cardápio <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {history.length > 0 ? (
          <ul className="space-y-3">
            {history.map((order) => (
              <HistoryCard key={order.id} order={order} onReorder={handleReorder} justAdded={reorderedId === order.id} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
            <ShoppingBag className="h-6 w-6 text-slate-400" strokeWidth={1.5} />
            <p className="text-sm text-slate-500">Seu primeiro embarque ainda não aconteceu.</p>
            <Link
              href="/#cardapio"
              className="inline-flex h-10 items-center rounded-xl bg-[#F59E0B] px-4 text-sm font-bold text-[#0A2540] hover:brightness-105"
            >
              Escolher meu destino
            </Link>
          </div>
        )}
      </section>

      <ProfileCard
        name={customerName}
        phone={customerPhone}
        address={savedAddress}
        zones={zones}
        onSaveAddress={handleSaveAddress}
        onLogout={handleLogout}
        loggingOut={loggingOut}
      />
    </div>
  );
}
