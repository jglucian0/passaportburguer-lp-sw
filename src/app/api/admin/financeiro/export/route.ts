import { NextResponse } from "next/server";

import { getActiveAdminSession as getAdminSession } from "@/infra/auth/active-session";
import { FINANCE_PERIOD_LABELS, loadFinanceReport, parseFinancePeriod } from "@/infra/db/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAYMENT_LABELS: Record<string, string> = {
  PIX: "PIX",
  CARD_ON_DELIVERY: "Cartão (crédito/débito)",
  CASH: "Dinheiro",
};

/** Evita injeção de fórmula no Excel e escapa para CSV (separador ";"). */
function cell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const reais = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/** Exporta o fechamento do período (somente OWNER). */
export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (session.role !== "OWNER") return NextResponse.json({ error: "Sem permissão." }, { status: 403 });

  const period = parseFinancePeriod(new URL(request.url).searchParams.get("periodo") ?? undefined);
  const r = await loadFinanceReport(session.tenantId, period);

  const rows: (string | number)[][] = [
    ["Fechamento financeiro", FINANCE_PERIOD_LABELS[period], `Desde ${r.from}`],
    [],
    ["Indicador", "Valor"],
    ["Faturamento total (R$)", reais(r.revenueCents)],
    ["Pedidos concluídos", r.completedOrders],
    ["Ticket médio (R$)", reais(r.averageTicketCents)],
    ["Pedidos cancelados", r.canceledOrders],
    [],
    ["Forma de pagamento", "Pedidos", "Total (R$)"],
    ...r.byPayment.map((p) => [PAYMENT_LABELS[p.method] ?? p.method, p.orders, reais(p.revenueCents)]),
    [],
    ["Top 5 mais vendidos", "Quantidade", "Total (R$)"],
    ...r.topProducts.map((t) => [t.name, t.quantity, reais(t.revenueCents)]),
  ];

  const csv = "﻿" + rows.map((row) => row.map(cell).join(";")).join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="financeiro-${period}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
