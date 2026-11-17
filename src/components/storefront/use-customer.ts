"use client";

import { useEffect, useState } from "react";

import { CUSTOMER_PREFILL_KEY } from "./cart-storage";

export const CUSTOMER_CHANGE_EVENT = "pb:customer-change";

type Stored = { name?: string; phone?: string };

function read(): Stored {
  try {
    const raw = window.localStorage.getItem(CUSTOMER_PREFILL_KEY);
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {};
  }
}

/** Persiste nome/telefone do cliente (localStorage) e avisa header/tab bar. */
export function saveCustomer(patch: Stored): void {
  try {
    window.localStorage.setItem(CUSTOMER_PREFILL_KEY, JSON.stringify({ ...read(), ...patch }));
  } catch {
    /* armazenamento indisponível: a sessão segue só pelo cookie */
  }
  window.dispatchEvent(new Event(CUSTOMER_CHANGE_EVENT));
}

/** Endereço de entrega salvo no perfil (localStorage); o checkout usa para auto-preencher. */
export type SavedAddress = {
  zoneId: string;
  street: string;
  number: string;
  complement: string;
  reference: string;
};

const ADDRESS_KEY = "pb:address";

export function loadSavedAddress(): SavedAddress | null {
  try {
    const raw = window.localStorage.getItem(ADDRESS_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Partial<SavedAddress>;
    if (!a.street || !a.number) return null;
    return {
      zoneId: a.zoneId ?? "",
      street: a.street,
      number: a.number,
      complement: a.complement ?? "",
      reference: a.reference ?? "",
    };
  } catch {
    return null;
  }
}

export function saveAddress(address: SavedAddress | null): void {
  try {
    if (address) window.localStorage.setItem(ADDRESS_KEY, JSON.stringify(address));
    else window.localStorage.removeItem(ADDRESS_KEY);
  } catch {
    /* armazenamento indisponível */
  }
}

/** Primeiro nome do cliente identificado (ou null). Reage a mudanças de sessão. */
export function useCustomerFirstName(): string | null {
  const [firstName, setFirstName] = useState<string | null>(null);

  useEffect(() => {
    function sync() {
      const name = read().name?.trim();
      setFirstName(name ? name.split(/\s+/)[0] : null);
    }
    sync();
    window.addEventListener(CUSTOMER_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CUSTOMER_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return firstName;
}
