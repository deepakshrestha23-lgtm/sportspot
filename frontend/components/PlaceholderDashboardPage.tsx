export function PlaceholderDashboardPage({ description, title }: { description: string; title: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-black uppercase tracking-wide text-sportGreen">Placeholder</p>
      <h1 className="mt-2 text-3xl font-black text-sportNavy">{title}</h1>
      <p className="mt-3 max-w-2xl text-slate-600">{description}</p>
    </div>
  );
}
