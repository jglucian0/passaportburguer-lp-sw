"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SERVICE_CITY } from "@/core/store/maringa-zones";
import { cn } from "@/lib/utils";

import { normalizeText } from "./zone-combobox";

export type StreetSuggestion = {
  cep: string;
  street: string;
  neighborhood: string;
};

type ViaCepItem = {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

const MIN_CHARS = 3;
const DEBOUNCE_MS = 350;
const MAX_RESULTS = 8;

/**
 * Campo de rua com sugestões de Maringá (busca por logradouro no ViaCEP).
 * Ao escolher uma sugestão, devolve rua, bairro e CEP para preencher o resto.
 */
export function StreetAutocomplete({
  value,
  onChange,
  onPick,
  className,
  id,
}: {
  value: string;
  onChange: (text: string) => void;
  onPick: (suggestion: StreetSuggestion) => void;
  className?: string;
  id?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<StreetSuggestion[]>([]);
  const skipNext = useRef(false); // evita nova busca logo após escolher uma sugestão

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }

    const query = value.trim();
    if (query.length < MIN_CHARS) {
      setItems([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const url = `https://viacep.com.br/ws/${SERVICE_CITY.uf}/${encodeURIComponent(SERVICE_CITY.name)}/${encodeURIComponent(query)}/json/`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("viacep");
        const data = (await response.json()) as ViaCepItem[];
        if (cancelled || !Array.isArray(data)) return;

        const seen = new Set<string>();
        const list: StreetSuggestion[] = [];
        for (const item of data) {
          if (!item.logradouro || !item.cep) continue;
          if (normalizeText(item.localidade ?? "") !== normalizeText(SERVICE_CITY.name)) continue;
          const key = `${normalizeText(item.logradouro)}|${normalizeText(item.bairro ?? "")}`;
          if (seen.has(key)) continue;
          seen.add(key);
          list.push({
            cep: item.cep,
            street: item.logradouro,
            neighborhood: item.bairro ?? "",
          });
          if (list.length >= MAX_RESULTS) break;
        }
        setItems(list);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function pick(item: StreetSuggestion) {
    skipNext.current = true;
    setOpen(false);
    setItems([]);
    onPick(item);
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        id={id}
        type="text"
        value={value}
        required
        autoComplete="off"
        placeholder="Digite o nome da rua"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className={cn(
          "h-12 w-full rounded-xl border border-slate-300 bg-white px-3 pr-9 text-base text-slate-900 placeholder:text-slate-400 focus:border-[#F59E0B] focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/30",
          className,
        )}
      />
      {loading ? (
        <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
      ) : null}

      {open && items.length > 0 ? (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white shadow-lg"
        >
          {items.map((item) => (
            <li
              key={`${item.cep}-${item.street}-${item.neighborhood}`}
              role="option"
              aria-selected={false}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(item)}
              className="cursor-pointer px-4 py-3 hover:bg-amber-50"
            >
              <p className="truncate font-bold text-slate-900">{item.street}</p>
              <p className="truncate text-xs text-slate-500">
                {item.neighborhood ? `${item.neighborhood} • ` : ""}
                {item.cep}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
