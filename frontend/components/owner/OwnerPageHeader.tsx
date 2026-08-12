import type { ReactNode } from "react";

export function OwnerDashboardContent({ children }: { children: ReactNode }) {
  return <div className="sport-page-content">{children}</div>;
}

export function OwnerPageHeader({
  actions,
  description,
  eyebrow = "Dashboard",
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
        <p className="sport-eyebrow">{eyebrow}</p>
        <h1 className="sport-page-title">{title}</h1>
        <p className="sport-page-description max-w-3xl">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
