"use client";

import { ArrowLeft, Bike, ChevronDown, Loader2, LocateFixed, Store } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { createOrder } from "@/actions/storefront";
import { Input, Textarea } from "@/components/ui/input";
import { calculateCart } from "@/core/cart/calculate-cart";
import { OTHER_ZONE_NAME, SERVICE_CITY } from "@/core/store/maringa-zones";
import type { DeliveryType, PaymentMethod } from "@/core/schemas/common";
import type {
  CatalogDeliveryZone,
  CatalogProduct,
} from "@/core/schemas/product";
import { cn, formatCents, formatPhone } from "@/lib/utils";

import { useCart } from "./cart-provider";
import {
  StreetAutocomplete,
  type StreetSuggestion,
} from "./street-autocomplete";
import { ZoneCombobox, normalizeText } from "./zone-combobox";
import {
  CUSTOMER_PREFILL_KEY,
  lineTotal,
  ORDER_PLACED_FLAG,
  ZONE_PREFILL_KEY,
} from "./cart-storage";

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  PIX: "PIX",
  CARD_ON_DELIVERY: "Cartão na entrega",
  CASH: "Dinheiro",
};

/* Visual claro do checkout: sobrescreve o tema escuro dos inputs compartilhados. */
const inputClass =
  "h-12 rounded-xl border-slate-300 bg-white text-base text-slate-900 placeholder:text-slate-400 focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/30";
const cardClass =
  "space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function formatCep(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

type ViaCepResponse = {
  erro?: boolean | string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

type ReverseGeocode = {
  street: string | null;
  number: string | null;
  neighborhood: string | null;
};

function parseReaisToCents(value: string): number | null {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0
    ? Math.round(number * 100)
    : null;
}

export function CheckoutForm({
  catalog,
  zones,
  minOrderCents,
  storeOpen,
}: {
  catalog: CatalogProduct[];
  zones: CatalogDeliveryZone[];
  minOrderCents: number;
  storeOpen: boolean;
}) {
  const { tenantId, lines, hydrated } = useCart();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [deliveryType, setDeliveryType] = useState<DeliveryType>("DELIVERY");
  const [zoneId, setZoneId] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [reference, setReference] = useState("");
  const [otherNeighborhood, setOtherNeighborhood] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("PIX");
  const [changeFor, setChangeFor] = useState("");
  const [noChange, setNoChange] = useState(true);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cep, setCep] = useState("");
  const [cepLoading, setCepLoading] = useState(false);
  const [cepMsg, setCepMsg] = useState<{
    tone: "ok" | "warn";
    text: string;
  } | null>(null);
  const lastCep = useRef("");
  const [locating, setLocating] = useState(false);
  const [locationMsg, setLocationMsg] = useState<{
    tone: "ok" | "warn";
    text: string;
  } | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CUSTOMER_PREFILL_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { name?: string; phone?: string };
      if (saved.name) setName(saved.name);
      if (saved.phone) setPhone(formatPhone(saved.phone));
    } catch {
      /* ignorar */
    }
  }, []);

  useEffect(() => {
    try {
      const savedZone = window.localStorage.getItem(ZONE_PREFILL_KEY);
      if (savedZone && zones.some((z) => z.id === savedZone))
        setZoneId(savedZone);
    } catch {
      /* ignorar */
    }
  }, [zones]);

  const zone = zones.find((z) => z.id === zoneId) ?? null;
  const changeForCents =
    paymentMethod === "CASH" && !noChange ? parseReaisToCents(changeFor) : null;

  const items = useMemo(
    () =>
      lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        addons: l.addons.map((a) => ({
          addonId: a.addonId,
          quantity: a.quantity,
        })),
      })),
    [lines],
  );

  /* Observações por item entram nas notas do pedido para a cozinha. */
  const combinedNotes = [
    notes.trim(),
    ...lines
      .filter((l) => l.note)
      .map((l) => `${l.quantity}x ${l.name}: ${l.note}`),
  ]
    .filter(Boolean)
    .join("\n");

  const calc = useMemo(
    () =>
      calculateCart({
        items,
        catalog,
        deliveryType,
        deliveryZone: zone,
        minOrderCents,
        paymentMethod,
        changeForCents,
      }),
    [
      items,
      catalog,
      deliveryType,
      zone,
      minOrderCents,
      paymentMethod,
      changeForCents,
    ],
  );

  const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);
  const fee = deliveryType === "DELIVERY" && zone ? zone.feeCents : 0;
  const total = calc.ok ? calc.totalCents : subtotal + fee;

  /* Zona de taxa padrão (qualquer outro endereço de Maringá). */
  const fallbackZone =
    zones.find(
      (z) => normalizeText(z.neighborhood) === normalizeText(OTHER_ZONE_NAME),
    ) ?? null;
  const usingFallback = !!fallbackZone && zoneId === fallbackZone.id;

  /* Zona cujo nome bate (normalizado) com o bairro informado. */
  function findZoneByName(name: string): CatalogDeliveryZone | undefined {
    const wanted = normalizeText(name);
    if (!wanted) return undefined;
    const regular = zones.filter((z) => z.id !== fallbackZone?.id);
    return (
      regular.find((z) => normalizeText(z.neighborhood) === wanted) ??
      regular.find((z) => {
        const n = normalizeText(z.neighborhood);
        return n.includes(wanted) || wanted.includes(n);
      })
    );
  }

  /** Bairro conhecido -> sua zona; senão, a taxa padrão (se cadastrada). */
  function resolveZone(neighborhood: string | null | undefined) {
    const matched = neighborhood ? findZoneByName(neighborhood) : undefined;
    if (matched) return { zone: matched, fallback: false };
    if (fallbackZone) return { zone: fallbackZone, fallback: true };
    return null;
  }

  function fallbackNotice(neighborhood: string | null | undefined): string {
    const fee = fallbackZone
      ? `${formatCents(fallbackZone.feeCents)} • ~${fallbackZone.estimatedMinutes} min`
      : "";
    return neighborhood
      ? `Entregamos em "${neighborhood}" pela taxa padrão (${fee}).`
      : `Entregamos neste endereço pela taxa padrão (${fee}).`;
  }

  /* CEP completo: consulta o ViaCEP, valida a cidade e preenche rua e bairro. */
  async function lookupCep(digits: string) {
    lastCep.current = digits;
    setCepLoading(true);
    setCepMsg(null);
    try {
      const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      if (!response.ok) throw new Error("viacep");
      const data = (await response.json()) as ViaCepResponse;
      if (lastCep.current !== digits) return; // o cliente já digitou outro CEP

      if (data.erro) {
        setCepMsg({
          tone: "warn",
          text: "CEP não encontrado. Confira os números ou preencha manualmente.",
        });
        return;
      }

      if (
        normalizeText(data.localidade ?? "") !==
          normalizeText(SERVICE_CITY.name) ||
        data.uf !== SERVICE_CITY.uf
      ) {
        setCepMsg({
          tone: "warn",
          text: `Entregamos apenas em ${SERVICE_CITY.name}-${SERVICE_CITY.uf}. Este CEP é de ${data.localidade ?? "outra cidade"}${data.uf ? `-${data.uf}` : ""}. Você pode escolher a retirada.`,
        });
        return;
      }

      if (data.logradouro) setStreet(data.logradouro);
      const resolved = resolveZone(data.bairro);
      if (resolved) {
        setZoneId(resolved.zone.id);
        if (resolved.fallback) setOtherNeighborhood(data.bairro ?? "");
        setCepMsg({
          tone: "ok",
          text: resolved.fallback
            ? fallbackNotice(data.bairro)
            : "Endereço encontrado. Confira o número e o complemento.",
        });
      } else {
        setCepMsg({
          tone: "warn",
          text: "Preenchemos a rua. Escolha o bairro na lista abaixo.",
        });
      }
    } catch {
      if (lastCep.current === digits) {
        setCepMsg({
          tone: "warn",
          text: "Não foi possível consultar o CEP agora. Escolha o bairro abaixo.",
        });
      }
    } finally {
      if (lastCep.current === digits) setCepLoading(false);
    }
  }

  /* Rua escolhida na lista: preenche também CEP e bairro. */
  function handleStreetPick(item: StreetSuggestion) {
    setStreet(item.street);
    const formatted = formatCep(item.cep);
    setCep(formatted);
    lastCep.current = formatted.replace(/\D/g, ""); // evita nova consulta do mesmo CEP
    setCepLoading(false);

    const resolved = resolveZone(item.neighborhood);
    if (resolved) {
      setZoneId(resolved.zone.id);
      if (resolved.fallback) setOtherNeighborhood(item.neighborhood);
      setCepMsg({
        tone: "ok",
        text: resolved.fallback
          ? fallbackNotice(item.neighborhood)
          : "Endereço encontrado. Informe o número.",
      });
    } else {
      setCepMsg({
        tone: "warn",
        text: "Preenchemos a rua. Escolha o bairro na lista abaixo.",
      });
    }
  }

  function handleCepChange(value: string) {
    const formatted = formatCep(value);
    setCep(formatted);
    const digits = formatted.replace(/\D/g, "");
    if (digits.length === 8) {
      if (digits !== lastCep.current) void lookupCep(digits);
    } else {
      lastCep.current = "";
      setCepLoading(false);
      setCepMsg(null);
    }
  }

  /* Usa o GPS do aparelho para preencher rua, número e bairro (o cliente confere antes de enviar). */
  function fillFromLocation() {
    setLocationMsg(null);
    if (!("geolocation" in navigator)) {
      setLocationMsg({
        tone: "warn",
        text: "Seu aparelho não permite usar a localização.",
      });
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const response = await fetch(
            `/api/geocode/reverse?lat=${latitude}&lon=${longitude}`,
          );
          if (!response.ok) throw new Error("geocode");
          const found = (await response.json()) as ReverseGeocode;

          if (found.street) setStreet(found.street);
          if (found.number) setNumber(found.number);

          const resolved = resolveZone(found.neighborhood);
          if (resolved) {
            setZoneId(resolved.zone.id);
            if (resolved.fallback)
              setOtherNeighborhood(found.neighborhood ?? "");
          }

          if (!found.street) {
            setLocationMsg({
              tone: "warn",
              text: "Não encontramos a rua neste ponto. Preencha manualmente.",
            });
          } else if (!resolved) {
            setLocationMsg({
              tone: "warn",
              text: "Preenchemos a rua. Escolha o bairro na lista.",
            });
          } else {
            setLocationMsg({
              tone: "ok",
              text: resolved.fallback
                ? fallbackNotice(found.neighborhood)
                : "Endereço preenchido. Confira o número e o complemento.",
            });
          }
        } catch {
          setLocationMsg({
            tone: "warn",
            text: "Não foi possível identificar o endereço. Preencha manualmente.",
          });
        } finally {
          setLocating(false);
        }
      },
      (geoError) => {
        setLocating(false);
        setLocationMsg({
          tone: "warn",
          text:
            geoError.code === geoError.PERMISSION_DENIED
              ? "Permissão de localização negada. Libere nas configurações do navegador ou preencha manualmente."
              : "Não conseguimos obter sua localização. Preencha manualmente.",
        });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!calc.ok) {
      setError(calc.errors.map((e) => e.message).join(" "));
      return;
    }

    try {
      window.localStorage.setItem(
        CUSTOMER_PREFILL_KEY,
        JSON.stringify({ name, phone }),
      );
      window.sessionStorage.setItem(ORDER_PLACED_FLAG, tenantId);
    } catch {
      /* ignorar */
    }

    startTransition(async () => {
      const result = await createOrder({
        customerName: name,
        customerPhone: phone,
        deliveryType,
        deliveryZoneId: deliveryType === "DELIVERY" ? zoneId || null : null,
        street: deliveryType === "DELIVERY" ? street : null,
        number: deliveryType === "DELIVERY" ? number : null,
        complement: deliveryType === "DELIVERY" ? complement || null : null,
        reference:
          deliveryType === "DELIVERY"
            ? [
                usingFallback && otherNeighborhood.trim()
                  ? `Bairro: ${otherNeighborhood.trim().slice(0, 40)}`
                  : "",
                reference.trim(),
              ]
                .filter(Boolean)
                .join(" | ")
                .slice(0, 120) || null
            : null,
        paymentMethod,
        changeForCents,
        notes: combinedNotes || null,
        items,
      });

      // Em sucesso o servidor redireciona; só chegamos aqui em caso de erro.
      if (result && !result.ok) {
        try {
          window.sessionStorage.removeItem(ORDER_PLACED_FLAG);
        } catch {
          /* ignorar */
        }
        const fieldMessages = Object.values(result.fieldErrors ?? {})
          .flat()
          .filter(Boolean)
          .join(" ");
        setError(
          fieldMessages ? `${result.error} ${fieldMessages}` : result.error,
        );
      }
    });
  }

  if (!hydrated) {
    return (
      <div className="flex min-h-[60dvh] justify-center bg-[#F4F6F9] py-20">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="min-h-[60dvh] bg-[#F4F6F9] px-4 py-20 text-center">
        <div className="mx-auto max-w-md space-y-4">
          <p className="text-slate-600">Seu carrinho está vazio.</p>
          <Link
            href="/#cardapio"
            className="inline-flex h-12 items-center justify-center rounded-xl bg-[#F59E0B] px-6 font-bold text-[#0A2540]"
          >
            Ver cardápio
          </Link>
        </div>
      </div>
    );
  }

  const optionClass = (active: boolean) =>
    cn(
      "flex h-12 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition",
      active
        ? "border-[#F59E0B] bg-amber-50 text-[#0A2540]"
        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
    );

  return (
    <div className="min-h-[calc(100dvh-64px)] bg-[#F4F6F9] text-[#0A2540]">
      <nav aria-label="Navegação do checkout" className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-12 max-w-xl items-center px-4">
          <Link
            href="/#cardapio"
            className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-[#0A2540] transition hover:bg-slate-100 active:scale-95"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar ao cardápio
          </Link>
        </div>
      </nav>
      <form
        onSubmit={handleSubmit}
        className="mx-auto max-w-xl space-y-4 px-4 pb-44 pt-6 md:pb-10"
      >
        <h1 className="text-2xl font-extrabold">Finalizar pedido</h1>

        {/* Resumo: retrátil no mobile */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setSummaryOpen((o) => !o)}
            aria-expanded={summaryOpen}
            className="flex w-full items-center justify-between gap-3 p-4 text-left md:cursor-default"
          >
            <span className="font-bold">
              <span className="md:hidden">
                Resumo do pedido ({itemCount}{" "}
                {itemCount === 1 ? "item" : "itens"}) — {formatCents(subtotal)}
              </span>
              <span className="hidden md:inline">Seu pedido</span>
            </span>
            <ChevronDown
              className={cn(
                "h-5 w-5 shrink-0 transition md:hidden",
                summaryOpen && "rotate-180",
              )}
            />
          </button>
          <div
            className={cn(
              "grid transition-[grid-template-rows] duration-300 ease-out md:grid-rows-[1fr]",
              summaryOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
          >
            <div className="min-h-0 overflow-hidden">
            <ul
              className={cn(
                "space-y-2 p-4 text-sm",
                summaryOpen && "border-t border-slate-200",
                "md:border-t md:border-slate-200",
              )}
            >
              {lines.map((l) => (
                <li key={l.key} className="flex justify-between gap-3">
                  <span>
                    {l.quantity}x {l.name}
                    {l.addons.length > 0 ? (
                      <span className="block text-xs text-slate-500">
                        {l.addons
                          .map((a) =>
                            a.quantity > 1
                              ? `${a.quantity}x ${a.name}`
                              : a.name,
                          )
                          .join(", ")}
                      </span>
                    ) : null}
                    {l.note ? (
                      <span className="block text-xs italic text-slate-500">
                        Obs: {l.note}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-semibold">
                    {formatCents(lineTotal(l))}
                  </span>
                </li>
              ))}
            </ul>
            </div>
          </div>
        </section>

        {/* Dados */}
        <section className={cardClass}>
          <h2 className="font-bold">Seus dados</h2>
          <Field label="Nome">
            <Input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </Field>
          <Field label="WhatsApp">
            <Input
              className={inputClass}
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
              inputMode="tel"
              autoComplete="tel"
              placeholder="(11) 99999-8888"
              required
            />
          </Field>
        </section>

        {/* Entrega */}
        <section className={cardClass}>
          <h2 className="font-bold">Como você quer receber?</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className={optionClass(deliveryType === "DELIVERY")}
              onClick={() => setDeliveryType("DELIVERY")}
            >
              <Bike className="h-4 w-4" strokeWidth={1.75} /> Entrega
            </button>
            <button
              type="button"
              className={optionClass(deliveryType === "PICKUP")}
              onClick={() => setDeliveryType("PICKUP")}
            >
              <Store className="h-4 w-4" strokeWidth={1.75} /> Retirada
            </button>
          </div>

          {deliveryType === "DELIVERY" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={fillFromLocation}
                  disabled={locating}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-[#0A2540] transition hover:bg-slate-50 disabled:opacity-60"
                >
                  {locating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LocateFixed className="h-4 w-4" strokeWidth={1.75} />
                  )}
                  {locating
                    ? "Buscando sua localização..."
                    : "Usar minha localização atual"}
                </button>
                {locationMsg ? (
                  <p
                    role="status"
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs",
                      locationMsg.tone === "ok"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-amber-200 bg-amber-50 text-amber-900",
                    )}
                  >
                    {locationMsg.text}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <label
                    htmlFor="checkout-cep"
                    className="text-sm font-medium text-slate-700"
                  >
                    CEP
                  </label>
                  <a
                    href="https://buscacepinter.correios.com.br/app/endereco/index.php"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-slate-500 underline underline-offset-2 hover:text-[#0A2540]"
                  >
                    Não sei meu CEP
                  </a>
                </div>
                <div className="relative">
                  <Input
                    id="checkout-cep"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    placeholder="00000-000"
                    value={cep}
                    onChange={(e) => handleCepChange(e.target.value)}
                    className={cn(inputClass, "pr-10")}
                  />
                  {cepLoading ? (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
                  ) : null}
                </div>
                {cepMsg ? (
                  <p
                    role="status"
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs",
                      cepMsg.tone === "ok"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-amber-200 bg-amber-50 text-amber-900",
                    )}
                  >
                    {cepMsg.text}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <span className="text-sm font-medium text-slate-700">
                  Bairro
                </span>
                <ZoneCombobox
                  zones={zones}
                  value={zoneId}
                  onChange={setZoneId}
                  fallbackId={fallbackZone?.id}
                />
                {zone ? (
                  <p className="text-xs text-slate-500">
                    Entrega: {formatCents(zone.feeCents)} • ~
                    {zone.estimatedMinutes} min
                  </p>
                ) : null}
              </div>
              {usingFallback ? (
                <Field label="Qual é o seu bairro?">
                  <Input
                    className={inputClass}
                    value={otherNeighborhood}
                    onChange={(e) => setOtherNeighborhood(e.target.value)}
                    placeholder="Ex: Parque Industrial 200"
                    required
                  />
                </Field>
              ) : null}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="checkout-street"
                      className="text-sm font-medium text-slate-700"
                    >
                      Rua
                    </label>
                    <StreetAutocomplete
                      id="checkout-street"
                      value={street}
                      onChange={setStreet}
                      onPick={handleStreetPick}
                    />
                  </div>
                </div>
                <Field label="Número">
                  <Input
                    className={inputClass}
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    inputMode="numeric"
                    required
                  />
                </Field>
              </div>
              <Field label="Complemento (opcional)">
                <Input
                  className={inputClass}
                  value={complement}
                  onChange={(e) => setComplement(e.target.value)}
                />
              </Field>
              <Field label="Ponto de referência (opcional)">
                <Input
                  className={inputClass}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
            </div>
          ) : (
            <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              Você retira o pedido diretamente na hamburgueria. Avisaremos pelo
              acompanhamento quando estiver pronto.
            </p>
          )}
        </section>

        {/* Pagamento */}
        <section className={cardClass}>
          <h2 className="font-bold">Pagamento</h2>
          <div className="grid grid-cols-3 gap-3">
            {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((method) => (
              <button
                key={method}
                type="button"
                className={cn(
                  optionClass(paymentMethod === method),
                  "h-14 px-1 text-center text-xs leading-tight",
                )}
                onClick={() => setPaymentMethod(method)}
              >
                {PAYMENT_LABELS[method]}
              </button>
            ))}
          </div>

          {paymentMethod === "CASH" ? (
            <div className="space-y-3 rounded-xl bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-700">
                Troco para quanto?
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={optionClass(noChange)}
                  onClick={() => setNoChange(true)}
                >
                  Não preciso de troco
                </button>
                <button
                  type="button"
                  className={optionClass(!noChange)}
                  onClick={() => setNoChange(false)}
                >
                  Preciso de troco
                </button>
              </div>
              {!noChange ? (
                <Input
                  className={inputClass}
                  value={changeFor}
                  onChange={(e) => setChangeFor(e.target.value)}
                  inputMode="decimal"
                  placeholder="Ex: 100,00"
                  aria-label="Troco para quanto?"
                />
              ) : null}
            </div>
          ) : null}

          {paymentMethod === "PIX" ? (
            <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              Seu pedido ficará aguardando a confirmação do pagamento PIX antes
              de ir para a cozinha.
            </p>
          ) : null}

          <Field label="Observações (opcional)">
            <Textarea
              className={cn(inputClass, "h-auto min-h-24 py-3")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={300}
            />
          </Field>
        </section>

        {/* Totais */}
        <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Subtotal</span>
            <span>{formatCents(subtotal)}</span>
          </div>
          {deliveryType === "DELIVERY" ? (
            <div className="flex justify-between">
              <span className="text-slate-500">Taxa de entrega</span>
              <span>{zone ? formatCents(fee) : "Selecione o bairro"}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-extrabold">
            <span>Total</span>
            <span>{formatCents(total)}</span>
          </div>
        </section>

        {!calc.ok && storeOpen ? (
          <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {calc.errors.map((e, i) => (
              <li key={`${e.code}-${i}`}>{e.message}</li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {/* CTA: fixo na base no mobile */}
        <div className="fixed inset-x-0 bottom-0 z-40 space-y-2 border-t border-slate-200 bg-white p-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] md:static md:z-auto md:border-0 md:bg-transparent md:p-0 md:shadow-none">
          {!storeOpen ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs font-medium text-amber-900">
              A loja está fechada no momento. Não é possível finalizar o pedido
              agora.
            </p>
          ) : null}
          <button
            type="submit"
            disabled={isPending || !storeOpen || !calc.ok}
            className="mx-auto flex h-14 w-full max-w-xl items-center justify-center gap-2 rounded-xl bg-[#F59E0B] text-base font-bold text-[#0A2540] transition hover:brightness-105 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
            {isPending
              ? "Enviando pedido..."
              : `Confirmar pedido • ${formatCents(total)}`}
          </button>
        </div>
      </form>
    </div>
  );
}
