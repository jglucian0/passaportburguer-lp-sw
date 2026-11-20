import type { RecoveryReport } from "@/infra/marketing/recovery-report";
import type { SalesBySource } from "@/infra/marketing/attribution";

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

/** Origem das vendas (anúncios, Instagram...) e resultado da recuperação de clientes. Só leitura. */
export function MarketingReports({ sales, recovery }: { sales: SalesBySource[]; recovery: RecoveryReport }) {
  const total = sales.reduce((s, r) => s + r.revenueCents, 0);
  const orders = sales.reduce((s, r) => s + r.orders, 0);

  return (
    <div className="mx-auto mt-6 max-w-4xl space-y-6">
      <section className={card}>
        <h2 className="text-lg font-bold text-slate-900">Origem das vendas (últimos {recovery.days} dias)</h2>
        <p className="mt-1 text-xs text-slate-500">
          Vem dos links com UTM (ex.: <code>?utm_source=instagram&amp;utm_medium=paid&amp;utm_campaign=burger-do-mes</code>), dos anúncios de
          clique para o WhatsApp e do site de origem. Pedidos sem origem aparecem como &quot;direto&quot;.
        </p>
        {sales.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">Ainda não há pedidos no período.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Origem</th>
                  <th className="py-2 pr-3">Meio</th>
                  <th className="py-2 pr-3">Campanha</th>
                  <th className="py-2 pr-3 text-right">Pedidos</th>
                  <th className="py-2 pr-3 text-right">Vendas</th>
                  <th className="py-2 text-right">Ticket</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sales.map((r) => (
                  <tr key={`${r.source}|${r.medium}|${r.campaign}`}>
                    <td className="py-2 pr-3 font-semibold text-slate-900">{r.source}</td>
                    <td className="py-2 pr-3 text-slate-600">{r.medium || "—"}</td>
                    <td className="py-2 pr-3 text-slate-600">{r.campaign || "—"}</td>
                    <td className="py-2 pr-3 text-right">{r.orders}</td>
                    <td className="py-2 pr-3 text-right">{brl(r.revenueCents)}</td>
                    <td className="py-2 text-right text-slate-600">{brl(Math.round(r.revenueCents / Math.max(1, r.orders)))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold">
                  <td className="py-2" colSpan={3}>
                    Total
                  </td>
                  <td className="py-2 pr-3 text-right">{orders}</td>
                  <td className="py-2 pr-3 text-right">{brl(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className="text-lg font-bold text-slate-900">Recuperação de clientes (últimos {recovery.days} dias)</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-100 p-4">
            <p className="text-xs uppercase text-slate-500">Convites a quem não pediu</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">{recovery.chatInvites}</p>
            <p className="mt-1 text-xs text-slate-500">Mensagem ~40 min depois de o cliente falar e não pedir.</p>
          </div>
          <div className="rounded-xl border border-slate-100 p-4">
            <p className="text-xs uppercase text-slate-500">Pagamentos recuperados</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">
              {recovery.paymentRecovered} <span className="text-sm font-medium text-slate-500">de {recovery.paymentReminders} lembretes</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">{brl(recovery.paymentRecoveredCents)} em pedidos que estavam sem pagar.</p>
          </div>
          <div className="rounded-xl border border-slate-100 p-4">
            <p className="text-xs uppercase text-slate-500">Resgate de clientes sumidos</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">
              {recovery.winbackOrders} <span className="text-sm font-medium text-slate-500">de {recovery.winbackSent} envios</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">{brl(recovery.winbackCents)} em pedidos com o cupom do resgate.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
