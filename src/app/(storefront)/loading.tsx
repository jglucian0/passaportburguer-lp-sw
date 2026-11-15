export default function StorefrontLoading() {
  return (
    <div className="min-h-dvh bg-[#071329]" aria-busy="true" aria-label="Carregando">
      <div className="h-20 border-b border-white/10" />

      <div className="px-4 py-10">
        <div className="mx-auto max-w-5xl space-y-4">
          <div className="h-10 w-3/4 max-w-md animate-pulse rounded-lg bg-white/10" />
          <div className="h-4 w-2/3 max-w-sm animate-pulse rounded bg-white/10" />
          <div className="h-44 w-full animate-pulse rounded-2xl bg-white/10" />
        </div>
      </div>

      <div className="min-h-[60dvh] bg-[#F4F6F9] px-4 py-6">
        <div className="mx-auto max-w-5xl space-y-4">
          <div className="flex gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-9 w-24 animate-pulse rounded-full bg-slate-200" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white p-4">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
                  <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
                  <div className="h-3 w-3/4 animate-pulse rounded bg-slate-100" />
                  <div className="h-4 w-16 animate-pulse rounded bg-slate-200" />
                </div>
                <div className="h-28 w-28 shrink-0 animate-pulse rounded-xl bg-slate-200" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
