import type { ReactNode } from "react";

export function DashboardPageHeader({
  actions,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  description: string;
  eyebrow?: string;
  title: string;
}) {
  return (
    <header className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="text-xs font-black uppercase tracking-wide text-sportGreen">{eyebrow}</p> : null}
        <h1 className="mt-1 text-2xl font-black tracking-tight text-sportNavy sm:text-3xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
