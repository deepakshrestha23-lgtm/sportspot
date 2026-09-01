import type { ReactNode } from "react";

export function AdminPageHeader({
  actions,
  description,
  eyebrow = "Admin workspace",
  title,
}: {
  actions?: ReactNode;
  description: string;
  eyebrow?: string;
  title: string;
}) {
  return (
    <header className="flex flex-col gap-5 border-b border-slate-200/80 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="sport-eyebrow">{eyebrow}</p>
        <h1 className="sport-page-title mt-2">{title}</h1>
        <p className="sport-page-description mt-2 max-w-3xl">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function AdminPanel({ children, className = "", title, description }: { children: ReactNode; className?: string; title?: string; description?: string }) {
  return (
    <section className={`admin-panel ${className}`}>
      {title ? <div className="admin-panel-heading"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div></div> : null}
      {children}
    </section>
  );
}

export function AdminListHeader({ eyebrow, title, description, total, action }: { eyebrow: string; title: string; description?: string; total?: ReactNode; action?: ReactNode }) {
  return <div className="admin-list-header"><div className="min-w-0"><p className="sport-eyebrow">{eyebrow}</p><div className="mt-1 flex flex-wrap items-center gap-3"><h2 className="text-lg font-black text-sportNavy sm:text-xl">{title}</h2>{total !== undefined ? <span className="admin-count-badge">{total}</span> : null}</div>{description ? <p className="mt-1 text-sm font-semibold leading-5 text-slate-500">{description}</p> : null}</div>{action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}</div>;
}

export function AdminStatusPill({ value, tone = "neutral" }: { value: string; tone?: "neutral" | "success" | "warning" | "danger" | "info" }) {
  const classes = {
    neutral: "border-slate-200 bg-slate-50 text-slate-600",
    success: "border-green-200 bg-green-50 text-green-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    danger: "border-red-200 bg-red-50 text-red-700",
    info: "border-blue-200 bg-blue-50 text-blue-800",
  }[tone];
  const dotClasses = { neutral: "bg-slate-400", success: "bg-emerald-500", warning: "bg-amber-500", danger: "bg-red-500", info: "bg-blue-500" }[tone];
  return <span className={`admin-status-pill ${classes}`}><span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClasses}`} />{formatAdminValue(value)}</span>;
}

export function AdminEmptyState({ title, description }: { title: string; description: string }) {
  return <div className="admin-empty-state"><span className="admin-empty-icon" aria-hidden="true">✓</span><h2>{title}</h2><p>{description}</p></div>;
}

export function AdminPaginationControls({ page, pageSize = 25, hasMore, total, isLoading = false, onPrevious, onNext }: { page: number; pageSize?: number; hasMore: boolean; total: number; isLoading?: boolean; onPrevious: () => void; onNext: () => void }) {
  if (total <= pageSize && page === 1) return null;
  const firstItem = total ? (page - 1) * pageSize + 1 : 0;
  const lastItem = total ? Math.min(page * pageSize, total) : 0;
  return <nav aria-label="Pagination" className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs font-bold text-slate-500" aria-live="polite">Showing <span className="text-sportNavy">{firstItem.toLocaleString()}-{lastItem.toLocaleString()}</span> of <span className="text-sportNavy">{total.toLocaleString()}</span></p><div className="flex items-center gap-2"><span className="px-2 text-xs font-black text-slate-500" aria-current="page">Page {page}</span><button aria-label="Go to previous page" className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-sportNavy transition hover:border-green-200 hover:text-sportGreen disabled:cursor-not-allowed disabled:opacity-40" disabled={isLoading || page === 1} onClick={onPrevious} type="button">Previous</button><button aria-label="Go to next page" className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-sportNavy transition hover:border-green-200 hover:text-sportGreen disabled:cursor-not-allowed disabled:opacity-40" disabled={isLoading || !hasMore} onClick={onNext} type="button">Next</button></div></nav>;
}

export function formatAdminValue(value: string) {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function getAdminStatusTone(value: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (["APPROVED", "COMPLETED", "PAID", "ACTIVE", "REVIEWED", "ATTENDED", "REFUNDED"].includes(value)) return "success";
  if (["PENDING", "RESERVED", "RECRUITING", "FULL", "NEEDS_CHANGES", "REFUND_PENDING", "ATTENDANCE_PENDING"].includes(value)) return "warning";
  if (["REJECTED", "SUSPENDED", "CANCELLED", "EXPIRED", "FAILED", "DISMISSED", "DISPUTED"].includes(value)) return "danger";
  if (["IN_PROGRESS", "CONFIRMED", "BOOKING_PENDING"].includes(value)) return "info";
  return "neutral";
}

export function formatCompactDate(value: string) {
  return new Intl.DateTimeFormat("en-NP", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-NP", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
