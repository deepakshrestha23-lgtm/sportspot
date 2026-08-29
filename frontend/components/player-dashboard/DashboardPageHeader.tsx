import type { ReactNode } from "react";

import BackButton from "@/components/BackButton";

export function DashboardPageHeader({
  actions,
  backHref,
  backLabel,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  description: string;
  eyebrow?: string;
  title: string;
}) {
  return (
    <header className="sport-page-header">
      <div className="min-w-0">
        {backHref ? <BackButton href={backHref} label={backLabel} /> : null}
        {eyebrow ? <p className="sport-eyebrow">{eyebrow}</p> : null}
        <h1 className="sport-page-title">{title}</h1>
        <p className="sport-page-description">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
