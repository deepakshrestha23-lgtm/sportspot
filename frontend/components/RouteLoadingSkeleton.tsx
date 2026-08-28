export function DashboardRouteLoading() {
  return (
    <section aria-busy="true" aria-label="Loading page" className="mx-auto w-full max-w-7xl space-y-5 px-4 py-8 sm:px-6 lg:px-8">
      <div className="h-8 w-64 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <div className="h-28 animate-pulse rounded-2xl bg-white shadow-sm" key={item} />)}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)]">
        <div className="h-72 animate-pulse rounded-2xl bg-white shadow-sm" />
        <div className="h-72 animate-pulse rounded-2xl bg-white shadow-sm" />
      </div>
    </section>
  );
}

export function PublicRouteLoading({ title = "Loading" }: { title?: string }) {
  return (
    <main aria-busy="true" aria-label={`${title} page loading`} className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="h-9 w-72 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-slate-200" />
        <div className="h-24 animate-pulse rounded-2xl bg-white shadow-sm" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((item) => <div className="h-80 animate-pulse rounded-2xl bg-white shadow-sm" key={item} />)}
        </div>
      </div>
    </main>
  );
}
