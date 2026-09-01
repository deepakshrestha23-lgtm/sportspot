"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AdminEmptyState, AdminPageHeader, AdminPanel, AdminPaginationControls, AdminStatusPill, formatAdminValue, formatCompactDate, formatDateTime, getAdminStatusTone } from "@/components/admin-dashboard/AdminUi";
import { AdminLoadingScreen } from "@/components/admin-dashboard/AdminDashboardLayout";
import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { AdminOperationItem, AdminPagination } from "@/types/admin";

const inputClass = "min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-sportNavy outline-none transition focus:border-sportGreen focus:ring-2 focus:ring-green-100";
const tabs = [
  { value: "GAMES", label: "Games", statuses: ["DRAFT", "RECRUITING", "FULL", "CLOSED", "BOOKING_PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] },
  { value: "CHALLENGES", label: "Team challenges", statuses: ["OPEN", "COUNTERED", "ACCEPTED_AWAITING_BOOKING", "RECONFIRMATION_REQUIRED", "CONFIRMED", "COMPLETED", "DECLINED", "WITHDRAWN", "EXPIRED", "CANCELLED"] },
  { value: "SCORECARDS", label: "Scorecards", statuses: ["SETUP", "INNINGS_ONE", "INNINGS_BREAK", "INNINGS_TWO", "COMPLETED"] },
] as const;
type OperationType = (typeof tabs)[number]["value"];

export default function AdminOperationsPage() {
  const [operationType, setOperationType] = useState<OperationType>("GAMES");
  const [items, setItems] = useState<AdminOperationItem[]>([]);
  const [pagination, setPagination] = useState<AdminPagination | null>(null);
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const activeTab = tabs.find((tab) => tab.value === operationType) || tabs[0];
  const loadOperations = useCallback(async () => {
    setIsLoading(true);
    setError("");
    const params = new URLSearchParams({ type: operationType, status, page: String(page), page_size: "25" });
    if (appliedSearch) params.set("q", appliedSearch);
    try {
      const response = await api.get<{ items: AdminOperationItem[]; pagination: AdminPagination }>(`/api/admin/operations/?${params.toString()}`);
      setItems(response.data.items);
      setPagination(response.data.pagination);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load platform activity."));
    } finally {
      setIsLoading(false);
    }
  }, [appliedSearch, operationType, page, status]);

  useEffect(() => { void loadOperations(); }, [loadOperations]);

  useEffect(() => {
    if (!isLoading && !error && page > 1 && !items.length && (pagination?.total || 0) > 0) setPage((current) => Math.max(current - 1, 1));
  }, [error, isLoading, items.length, page, pagination?.total]);

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
  }

  function changeType(value: OperationType) {
    setPage(1);
    setStatus("ALL");
    setOperationType(value);
  }

  return (
    <div className="space-y-6">
      <FeedbackToast message={error} onClose={() => setError("")} type="error" />
      <AdminPageHeader description="Inspect game, team-challenge, and scorecard activity without taking over captain, scorer, or player workflows." eyebrow="Platform operations" title="Games & scoring" />
      <AdminPanel className="overflow-visible">
        <nav aria-label="Platform operation type" className="flex gap-1 overflow-x-auto border-b border-slate-100 px-4 sm:px-5">
          {tabs.map((tab) => <button aria-current={operationType === tab.value ? "page" : undefined} className={`min-h-12 shrink-0 border-b-2 px-3 text-sm font-black transition ${operationType === tab.value ? "border-sportGreen text-sportGreen" : "border-transparent text-slate-500 hover:text-sportNavy"}`} key={tab.value} onClick={() => changeType(tab.value)} type="button">{tab.label}</button>)}
        </nav>
        <form className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:p-5" onSubmit={applySearch}>
          <label className="min-w-0"><span className="sr-only">Search platform activity</span><input className={`w-full ${inputClass}`} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${activeTab.label.toLowerCase()}, teams, or people`} value={search} /></label>
          <select aria-label="Filter platform activity status" className={inputClass} onChange={(event) => { setPage(1); setStatus(event.target.value); }} value={status}><option value="ALL">All statuses</option>{activeTab.statuses.map((item) => <option key={item} value={item}>{formatAdminValue(item)}</option>)}</select>
          <button className="min-h-11 rounded-lg bg-sportGreen px-4 text-sm font-black text-white transition hover:bg-green-700" type="submit">Search activity</button>
        </form>
      </AdminPanel>
      <div className="flex items-center justify-between gap-3"><div><p className="sport-eyebrow">Operational monitor</p><p className="mt-1 text-sm font-bold text-slate-600">{pagination ? `${pagination.total.toLocaleString()} ${activeTab.label.toLowerCase()}` : "Loading activity..."}</p></div><button className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-sportNavy transition hover:border-green-200 hover:text-sportGreen" onClick={() => void loadOperations()} type="button">Refresh</button></div>
      {isLoading ? <AdminLoadingScreen label="Loading platform activity" /> : null}
      {!isLoading && !error && !items.length ? <AdminPanel><AdminEmptyState description="Connected game and scoring activity will appear here as players use SportSpot." title={`No ${activeTab.label.toLowerCase()} found`} /></AdminPanel> : null}
      {!isLoading && !error && items.length ? <AdminPanel className="overflow-hidden" title={`${activeTab.label} activity`} description="This monitor is intentionally read-only. Use the source player, captain, venue, or scorer workflow for changes."><div className="divide-y divide-slate-100">{items.map((item) => <OperationRow item={item} key={`${item.kind}-${item.id}`} />)}</div><AdminPaginationControls hasMore={pagination?.has_more || false} isLoading={isLoading} onNext={() => setPage((current) => current + 1)} onPrevious={() => setPage((current) => Math.max(current - 1, 1))} page={page} pageSize={pagination?.page_size || 25} total={pagination?.total || 0} /></AdminPanel> : null}
    </div>
  );
}

function OperationRow({ item }: { item: AdminOperationItem }) {
  return <article className="p-5 sm:p-6"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-[11px] font-black uppercase tracking-[0.1em] text-sportGreen">{formatAdminValue(item.kind)}</span><AdminStatusPill tone={getAdminStatusTone(item.status)} value={item.status} /></div><h3 className="mt-2 break-words text-base font-black text-sportNavy">{item.title}</h3><p className="mt-1 text-sm font-semibold text-slate-500">{item.subtitle} · Managed by {item.owner}</p></div><p className="shrink-0 text-xs font-bold text-slate-400">Updated {formatDateTime(item.updated_at)}</p></div><div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3"><Info label="Schedule" value={formatSchedule(item.schedule)} /><Info label="Location" value={item.location} /><Info label="Context" value={item.meta.join(" · ")} /></div></article>;
}

function Info({ label, value }: { label: string; value: string }) { return <div className="min-w-0 rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-bold leading-5 text-sportNavy">{value}</p></div>; }
function formatSchedule(value: string) { return value.length === 10 ? formatCompactDate(value) : formatDateTime(value); }
