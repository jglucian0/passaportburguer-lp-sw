"use client";

import { useEffect } from "react";

import { funnelEvent } from "@/lib/track";

const SESSION_FLAG = "pb_visit";

/** Conta uma visita ao cardápio por sessão do navegador (início do funil). */
export function FunnelVisit() {
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(SESSION_FLAG)) return;
      window.sessionStorage.setItem(SESSION_FLAG, "1");
    } catch {
      /* sem sessionStorage: conta a visita mesmo assim */
    }
    funnelEvent("VISIT");
  }, []);
  return null;
}
