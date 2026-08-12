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
    <header className="sport-page-header">
      <div className="min-w-0">
        {eyebrow ? <p className="sport-eyebrow">{eyebrow}</p> : null}
        <h1 className="sport-page-title">{title}</h1>
        <p className="sport-page-description">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
