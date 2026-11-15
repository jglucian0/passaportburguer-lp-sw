export default function CheckoutLoading() {
  return (
    <div className="min-h-dvh bg-[#F4F6F9]" aria-busy="true" aria-label="Carregando">
      <div className="h-16 border-b border-slate-200 bg-white" />
      <div className="mx-auto max-w-xl space-y-4 px-4 pt-6">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-16 w-full animate-pulse rounded-xl bg-white" />
        <div className="h-48 w-full animate-pulse rounded-xl bg-white" />
      </div>
    </div>
  );
}
