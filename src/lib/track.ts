/** Eventos de anúncio no navegador (Meta Pixel e Google Analytics 4). Seguros mesmo sem os scripts carregados. */

type Fbq = (...args: unknown[]) => void;
type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    fbq?: Fbq;
    gtag?: Gtag;
  }
}

export type FunnelEventName = "VISIT" | "VIEW_PRODUCT" | "ADD_TO_CART" | "CHECKOUT";

const VISITOR_KEY = "pb_vid";

function visitorId(): string | null {
  try {
    let id = window.localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/** Funil do cardápio (próprio, sem terceiros): visitante anônimo + evento. Falha em silêncio. */
export function funnelEvent(event: FunnelEventName, productId?: string) {
  safe(() => {
    // O Cardápio Rápido (link do WhatsApp) tem funil próprio: não entra na conta do site.
    if (window.location.pathname.startsWith("/cardapio-rapido")) return;
    const id = visitorId();
    if (!id) return;
    const body = JSON.stringify({ event, visitorId: id, productId });
    if (navigator.sendBeacon?.("/api/track", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/track", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => undefined);
  });
}

export type TrackItem = { id: string; name: string; priceCents: number; quantity: number };

const reais = (cents: number) => Math.round(cents) / 100;

function safe(fn: () => void) {
  try {
    if (typeof window !== "undefined") fn();
  } catch {
    /* analytics nunca derruba a tela */
  }
}

export function trackAddToCart(item: TrackItem) {
  funnelEvent("ADD_TO_CART", item.id);
  safe(() => {
    const value = reais(item.priceCents * item.quantity);
    window.fbq?.("track", "AddToCart", {
      content_ids: [item.id],
      content_name: item.name,
      content_type: "product",
      value,
      currency: "BRL",
    });
    window.gtag?.("event", "add_to_cart", {
      currency: "BRL",
      value,
      items: [{ item_id: item.id, item_name: item.name, price: reais(item.priceCents), quantity: item.quantity }],
    });
  });
}

export function trackInitiateCheckout(valueCents: number, itemCount: number) {
  funnelEvent("CHECKOUT");
  safe(() => {
    window.fbq?.("track", "InitiateCheckout", { value: reais(valueCents), currency: "BRL", num_items: itemCount });
    window.gtag?.("event", "begin_checkout", { currency: "BRL", value: reais(valueCents) });
  });
}

/** `orderId` também vai como eventID: a API de Conversões (servidor) usa o mesmo, e a Meta junta os dois sem contar em dobro. */
export function trackPurchase(orderId: string, valueCents: number) {
  safe(() => {
    window.fbq?.("track", "Purchase", { value: reais(valueCents), currency: "BRL" }, { eventID: orderId });
    window.gtag?.("event", "purchase", { transaction_id: orderId, currency: "BRL", value: reais(valueCents) });
  });
}
