import { Ban, CircleDollarSign, Download, Receipt, ShoppingBag, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AdminShell } from "@/components/admin/admin-shell";
import { buttonVariants } from "@/components/ui/button";
import type { PaymentMethod } from "@/core/schemas/common";
import { requireOwner } from "@/infra/auth/admin-guard";
import {
  FINANCE_PERIOD_LABELS,
  loadFinanceReport,
  parseFinancePeriod,
  type FinancePeriod,
} from "@/infra/db/finance";
import { cn, formatCents } from "@/lib/utils";

export const metadata: Metadata = { title: "Financeiro | Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * O schema só distingue "cartão na entrega" (não separa crédito de débito), então a linha de cartão
 * é única. Separar exigiria coletar a modalidade no checkout.
 */
const PAYMENT_ROWS: { method: PaymentMethod; label: string }[] = [
  { method: "PIX", label: "PIX" },
  { method: "CARD_ON_DELIVERY", label: "Cartão (crédito/débito)" },
  { method: "CASH", label: "Dinheiro" },
];

const PERIODS: FinancePeriod[] = ["today", "7d", "month"];

const PREVIOUS_LABEL: Record<FinancePeriod, string> = {
  today: "ontem",
  "7d": "7 dias anteriores",
  month: "mês anterior",
};

function Delta({ current, previous, inverse, label }: { current: number; previous: number; inverse?: boolean; label: string }) {
  if (previous === 0 && current === 0) return <p className="mt-2 text-xs text-slate-400">Sem dados em {label}</p>;
  if (previous === 0) return <p className="mt-2 text-xs text-slate-400">Novo vs. {label}</p>;
  const pct = ((current - previous) / previous) * 100;
  const rounded = Math.round(pct);
  const up = pct > 0;
  const good = inverse ? !up : up;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <p
      className={cn(
        "mt-2 flex items-center gap-1 text-xs font-semibold",
        rounded === 0 ? "text-slate-500" : good ? "text-emerald-700" : "text-rose-700",
      )}
    >
      {rounded !== 0 ? <Icon className="h-3.5 w-3.5" /> : null}
      {rounded > 0 ? "+" : ""}
      {rounded}% <span className="font-normal text-slate-400">vs. {label}</span>
    </p>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  tone,
  current,
  previous,
  inverse,
  compareLabel,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: string;
  current: number;
  previous: number;
  inverse?: boolean;
  compareLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tone)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-extrabold tabular-nums">{value}</p>
      <Delta current={current} previous={previous} inverse={inverse} label={compareLabel} />
    </div>
  );
}

export default async function AdminFinancePage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  // Somente OWNER: KITCHEN é redirecionada para /admin/pedidos.
  const session = await requireOwner();

  const period = parseFinancePeriod((await searchParams).periodo);
  const report = await loadFinanceReport(session.tenantId, period);
  const prev = report.previous;
  const compareLabel = PREVIOUS_LABEL[period];

  const byMethod = new Map(report.byPayment.map((row) => [row.method, row]));
  const maxQty = Math.max(1, ...report.topProducts.map((p) => p.quantity));

  return (
    <AdminShell userName={session.name} role={session.role}>
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold">Financeiro</h1>
            <p className="text-xs text-muted">
              Faturamento considera apenas pedidos entregues (valor total, com taxa de entrega).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <nav className="flex rounded-xl border border-slate-200 bg-white p-1" aria-label="Período">
              {PERIODS.map((p) => (
                <Link
                  key={p}
                  href={`/admin/financeiro?periodo=${p}`}
                  aria-current={p === period ? "page" : undefined}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-semibold transition",
                    p === period ? "bg-brand text-black" : "text-muted hover:text-foreground",
                  )}
                >
                  {FINANCE_PERIOD_LABELS[p]}
                </Link>
              ))}
            </nav>
            <a
              href={`/api/admin/financeiro/export?periodo=${period}`}
              download
              className={buttonVariants({ variant: "outline", size: "sm", className: "bg-white" })}
            >
              <Download className="h-4 w-4" /> Exportar CSV
            </a>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric
            label="Faturamento total"
            value={formatCents(report.revenueCents)}
            icon={CircleDollarSign}
            tone="bg-emerald-50 text-emerald-700"
            current={report.revenueCents}
            previous={prev.revenueCents}
            compareLabel={compareLabel}
          />
          <Metric
            label="Pedidos concluídos"
            value={String(report.completedOrders)}
            icon={ShoppingBag}
            tone="bg-sky-50 text-sky-700"
            current={report.completedOrders}
            previous={prev.completedOrders}
            compareLabel={compareLabel}
          />
          <Metric
            label="Ticket médio"
            value={formatCents(report.averageTicketCents)}
            icon={Receipt}
            tone="bg-amber-50 text-amber-700"
            current={report.averageTicketCents}
            previous={prev.averageTicketCents}
            compareLabel={compareLabel}
          />
          <Metric
            label="Pedidos cancelados"
            value={String(report.canceledOrders)}
            icon={Ban}
            tone="bg-rose-50 text-rose-700"
            current={report.canceledOrders}
            previous={prev.canceledOrders}
            inverse
            compareLabel={compareLabel}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b border-slate-200 px-4 py-3 font-extrabold">Fechamento por forma de pagamento</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Forma</th>
                  <th className="px-2 py-2 text-right font-semibold">Pedidos</th>
                  <th className="px-4 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {PAYMENT_ROWS.map(({ method, label }) => {
                  const row = byMethod.get(method);
                  return (
                    <tr key={method}>
                      <td className="px-4 py-2.5 font-medium">{label}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{row?.orders ?? 0}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                        {formatCents(row?.revenueCents ?? 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50 font-extrabold">
                <tr>
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{report.completedOrders}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(report.revenueCents)}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b border-slate-200 px-4 py-3 font-extrabold">Top 5 lanches mais vendidos</h2>
            {report.topProducts.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted">Sem vendas no período.</p>
            ) : (
              <ol className="divide-y divide-slate-100">
                {report.topProducts.map((product, index) => (
                  <li key={product.name} className="space-y-1.5 px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate text-sm font-semibold">
                        <span className="mr-2 text-amber-600">{index + 1}º</span>
                        {product.name}
                      </p>
                      <p className="shrink-0 text-sm tabular-nums">
                        <span className="font-bold">{product.quantity}</span>{" "}
                        <span className="text-xs text-muted">un • {formatCents(product.revenueCents)}</span>
                      </p>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-amber-500"
                        style={{ width: `${(product.quantity / maxQty) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </AdminShell>
  );
}
