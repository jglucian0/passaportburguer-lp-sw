"use client";

import { Clock, House, Loader2, LocateFixed, MapPin, Pencil, Search, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AddressSuggestion } from "@/core/delivery/address";
import { calculateDeliveryQuote } from "@/core/delivery/quote";
import { Input } from "@/components/ui/input";
import { cn, formatCents } from "@/lib/utils";

import {
  activate,
  canRemove,
  EMPTY_BOOK,
  formatAddressLine,
  loadAddressBook,
  removeAddress,
  saveAndActivate,
  type AddressBook,
  type ConfirmedAddress,
} from "./address-book";
import { loadSavedAddress, type SavedAddress } from "./use-customer";

/* Leaflet só no cliente. */
const AddressMap = dynamic(() => import("./address-map"), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse rounded-xl bg-slate-100" />,
});

const DEBOUNCE_MS = 350;
const MIN_CHARS = 3;

const inputClass =
  "h-12 rounded-xl border-slate-300 bg-white text-base text-slate-900 placeholder:text-slate-400 focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/30";

type Msg = { tone: "ok" | "warn"; text: string };
type Mode = "summary" | "search" | "number" | "map";

function Notice({ msg }: { msg: Msg }) {
  return (
    <p
      role="status"
      className={cn(
        "rounded-lg border px-3 py-2 text-xs",
        msg.tone === "ok"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-amber-200 bg-amber-50 text-amber-900",
      )}
    >
      {msg.text}
    </p>
  );
}

function isCepQuery(q: string): boolean {
  return q.replace(/\D/g, "").length === 8 && /^[\d\s.-]+$/.test(q.trim());
}

/**
 * Seleção de endereço de entrega: busca única (CEP, rua ou bairro), GPS e histórico.
 * Devolve o endereço confirmado (com coordenadas) ou null.
 */
export function AddressPicker({
  value,
  onChange,
  estimatedMinutes,
  defaultAddress = null,
}: {
  value: ConfirmedAddress | null;
  onChange: (address: ConfirmedAddress | null) => void;
  estimatedMinutes?: number | null;
  /** Último endereço usado (servidor): só entra se este aparelho ainda não tem histórico. */
  defaultAddress?: Omit<ConfirmedAddress, "id" | "usedAt"> | null;
}) {
  const [book, setBook] = useState<AddressBook>(EMPTY_BOOK);
  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [locating, setLocating] = useState(false);

  const [pending, setPending] = useState<AddressSuggestion | null>(null);
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [numberError, setNumberError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [mapNote, setMapNote] = useState<Msg | null>(null);
  /** Endereço do perfil (Meu Passaporte): só aparece como opção, nunca é aplicado sozinho. */
  const [profileAddress, setProfileAddress] = useState<SavedAddress | null>(null);
  const [usingProfile, setUsingProfile] = useState(false);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /* Carrega o histórico e já deixa o último endereço usado selecionado. */
  useEffect(() => {
    const loaded = loadAddressBook();
    setBook(loaded);
    setProfileAddress(loadSavedAddress());
    const active = loaded.items.find((i) => i.id === loaded.activeId) ?? null;
    if (!active && defaultAddress) {
      const seeded = saveAndActivate(loaded, defaultAddress);
      setBook(seeded.book);
      onChangeRef.current(seeded.address);
      setMode("summary");
      return;
    }
    if (active) {
      onChangeRef.current(active);
      setMode("summary");
    }
  }, []);

  /* Busca com debounce de 350 ms; cancela a requisição anterior. */
  useEffect(() => {
    if (mode !== "search") return;
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      setResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/address/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as { results?: AddressSuggestion[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "erro");
        setResults(data.results ?? []);
        setMsg(
          (data.results ?? []).length === 0
            ? {
                tone: "warn",
                text: isCepQuery(q)
                  ? "CEP não encontrado. Tente buscar pelo nome da rua."
                  : "Nenhum endereço encontrado. Tente o nome da rua ou o CEP.",
              }
            : null,
        );
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setResults([]);
        setMsg({ tone: "warn", text: "Não foi possível buscar agora. Tente novamente em instantes." });
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, mode]);

  const quote = useMemo(
    () => (value ? calculateDeliveryQuote(value.lat, value.lon, value.city) : null),
    [value],
  );

  function confirm(base: Omit<ConfirmedAddress, "id" | "usedAt">, next: Mode = "summary") {
    const saved = saveAndActivate(book, base);
    setBook(saved.book);
    onChange(saved.address);
    setMode(next);
    setQuery("");
    setResults([]);
    setPending(null);
    setMsg(null);
  }

  function pickSuggestion(s: AddressSuggestion) {
    const q = calculateDeliveryQuote(s.lat, s.lon, s.city);
    if (!q.deliverable) {
      setMsg({ tone: "warn", text: q.message });
      return;
    }
    setMsg(null);

    /* O número já digitado (ou vindo do GPS) pré-preenche a etapa seguinte. */
    setPending(s);
    setNumber(s.number ?? "");
    setComplement("");
    setNumberError(null);
    setMode("number");
  }

  async function submitNumber() {
    if (confirming) return;
    const n = number.trim();
    if (!n) {
      setNumberError("Informe o número (ou S/N).");
      return;
    }
    const src = pending ?? value;
    if (!src) return;

    const base = {
      street: src.street,
      neighborhood: src.neighborhood,
      city: src.city,
      state: src.state,
      postalCode: src.postalCode,
      number: n,
      complement: complement.trim(),
    };

    /* Editando só o complemento: mantém o ponto (que o cliente pode já ter ajustado no mapa). */
    if (!pending && value && n === value.number) {
      confirm({ ...base, lat: value.lat, lon: value.lon });
      return;
    }
    /* GPS com o mesmo número: o ponto do aparelho já é o mais fiel. */
    if (pending?.id.startsWith("gps:") && n === pending.number) {
      setMapNote(null);
      confirm({ ...base, lat: pending.lat, lon: pending.lon }, "map");
      return;
    }

    /* Geocodifica "número + rua + Maringá + PR" para achar o ponto daquela numeração. */
    setConfirming(true);
    let lat = src.lat;
    let lon = src.lon;
    let note: Msg | null = {
      tone: "warn",
      text: "Não localizamos o número exato. Arraste o mapa até o pino ficar em frente ao imóvel.",
    };
    try {
      const res = await fetch(
        `/api/address/geocode?street=${encodeURIComponent(src.street)}&number=${encodeURIComponent(n)}`,
      );
      if (res.ok) {
        const g = (await res.json()) as { lat: number; lon: number; precise: boolean };
        lat = g.lat;
        lon = g.lon;
        note = g.precise
          ? null
          : { tone: "warn", text: "Achamos a rua, mas não o número exato. Ajuste o pino se precisar." };
      }
    } catch {
      /* segue com o ponto da sugestão */
    } finally {
      setConfirming(false);
    }

    setMapNote(note);
    confirm({ ...base, lat, lon }, "map");
  }

  function confirmMapLocation(lat: number, lon: number) {
    if (!value) return;
    confirm(
      {
        street: value.street,
        number: value.number,
        complement: value.complement,
        neighborhood: value.neighborhood,
        city: value.city,
        state: value.state,
        postalCode: value.postalCode,
        lat,
        lon,
      },
      "summary",
    );
  }

  function editCurrent() {
    if (!value) return;
    setPending(null);
    setNumber(value.number);
    setComplement(value.complement);
    setNumberError(null);
    setMode("number");
  }

  function useLocation() {
    setMsg(null);
    if (!("geolocation" in navigator)) {
      setMsg({ tone: "warn", text: "Seu aparelho não permite usar a localização." });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const res = await fetch(`/api/address/reverse?lat=${latitude}&lon=${longitude}`);
          const data = (await res.json()) as { result?: AddressSuggestion; error?: string };
          if (!res.ok || !data.result) {
            setMsg({ tone: "warn", text: data.error ?? "Não foi possível identificar o endereço." });
            return;
          }
          pickSuggestion(data.result);
        } catch {
          setMsg({ tone: "warn", text: "Não foi possível identificar o endereço. Busque pelo nome da rua." });
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        setMsg({
          tone: "warn",
          text:
            err.code === err.PERMISSION_DENIED
              ? "Permissão de localização negada. Libere no navegador ou busque pelo nome da rua."
              : "Não conseguimos obter sua localização. Busque pelo nome da rua.",
        });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  function selectFromHistory(id: string) {
    const { book: next, address } = activate(book, id);
    if (!address) return;
    setBook(next);
    onChange(address);
    setMode("summary");
    setMsg(null);
    setQuery("");
  }

  /** Usa o endereço do perfil: localiza o ponto, completa bairro/cidade e abre a confirmação no mapa. */
  async function selectProfileAddress() {
    if (!profileAddress || usingProfile) return;
    setUsingProfile(true);
    setMsg(null);
    try {
      const geo = await fetch(
        `/api/address/geocode?street=${encodeURIComponent(profileAddress.street)}&number=${encodeURIComponent(profileAddress.number)}`,
      );
      if (!geo.ok) throw new Error("geocode");
      const g = (await geo.json()) as { lat: number; lon: number; precise: boolean };

      /* Bairro, cidade e CEP vêm do ponto encontrado. */
      const rev = await fetch(`/api/address/reverse?lat=${g.lat}&lon=${g.lon}`);
      const place = rev.ok ? ((await rev.json()) as { result?: AddressSuggestion }).result : undefined;
      const city = place?.city || "Maringá";

      const quote = calculateDeliveryQuote(g.lat, g.lon, city);
      if (!quote.deliverable) {
        setMsg({ tone: "warn", text: quote.message });
        return;
      }

      setMapNote(
        g.precise
          ? null
          : { tone: "warn", text: "Achamos a rua, mas não o número exato. Ajuste o pino se precisar." },
      );
      confirm(
        {
          street: profileAddress.street,
          number: profileAddress.number,
          complement: profileAddress.complement ?? "",
          neighborhood: place?.neighborhood ?? "",
          city,
          state: place?.state || "PR",
          postalCode: place?.postalCode ?? "",
          lat: g.lat,
          lon: g.lon,
        },
        "map",
      );
    } catch {
      setMsg({ tone: "warn", text: "Não conseguimos localizar o endereço do perfil. Busque pelo nome da rua." });
    } finally {
      setUsingProfile(false);
    }
  }

  function remove(id: string) {
    const next = removeAddress(book, id);
    if (next === book) return;
    setBook(next);
    if (value?.id === id) {
      onChange(next.items.find((i) => i.id === next.activeId) ?? null);
    }
  }

  /* ---------------------------------------------------------------- */

  if (mode === "summary" && value) {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-3 rounded-xl border border-[#F59E0B]/60 bg-amber-50 px-4 py-3">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#0A2540]" strokeWidth={1.75} />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-[#0A2540]">{formatAddressLine(value)}</p>
            <p className="truncate text-xs text-slate-600">
              {[value.neighborhood, `${value.city} - ${value.state}`].filter(Boolean).join(" • ")}
            </p>
            {quote?.deliverable ? (
              <p className="mt-1 text-xs text-slate-600">
                Entrega: <strong>{formatCents(quote.feeCents)}</strong> • {quote.distanceKm.toFixed(1)} km
                {estimatedMinutes ? ` • ~${estimatedMinutes} min` : ""}
              </p>
            ) : quote ? (
              <p className="mt-1 text-xs font-medium text-red-700">{quote.message}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <button
              type="button"
              onClick={() => {
                setMode("search");
                setMsg(null);
              }}
              className="text-xs font-semibold text-[#0A2540] underline underline-offset-2"
            >
              Alterar
            </button>
            <button
              type="button"
              onClick={() => {
                setMapNote(null);
                setMode("map");
              }}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-[#0A2540]"
            >
              <MapPin className="h-3 w-3" /> Ajustar no mapa
            </button>
            <button
              type="button"
              onClick={editCurrent}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-[#0A2540]"
            >
              <Pencil className="h-3 w-3" /> Editar
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setMode("search");
            setMsg(null);
          }}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-[#0A2540] transition hover:bg-slate-50"
        >
          + Adicionar novo endereço
        </button>
      </div>
    );
  }

  if (mode === "map" && value) {
    return (
      <div className="space-y-3">
        <div className="text-sm">
          <p className="font-semibold text-[#0A2540]">{formatAddressLine(value)}</p>
          <p className="truncate text-xs text-slate-600">
            {[value.neighborhood, `${value.city} - ${value.state}`].filter(Boolean).join(" • ")}
          </p>
        </div>
        {mapNote ? <Notice msg={mapNote} /> : null}
        <AddressMap
          lat={value.lat}
          lon={value.lon}
          city={value.city}
          onConfirm={confirmMapLocation}
          onCancel={() => setMode("summary")}
        />
      </div>
    );
  }

  if (mode === "number") {
    const src = pending ?? value;
    return (
      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#0A2540]" strokeWidth={1.75} />
          <div className="min-w-0">
            <p className="font-semibold text-[#0A2540]">{src?.street}</p>
            <p className="truncate text-xs text-slate-600">
              {[src?.neighborhood, src ? `${src.city} - ${src.state}` : ""].filter(Boolean).join(" • ")}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="col-span-1 block space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Número</span>
            <Input
              className={inputClass}
              value={number}
              onChange={(e) => {
                setNumber(e.target.value);
                setNumberError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitNumber();
                }
              }}
              inputMode="numeric"
              autoFocus
              aria-invalid={!!numberError}
            />
          </label>
          <label className="col-span-2 block space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Complemento / referência (opcional)</span>
            <Input
              className={inputClass}
              value={complement}
              maxLength={80}
              onChange={(e) => setComplement(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitNumber();
                }
              }}
              placeholder="Apto, bloco, ponto de referência"
            />
          </label>
        </div>
        {numberError ? <p className="text-xs font-medium text-red-700">{numberError}</p> : null}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => {
              setPending(null);
              setMode(value ? "summary" : "search");
            }}
            className="h-12 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={submitNumber}
            disabled={confirming}
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#F59E0B] text-sm font-bold text-[#0A2540] transition hover:brightness-95 active:scale-[0.98] disabled:opacity-60"
          >
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirming ? "Localizando..." : "Confirmar endereço"}
          </button>
        </div>
      </div>
    );
  }

  /* mode === "search" */
  /* O endereço do perfil só entra se ainda não estiver no histórico. */
  const norm = (v: string) => v.trim().toLowerCase();
  const profileOption =
    profileAddress &&
    !book.items.some(
      (i) => norm(i.street) === norm(profileAddress.street) && norm(i.number) === norm(profileAddress.number),
    )
      ? profileAddress
      : null;
  const showHistory = query.trim().length < MIN_CHARS && (book.items.length > 0 || profileOption !== null);
  const removable = canRemove(book);
  const history = [...book.items].sort((a, b) => b.usedAt - a.usedAt);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          placeholder="Buscar por CEP, rua ou bairro"
          autoComplete="off"
          aria-label="Buscar endereço de entrega"
          className={cn(inputClass, "pl-10 pr-10")}
        />
        {searching ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
        ) : null}
      </div>

      <button
        type="button"
        onClick={useLocation}
        disabled={locating}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-[#0A2540] transition hover:bg-slate-50 disabled:opacity-60"
      >
        {locating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <LocateFixed className="h-4 w-4" strokeWidth={1.75} />
        )}
        {locating ? "Buscando sua localização..." : "Usar minha localização atual"}
      </button>

      {msg ? <Notice msg={msg} /> : null}

      {results.length > 0 && !showHistory ? (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {results.map((s) => {
            const q = calculateDeliveryQuote(s.lat, s.lon, s.city);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => pickSuggestion(s)}
                  className="flex w-full items-start gap-3 px-3 py-3 text-left transition hover:bg-slate-50"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block font-medium text-[#0A2540]">
                      {s.number ? `${s.street}, ${s.number}` : s.street}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {[s.neighborhood, `${s.city} - ${s.state}`].filter(Boolean).join(" • ")}
                    </span>
                  </span>
                  {q.deliverable ? (
                    <span className="shrink-0 text-xs font-semibold text-emerald-700">
                      {formatCents(q.feeCents)}
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs font-medium text-red-700">Fora da área</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {showHistory ? (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Seus endereços</p>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {profileOption ? (
              <li className="flex items-center">
                <button
                  type="button"
                  onClick={() => void selectProfileAddress()}
                  disabled={usingProfile}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left transition hover:bg-slate-50 disabled:opacity-60"
                >
                  {usingProfile ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />
                  ) : (
                    <House className="h-4 w-4 shrink-0 text-[#0A2540]" strokeWidth={1.75} />
                  )}
                  <span className="min-w-0 text-sm">
                    <span className="block truncate font-medium text-[#0A2540]">
                      {formatAddressLine({
                        street: profileOption.street,
                        number: profileOption.number,
                        complement: profileOption.complement ?? "",
                      })}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      Endereço do seu perfil{profileOption.reference ? ` • ${profileOption.reference}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ) : null}
            {history.map((a) => {
              const isActive = a.id === book.activeId;
              return (
                <li key={a.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => selectFromHistory(a.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left transition hover:bg-slate-50"
                  >
                    {isActive ? (
                      <MapPin className="h-4 w-4 shrink-0 text-[#F59E0B]" strokeWidth={1.75} />
                    ) : (
                      <Clock className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} />
                    )}
                    <span className="min-w-0 text-sm">
                      <span className="block truncate font-medium text-[#0A2540]">{formatAddressLine(a)}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {[a.neighborhood, a.city].filter(Boolean).join(" • ")}
                      </span>
                    </span>
                  </button>
                  {removable ? (
                    <button
                      type="button"
                      onClick={() => remove(a.id)}
                      aria-label={`Excluir endereço ${formatAddressLine(a)}`}
                      className="mr-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {value ? (
        <button
          type="button"
          onClick={() => {
            setMode("summary");
            setMsg(null);
            setQuery("");
          }}
          className="text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-[#0A2540]"
        >
          Cancelar
        </button>
      ) : null}
    </div>
  );
}
