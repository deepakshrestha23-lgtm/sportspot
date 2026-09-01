"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { AdminPageHeader, AdminPanel, AdminStatusPill, formatDateTime, getAdminStatusTone } from "@/components/admin-dashboard/AdminUi";
import { AdminLoadingScreen } from "@/components/admin-dashboard/AdminDashboardLayout";
import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { AdminOverviewResponse, AdminPipelineItem } from "@/types/admin";

const primaryButton = "inline-flex min-h-11 items-center justify-center rounded-lg bg-sportGreen px-4 text-sm font-black text-white shadow-sm transition hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-200";
const secondaryButton = "inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-sportNavy transition hover:border-green-200 hover:text-sportGreen focus:outline-none focus:ring-2 focus:ring-green-200";

export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadOverview = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<AdminOverviewResponse>("/api/admin/overview/");
      setOverview(response.data);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load the admin overview."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  if (isLoading && !overview) return <AdminLoadingScreen label="Loading admin overview" />;

  return (
    <div className="space-y-6">
      <FeedbackToast message={error} onClose={() => setError("")} type="error" />
      <AdminPageHeader
        actions={<><Link className={secondaryButton} href="/dashboard/admin/venues">Review queue</Link><button className={primaryButton} onClick={() => void loadOverview()} type="button">Refresh data</button></>}
        description="A single operational view of trust, marketplace activity, and the issues that need an administrator’s attention."
        eyebrow="SportSpot Admin"
        title="Control center"
      />

      {overview ? (
        <>
          <section className="flex flex-col gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-5" aria-label="Data freshness">
            <div className="flex items-center gap-3"><span className="h-2.5 w-2.5 rounded-full bg-sportGreen" aria-hidden="true" /><p className="font-bold text-green-900">Operations snapshot is up to date.</p></div>
            <p className="text-green-800">Today in Nepal · {formatDateTime(overview.generated_at)}</p>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key metrics">
            <MetricCard label="Total users" value={overview.summary.total_users.toLocaleString()} detail={`${overview.summary.active_users.toLocaleString()} active · ${overview.summary.verified_users.toLocaleString()} verified`} icon={<UsersIcon />} />
            <MetricCard label="Active venues" value={overview.operations.active_venues.toLocaleString()} detail={`${overview.operations.active_courts.toLocaleString()} bookable courts`} icon={<BuildingIcon />} tone="green" />
            <MetricCard label="Bookings today" value={overview.summary.today_bookings.toLocaleString()} detail={`NPR ${formatMoney(overview.summary.today_revenue)} collected`} icon={<CalendarIcon />} />
            <MetricCard label="Revenue · 30 days" value={`NPR ${formatMoney(overview.summary.last_30_day_revenue)}`} detail={`${overview.summary.pending_refunds} refund${overview.summary.pending_refunds === 1 ? "" : "s"} need attention`} icon={<RevenueIcon />} tone="green" />
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <AdminPanel title="Attention queue" description="Items that may block trust, money movement, or a good player experience.">
              {overview.attention.length ? <div className="divide-y divide-slate-100">{overview.attention.map((item) => <Link className="group flex items-start gap-3 px-5 py-4 transition hover:bg-slate-50" href={item.href} key={`${item.kind}-${item.id}`}><span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${item.priority === "HIGH" ? "bg-amber-500" : "bg-slate-300"}`} aria-hidden="true" /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm font-black text-sportNavy group-hover:text-sportGreen">{item.title}</strong><AdminStatusPill value={item.status} tone={getAdminStatusTone(item.status)} /></span><span className="mt-1 block truncate text-xs font-semibold text-slate-500">{item.detail}</span></span><span className="shrink-0 text-xs font-black text-slate-400">{formatDateTime(item.created_at)}</span></Link>)}</div> : <AdminEmptyQueue />}
            </AdminPanel>

            <AdminPanel title="Trust snapshot" description="The queues that protect SportSpot’s community.">
              <div className="grid grid-cols-2 divide-x divide-y divide-slate-100">
                <Snapshot label="Venue reviews" value={pendingVenueReviews(overview.venue_pipeline)} href="/dashboard/admin/venues" />
                <Snapshot label="Feedback reports" value={overview.summary.open_feedback_reports} href="/dashboard/admin/reports" />
                <Snapshot label="Refund requests" value={overview.summary.pending_refunds} href="/dashboard/admin/bookings?refund_status=PENDING_OWNER_ACTION" />
                <Snapshot label="Attendance disputes" value={overview.summary.attendance_disputes} href="/dashboard/admin/reliability" />
              </div>
              <div className="border-t border-slate-100 px-5 py-4"><p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Account mix</p><div className="mt-3 flex flex-wrap gap-2"><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-700">{overview.summary.players} players</span><span className="rounded-full bg-green-50 px-3 py-1.5 text-xs font-black text-green-800">{overview.summary.venue_owners} venue owners</span><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-700">{overview.operations.active_teams} active teams</span></div></div>
            </AdminPanel>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <PipelinePanel title="Venue lifecycle" description="Every listing moves through a visible review state." items={overview.venue_pipeline} />
            <PipelinePanel title="Booking lifecycle" description="Reservation volume across the marketplace." items={overview.booking_pipeline} />
          </section>

          <AdminPanel title="Platform activity" description="Read-only operational signals from the areas connected to SportSpot." className="overflow-visible">
            <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4"><Activity label="Open games" value={overview.summary.active_games} detail="Pickup and fill-squad" /><Activity label="Active challenges" value={overview.summary.active_challenges} detail="Team challenge lifecycle" /><Activity label="Live scorecards" value={overview.summary.live_scorecards} detail={`${overview.summary.completed_scorecards} completed total`} /><Activity label="Scheduled fixtures" value={overview.operations.scheduled_fixtures} detail={`${overview.operations.failed_emails} failed emails`}/></div>
          </AdminPanel>
        </>
      ) : <ErrorPanel onRetry={() => void loadOverview()} />}
    </div>
  );
}

function MetricCard({ label, value, detail, icon, tone = "navy" }: { label: string; value: string; detail: string; icon: ReactNode; tone?: "navy" | "green" }) {
  return <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><p className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">{label}</p><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone === "green" ? "bg-green-50 text-sportGreen" : "bg-slate-50 text-slate-500"}`}>{icon}</span></div><p className={`mt-4 break-words text-2xl font-black leading-tight ${tone === "green" ? "text-sportGreen" : "text-sportNavy"}`}>{value}</p><p className="mt-2 text-xs font-semibold leading-5 text-slate-500">{detail}</p></article>;
}

function Snapshot({ label, value, href }: { label: string; value: number; href: string }) { return <Link className="px-5 py-4 transition hover:bg-slate-50" href={href}><p className="text-xs font-black uppercase tracking-[0.08em] text-slate-500">{label}</p><p className={`mt-2 text-2xl font-black ${value ? "text-amber-600" : "text-sportNavy"}`}>{value}</p><p className="mt-1 text-xs font-bold text-sportGreen">Open queue -&gt;</p></Link>; }

function PipelinePanel({ title, description, items }: { title: string; description: string; items: AdminPipelineItem[] }) { const max = Math.max(...items.map((item) => item.count), 1); return <AdminPanel title={title} description={description}><div className="space-y-4 px-5 py-5">{items.filter((item) => item.value !== "DRAFT" || item.count > 0).map((item) => <div key={item.value}><div className="flex items-center justify-between gap-3 text-sm"><span className="font-bold text-slate-700">{item.label}</span><strong className="font-black text-sportNavy">{item.count}</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full rounded-full ${getAdminStatusTone(item.value) === "danger" ? "bg-red-400" : getAdminStatusTone(item.value) === "warning" ? "bg-amber-400" : getAdminStatusTone(item.value) === "success" ? "bg-sportGreen" : "bg-slate-400"}`} style={{ width: `${(item.count / max) * 100}%` }} /></div></div>)}</div></AdminPanel>; }

function Activity({ label, value, detail }: { label: string; value: number; detail: string }) { return <div className="px-5 py-4"><p className="text-xs font-black uppercase tracking-[0.08em] text-slate-500">{label}</p><p className="mt-2 text-xl font-black text-sportNavy">{value}</p><p className="mt-1 text-xs font-semibold text-slate-500">{detail}</p></div>; }
function AdminEmptyQueue() { return <div className="px-5 py-10 text-center"><p className="text-sm font-black text-sportNavy">Nothing needs attention</p><p className="mt-1 text-sm text-slate-500">The operational queues are clear right now.</p></div>; }
function ErrorPanel({ onRetry }: { onRetry: () => void }) { return <AdminPanel><div className="px-5 py-10 text-center"><p className="text-sm font-black text-red-700">Overview unavailable</p><p className="mt-1 text-sm text-slate-600">We could not load the admin data. Try again once the API is available.</p><button className={`${primaryButton} mt-5`} onClick={onRetry} type="button">Try again</button></div></AdminPanel>; }
function formatMoney(value: string) { return Number(value || 0).toLocaleString("en-NP", { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
function pendingVenueReviews(items: AdminPipelineItem[]) { return items.filter((item) => ["PENDING", "NEEDS_CHANGES"].includes(item.value)).reduce((total, item) => total + item.count, 0); }
function UsersIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 2a5 5 0 0 1 5 5M3 20a5 5 0 0 1 10 0" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
function BuildingIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M4 21V7l8-4 8 4v14M9 21v-6h6v6M8 9h.01M12 9h.01M16 9h.01" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
function CalendarIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M7 3v3m10-3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
function RevenueIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M12 3v18m4-14.5c-.8-.7-2-1-3.5-1-2.2 0-3.5 1.1-3.5 2.7 0 4.1 7 1.8 7 5.5 0 1.8-1.4 2.8-3.7 2.8-1.5 0-2.8-.4-3.8-1.3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
