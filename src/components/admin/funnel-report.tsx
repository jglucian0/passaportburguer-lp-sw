import type { FunnelReport } from "@/infra/marketing/funnel-report";

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

/** Funil do cardápio e vendas por produto. Só leitura. */
export function FunnelReportView({ report }: { report: FunnelReport }) {
  const steps = [
    { label: "Visitaram o cardápio", value: report.visitors },
    { label: "Abriram um produto", value: report.viewedProduct },
    { label: "Colocaram no carrinho", value: report.addedToCart },
    { label: "Chegaram ao checkout", value: report.reachedCheckout },
    { label: "Pedidos feitos pelo site", value: report.siteOrders },
  ];
  const top = Math.max(1, ...steps.map((s) => s.value));

  return (
    <div className="mx-auto mt-6 max-w-4xl space-y-6">
      <section className={card}>
        <h2 className="text-lg font-bold text-slate-900">Funil do cardápio (últimos {report.days} dias)</h2>
        <p className="mt-1 text-xs text-slate-500">
          Visitantes únicos em cada etapa. Os pedidos do site contam só os feitos depois da ativação do rastreio de origem; os do
          WhatsApp ({report.allOrders - report.siteOrders} no período) não passam por aqui.
        </p>
        <ul className="mt-4 space-y-3">
          {steps.map((s, i) => (
            <li key={s.label}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-slate-800">{s.label}</span>
                <span className="font-bold text-slate-900">
                  {s.value}
                  {i > 0 ? <span className="ml-2 text-xs font-normal text-slate-500">{pct(s.value, steps[i - 1].value)} da etapa anterior</span> : null}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-amber-500" style={{ width: `${Math.max(2, Math.round((s.value / top) * 100))}%` }} />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-slate-600">
          Conversão de visita em pedido no site: <strong>{pct(report.siteOrders, report.visitors)}</strong>
        </p>
      </section>

      <section className={card}>
        <h2 className="text-lg font-bold text-slate-900">Vendas por produto</h2>
        {report.products.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Ainda não há dados no período.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Produto</th>
                  <th className="py-2 pr-3 text-right">Abriram</th>
                  <th className="py-2 pr-3 text-right">No carrinho</th>
                  <th className="py-2 pr-3 text-right">Vendidos</th>
                  <th className="py-2 text-right">Faturamento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.products.map((p) => (
                  <tr key={p.name}>
                    <td className="py-2 pr-3 font-semibold text-slate-900">{p.name}</td>
                    <td className="py-2 pr-3 text-right">{p.views}</td>
                    <td className="py-2 pr-3 text-right">
                      {p.carts} <span className="text-xs text-slate-400">({pct(p.carts, p.views)})</span>
                    </td>
                    <td className="py-2 pr-3 text-right">{p.units}</td>
                    <td className="py-2 text-right">{brl(p.revenueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">
          &quot;Abriram&quot; e &quot;No carrinho&quot; vêm só do site; &quot;Vendidos&quot; soma todos os canais. Muita gente abrindo e pouca no carrinho indica foto,
          descrição ou preço a rever.
        </p>
        {report.unsold.length > 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            <strong>Sem nenhuma venda no período:</strong> {report.unsold.join(", ")}.
          </p>
        ) : null}
      </section>
    </div>
  );
}
