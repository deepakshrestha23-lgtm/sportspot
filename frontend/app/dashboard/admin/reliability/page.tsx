"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AdminEmptyState, AdminPageHeader, AdminPanel, AdminPaginationControls, AdminStatusPill, formatAdminValue, formatDateTime, getAdminStatusTone } from "@/components/admin-dashboard/AdminUi";
import { AdminLoadingScreen } from "@/components/admin-dashboard/AdminDashboardLayout";
import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { AdminAttendanceRecord, AdminPagination } from "@/types/admin";

const inputClass = "min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-sportNavy outline-none transition focus:border-sportGreen focus:ring-2 focus:ring-green-100";
const statusTabs = ["DISPUTED", "NO_SHOW_REPORTED", "ATTENDANCE_PENDING", "UNVERIFIED", "FINALIZED_NO_SHOW", "ALL"] as const;

export default function AdminReliabilityPage() {
  const [records, setRecords] = useState<AdminAttendanceRecord[]>([]);
  const [pagination, setPagination] = useState<AdminPagination | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<(typeof statusTabs)[number]>("DISPUTED");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadRecords = useCallback(async () => {
    setIsLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), page_size: "25", status });
    if (appliedSearch) params.set("q", appliedSearch);
    try {
      const response = await api.get<{ attendance: AdminAttendanceRecord[]; pagination: AdminPagination }>(`/api/admin/reliability/?${params.toString()}`);
      setRecords(response.data.attendance);
      setPagination(response.data.pagination);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load attendance records."));
    } finally {
      setIsLoading(false);
    }
  }, [appliedSearch, page, status]);

  useEffect(() => { void loadRecords(); }, [loadRecords]);

  useEffect(() => {
    if (!isLoading && !error && page > 1 && !records.length && (pagination?.total || 0) > 0) setPage((current) => Math.max(current - 1, 1));
  }, [error, isLoading, page, pagination?.total, records.length]);

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
  }

  async function resolve(record: AdminAttendanceRecord, outcome: "ATTENDED" | "NO_SHOW" | "EXCUSED") {
    const outcomeLabel = outcome === "ATTENDED" ? "attended" : outcome === "NO_SHOW" ? "no-show" : "excused";
    if (!window.confirm(`Resolve ${record.player.name}'s dispute as ${outcomeLabel}? This updates the auditable reliability outcome.`)) return;
    setBusyId(record.id);
    setError("");
    setNotice("");
    try {
      await api.post(`/api/admin/reliability/${record.id}/action/`, { outcome });
      setNotice(`Attendance resolved as ${outcomeLabel}.`);
      await loadRecords();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not resolve this attendance record."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <FeedbackToast message={error || notice} onClose={() => { setError(""); setNotice(""); }} type={error ? "error" : "success"} />
      <AdminPageHeader description="Resolve disputed attendance fairly and keep the reliability ledger explainable. Venue QR check-ins remain context only and never decide player reliability." eyebrow="Trust & safety" title="Reliability review" />

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Reliability safeguards">
        <Safeguard title="Neutral by default" detail="Missing attendance submissions stay unverified and do not reduce reliability." />
        <Safeguard title="Dispute first" detail="A player dispute pauses any no-show penalty until staff review." />
        <Safeguard title="Auditable outcomes" detail="Every decision is recorded through the shared attendance service." />
      </section>

      <AdminPanel className="overflow-visible">
        <form className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5" onSubmit={applySearch}>
          <label className="min-w-0"><span className="sr-only">Search attendance records</span><input className={`w-full ${inputClass}`} onChange={(event) => setSearch(event.target.value)} placeholder="Search player, email, or dispute reason" value={search} /></label>
          <button className="min-h-11 rounded-lg bg-sportGreen px-4 text-sm font-black text-white transition hover:bg-green-700" type="submit">Search records</button>
        </form>
        <nav aria-label="Attendance status" className="flex gap-1 overflow-x-auto border-t border-slate-100 px-4 sm:px-5">
          {statusTabs.map((item) => <button aria-current={status === item ? "page" : undefined} className={`min-h-12 shrink-0 border-b-2 px-3 text-sm font-black transition ${status === item ? "border-sportGreen text-sportGreen" : "border-transparent text-slate-500 hover:text-sportNavy"}`} key={item} onClick={() => { setPage(1); setStatus(item); }} type="button">{item === "ALL" ? "All records" : formatAdminValue(item)}</button>)}
        </nav>
      </AdminPanel>

      <div className="flex items-center justify-between gap-3"><div><p className="sport-eyebrow">Attendance ledger</p><p className="mt-1 text-sm font-bold text-slate-600">{pagination ? `${pagination.total.toLocaleString()} record${pagination.total === 1 ? "" : "s"}` : "Loading records..."}</p></div><button className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-sportNavy transition hover:border-green-200 hover:text-sportGreen" onClick={() => void loadRecords()} type="button">Refresh</button></div>

      {isLoading ? <AdminLoadingScreen label="Loading attendance ledger" /> : null}
      {!isLoading && !error && !records.length ? <AdminPanel><AdminEmptyState description={status === "DISPUTED" ? "Disputed reports pause reliability impact and need a fair staff decision." : "There are no attendance records in this status."} title={status === "DISPUTED" ? "No disputes need review" : "No matching attendance records"} /></AdminPanel> : null}
      {!isLoading && !error && records.length ? <AdminPanel className="overflow-hidden" title="Attendance decisions" description="Review the source event and player explanation before choosing an outcome. QR check-ins are never used as an automatic reliability verdict."><div className="divide-y divide-slate-100">{records.map((record) => <AttendanceRow busy={busyId === record.id} key={record.id} onResolve={(outcome) => void resolve(record, outcome)} record={record} />)}</div><AdminPaginationControls hasMore={pagination?.has_more || false} isLoading={isLoading} onNext={() => setPage((current) => current + 1)} onPrevious={() => setPage((current) => Math.max(current - 1, 1))} page={page} pageSize={pagination?.page_size || 25} total={pagination?.total || 0} /></AdminPanel> : null}
    </div>
  );
}

function AttendanceRow({ record, busy, onResolve }: { record: AdminAttendanceRecord; busy: boolean; onResolve: (outcome: "ATTENDED" | "NO_SHOW" | "EXCUSED") => void }) {
  return <article className="p-5 sm:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><AdminStatusPill tone={getAdminStatusTone(record.status)} value={record.status} /><span className="text-xs font-bold text-slate-400">Game time {formatDateTime(record.start_at)}</span></div><h3 className="mt-3 text-base font-black text-sportNavy">{record.player.name}</h3><p className="mt-1 text-sm font-semibold text-slate-500">{record.player.email} · {record.source_label} · {record.source_detail}</p></div>{record.status === "DISPUTED" ? <div className="flex flex-wrap gap-2"><button className="min-h-10 rounded-lg border border-green-200 bg-white px-3 text-xs font-black text-green-800 transition hover:bg-green-50 disabled:opacity-50" disabled={busy} onClick={() => onResolve("ATTENDED")} type="button">Resolve attended</button><button className="min-h-10 rounded-lg border border-amber-200 bg-white px-3 text-xs font-black text-amber-800 transition hover:bg-amber-50 disabled:opacity-50" disabled={busy} onClick={() => onResolve("EXCUSED")} type="button">Excuse</button><button className="min-h-10 rounded-lg border border-red-200 bg-white px-3 text-xs font-black text-red-700 transition hover:bg-red-50 disabled:opacity-50" disabled={busy} onClick={() => onResolve("NO_SHOW")} type="button">Confirm no-show</button></div> : null}</div><div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.65fr)]"><div className="rounded-lg bg-slate-50 p-4"><p className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">Player explanation</p><p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">{record.dispute_reason || "No dispute explanation was submitted."}</p></div><dl className="grid content-start gap-3 text-sm"><div><dt className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">Attendance report</dt><dd className="mt-1 font-bold text-sportNavy">{record.attendance_recorded_by ? `Recorded by ${record.attendance_recorded_by}` : "No report submitted"}</dd><dd className="mt-1 text-xs font-semibold text-slate-500">{record.attendance_recorded_at ? formatDateTime(record.attendance_recorded_at) : "Neutral deadline path"}</dd></div><div><dt className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">Review status</dt><dd className="mt-1 font-bold text-slate-600">{record.review_deadline_at ? `Review until ${formatDateTime(record.review_deadline_at)}` : record.resolved_by ? `Resolved by ${record.resolved_by}` : "No active review window"}</dd></div></dl></div></article>;
}

function Safeguard({ title, detail }: { title: string; detail: string }) { return <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-sm font-black text-sportNavy">{title}</p><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{detail}</p></article>; }
