export default function MyOrdersLoading() {
  return (
    <div className="min-h-dvh bg-[#071329]" aria-busy="true" aria-label="Carregando seus pedidos">
      <div className="h-20 border-b border-white/10" />

      <div className="px-4 pb-10 pt-8 text-center">
        <div className="mx-auto h-9 w-56 animate-pulse rounded-lg bg-white/10" />
        <div className="mx-auto mt-3 h-4 w-72 max-w-full animate-pulse rounded bg-white/10" />
      </div>

      <div className="min-h-[55dvh] bg-[#F4F6F9] px-4 pb-16 pt-6">
        <div className="mx-auto max-w-lg space-y-4">
          <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
            <div className="h-11 w-full animate-pulse rounded-xl bg-slate-200" />
            <div className="h-11 w-full animate-pulse rounded-xl bg-amber-200/70" />
          </div>
          {[0, 1].map((i) => (
            <div key={i} className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <div className="flex justify-between">
                <div className="h-4 w-28 animate-pulse rounded bg-slate-200" />
                <div className="h-4 w-16 animate-pulse rounded bg-slate-200" />
              </div>
              <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
