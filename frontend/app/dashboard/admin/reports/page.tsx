"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AdminEmptyState, AdminPageHeader, AdminPanel, AdminPaginationControls, AdminStatusPill, formatAdminValue, formatDateTime, getAdminStatusTone } from "@/components/admin-dashboard/AdminUi";
import { AdminLoadingScreen } from "@/components/admin-dashboard/AdminDashboardLayout";
import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { AdminPagination, AdminReport } from "@/types/admin";

const inputClass = "min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-sportNavy outline-none transition focus:border-sportGreen focus:ring-2 focus:ring-green-100";
const tabValues = ["OPEN", "REVIEWED", "DISMISSED"] as const;

export default function AdminReportsPage() {
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [pagination, setPagination] = useState<AdminPagination | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<(typeof tabValues)[number]>("OPEN");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadReports = useCallback(async () => {
    setIsLoading(true);
    setError("");
    const params = new URLSearchParams({ status, page: String(page), page_size: "25" });
    if (appliedSearch) params.set("q", appliedSearch);
    try {
      const response = await api.get<{ reports: AdminReport[]; pagination: AdminPagination }>(`/api/admin/reports/?${params.toString()}`);
      setReports(response.data.reports);
      setPagination(response.data.pagination);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load feedback reports."));
    } finally {
      setIsLoading(false);
    }
  }, [appliedSearch, page, status]);

  useEffect(() => { void loadReports(); }, [loadReports]);

  useEffect(() => {
    if (!isLoading && !error && page > 1 && !reports.length && (pagination?.total || 0) > 0) setPage((current) => Math.max(current - 1, 1));
  }, [error, isLoading, page, pagination?.total, reports.length]);

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
  }

  async function updateReport(report: AdminReport, action: "REVIEW" | "DISMISS") {
    setBusyId(report.id);
    setError("");
    setNotice("");
    try {
      await api.post(`/api/admin/reports/${report.id}/action/`, { action });
      setNotice(action === "REVIEW" ? "Report marked as reviewed." : "Report dismissed and kept in the audit history.");
      await loadReports();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not update this report."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <FeedbackToast message={error || notice} onClose={() => { setError(""); setNotice(""); }} type={error ? "error" : "success"} />
      <AdminPageHeader
        description="Review player reports about court feedback, keep decisions consistent, and protect the original review history from silent edits."
        eyebrow="Trust & safety"
        title="Reports & moderation"
      />

      <AdminPanel className="overflow-visible">
        <form className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5" onSubmit={applySearch}>
          <label className="min-w-0"><span className="sr-only">Search reports</span><input className={`w-full ${inputClass}`} onChange={(event) => setSearch(event.target.value)} placeholder="Search feedback, reporter, court, or reason" value={search} /></label>
          <button className="min-h-11 rounded-lg bg-sportGreen px-4 text-sm font-black text-white transition hover:bg-green-700" type="submit">Search reports</button>
        </form>
        <nav aria-label="Report status" className="flex gap-1 overflow-x-auto border-t border-slate-100 px-4 sm:px-5">
          {tabValues.map((item) => <button aria-current={status === item ? "page" : undefined} className={`min-h-12 shrink-0 border-b-2 px-3 text-sm font-black transition ${status === item ? "border-sportGreen text-sportGreen" : "border-transparent text-slate-500 hover:text-sportNavy"}`} key={item} onClick={() => { setPage(1); setStatus(item); }} type="button">{formatAdminValue(item)}</button>)}
        </nav>
      </AdminPanel>

      <div className="flex items-center justify-between gap-3">
        <div><p className="sport-eyebrow">Moderation queue</p><p className="mt-1 text-sm font-bold text-slate-600">{pagination ? `${pagination.total.toLocaleString()} report${pagination.total === 1 ? "" : "s"}` : "Loading reports..."}</p></div>
        <button className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-sportNavy transition hover:border-green-200 hover:text-sportGreen" onClick={() => void loadReports()} type="button">Refresh</button>
      </div>

      {isLoading ? <AdminLoadingScreen label="Loading moderation queue" /> : null}
      {!isLoading && !error && !reports.length ? <AdminPanel><AdminEmptyState description={status === "OPEN" ? "New player reports will appear here when a review or comment is flagged." : "There are no reports in this status."} title={`No ${formatAdminValue(status).toLowerCase()} reports`} /></AdminPanel> : null}
      {!isLoading && !error && reports.length ? (
        <AdminPanel className="overflow-hidden" title="Feedback reports" description="Moderation changes the report state only. The original player feedback remains available for audit and venue context.">
          <div className="divide-y divide-slate-100">
            {reports.map((report) => <ReportRow busy={busyId === report.id} key={report.id} onAction={(action) => void updateReport(report, action)} report={report} />)}
          </div>
          <AdminPaginationControls hasMore={pagination?.has_more || false} isLoading={isLoading} onNext={() => setPage((current) => current + 1)} onPrevious={() => setPage((current) => Math.max(current - 1, 1))} page={page} pageSize={pagination?.page_size || 25} total={pagination?.total || 0} />
        </AdminPanel>
      ) : null}
    </div>
  );
}

function ReportRow({ report, busy, onAction }: { report: AdminReport; busy: boolean; onAction: (action: "REVIEW" | "DISMISS") => void }) {
  return (
    <article className="p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><AdminStatusPill tone={getAdminStatusTone(report.status)} value={report.status} /><span className="text-xs font-bold text-slate-400">Reported {formatDateTime(report.created_at)}</span></div>
          <h3 className="mt-3 text-base font-black text-sportNavy">{report.reason_label}</h3>
          <p className="mt-1 text-sm font-semibold text-slate-500">{report.target.type === "review" ? "Review" : "Comment"} by {report.target.author} · {report.target.court} · {report.target.venue}</p>
        </div>
        {report.status === "OPEN" ? <div className="flex shrink-0 flex-wrap gap-2"><button className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-sportNavy transition hover:border-green-200 hover:text-sportGreen disabled:opacity-50" disabled={busy} onClick={() => onAction("DISMISS")} type="button">Dismiss report</button><button className="min-h-10 rounded-lg bg-sportGreen px-3 text-xs font-black text-white transition hover:bg-green-700 disabled:opacity-50" disabled={busy} onClick={() => onAction("REVIEW")} type="button">{busy ? "Saving..." : "Mark reviewed"}</button></div> : null}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.65fr)]">
        <div className="rounded-lg bg-slate-50 p-4"><p className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">Reported feedback</p><p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">{report.target.text || "No feedback text was provided."}</p>{report.target.rating ? <p className="mt-3 text-xs font-black text-amber-700">Rating: {report.target.rating}/5</p> : null}</div>
        <dl className="grid content-start gap-3 text-sm"><div><dt className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">Reporter</dt><dd className="mt-1 font-bold text-sportNavy">{report.reporter.name}</dd></div><div><dt className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">Report details</dt><dd className="mt-1 whitespace-pre-wrap font-semibold leading-5 text-slate-600">{report.details || "No additional details."}</dd></div></dl>
      </div>
    </article>
  );
}
