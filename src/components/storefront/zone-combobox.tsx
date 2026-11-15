"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { CatalogDeliveryZone } from "@/core/schemas/product";
import { cn, formatCents } from "@/lib/utils";

export function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Seletor pesquisável de bairros: digitar "alv" ou "zona" filtra em tempo real
 * (sem acento, sem diferenciar maiúsculas) e cada opção mostra taxa e tempo.
 */
export function ZoneCombobox({
  zones,
  value,
  onChange,
  inputClassName,
  fallbackId,
}: {
  zones: CatalogDeliveryZone[];
  value: string;
  onChange: (zoneId: string) => void;
  inputClassName?: string;
  /** Zona de taxa padrão: oferecida quando nenhum bairro bate com a busca. */
  fallbackId?: string;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = zones.find((z) => z.id === value) ?? null;

  const [open, setOpen] = useState(false);
  const [text, setText] = useState(selected?.neighborhood ?? "");
  const [typing, setTyping] = useState(false);
  const [highlight, setHighlight] = useState(0);

  /* Seleção vinda de fora (CEP, GPS): reflete no campo. */
  useEffect(() => {
    setText(selected?.neighborhood ?? "");
    setTyping(false);
  }, [selected?.neighborhood]);

  const fallback = fallbackId
    ? (zones.find((z) => z.id === fallbackId) ?? null)
    : null;

  const options = useMemo(() => {
    const query = normalizeText(text);
    if (!typing || !query) return zones;
    const found = zones.filter((z) =>
      normalizeText(z.neighborhood).includes(query),
    );
    // Sem resultado: oferece a taxa padrão para qualquer outro bairro.
    return found.length === 0 && fallback ? [fallback] : found;
  }, [zones, text, typing, fallback]);

  function close() {
    setOpen(false);
    setTyping(false);
    setText(selected?.neighborhood ?? "");
  }

  /* Fecha ao clicar/tocar fora. */
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selected?.neighborhood]);

  useEffect(() => {
    listRef.current?.children[highlight]?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  function choose(zone: CatalogDeliveryZone) {
    onChange(zone.id);
    setText(zone.neighborhood);
    setTyping(false);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(options.length - 1, h + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (event.key === "Enter" && open && options[highlight]) {
      event.preventDefault();
      choose(options[highlight]);
    } else if (event.key === "Escape") {
      close();
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={text}
        required
        placeholder="Digite para buscar seu bairro"
        onFocus={(e) => {
          setOpen(true);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          setTyping(true);
          setHighlight(0);
          setOpen(true);
          if (value) onChange("");
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          "h-12 w-full rounded-xl border border-slate-300 bg-white pl-3 pr-10 text-base text-slate-900 placeholder:text-slate-400 focus:border-[#F59E0B] focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/30",
          inputClassName,
        )}
      />
      <ChevronDown
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 transition",
          open && "rotate-180",
        )}
      />

      {open ? (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white shadow-lg [-webkit-overflow-scrolling:touch]"
        >
          {options.length === 0 ? (
            <li className="px-4 py-3 text-sm text-slate-500">
              Nenhum bairro encontrado. Confira a grafia ou escolha a opção de
              retirada.
            </li>
          ) : (
            options.map((zone, index) => (
              <li
                key={zone.id}
                role="option"
                aria-selected={zone.id === value}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(zone)}
                onMouseEnter={() => setHighlight(index)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 px-4 py-3",
                  index === highlight && "bg-amber-50",
                )}
              >
                <span className="min-w-0 truncate font-bold text-slate-900">
                  {zone.id === fallbackId && typing
                    ? `Meu bairro não está na lista (${zone.neighborhood})`
                    : zone.neighborhood}
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {formatCents(zone.feeCents)} • ~{zone.estimatedMinutes} min
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
