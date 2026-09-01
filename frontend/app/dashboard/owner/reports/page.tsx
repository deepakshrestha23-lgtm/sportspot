"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import LoadingIndicator from "@/components/LoadingIndicator";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { OwnerDashboardIcon } from "@/components/owner/VenueOwnerSidebar";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { addCalendarDays, formatDateOnly, formatDateTimeInNepal, getLocalDateString } from "@/lib/dates";
import type { OwnerReportCourt, OwnerReportDay, OwnerReportsResponse } from "@/types/venue";

type ReportPeriod = 7 | 30 | 90;
type ReportSelection = ReportPeriod | "custom";
type ReportQuery =
  | { mode: "preset"; period: ReportPeriod }
  | { mode: "custom"; startDate: string; endDate: string };

const MAX_CUSTOM_REPORT_DAYS = 365;

const periodOptions: Array<{ label: string; value: ReportSelection }> = [
  { label: "Last 7 days", value: 7 },
  { label: "Last 30 days", value: 30 },
  { label: "Last 90 days", value: 90 },
  { label: "Custom range", value: "custom" },
];

export default function OwnerReportsPage() {
  const [period, setPeriod] = useState<ReportPeriod>(30);
  const [selection, setSelection] = useState<ReportSelection>(30);
  const [report, setReport] = useState<OwnerReportsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [today, setToday] = useState("");
  const [customError, setCustomError] = useState("");
  const requestSequence = useRef(0);

  async function loadReport(query: ReportQuery) {
    const requestId = ++requestSequence.current;
    setIsLoading(true);
    setError("");
    try {
      const queryString = query.mode === "preset"
        ? `period=${query.period}`
        : new URLSearchParams({ start_date: query.startDate, end_date: query.endDate }).toString();
      const response = await api.get<OwnerReportsResponse>(`/api/venues/owner/reports/?${queryString}`);
      if (requestId !== requestSequence.current) return;
      setReport(response.data);
    } catch (requestError) {
      if (requestId !== requestSequence.current) return;
      setError(getApiErrorMessage(requestError, "Could not load venue reports."));
    } finally {
      if (requestId === requestSequence.current) setIsLoading(false);
    }
  }

  useEffect(() => {
    const currentDate = getLocalDateString();
    setToday(currentDate);
    setCustomEndDate(currentDate);
    setCustomStartDate(addCalendarDays(currentDate, -29));
    void loadReport({ mode: "preset", period: 30 });
    // The initial request intentionally uses the default 30-day preset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSelectionChange(nextSelection: ReportSelection) {
    setCustomError("");
    if (nextSelection === "custom") {
      setSelection("custom");
      if (report) {
        setCustomStartDate(report.period.start_date);
        setCustomEndDate(report.period.end_date);
      } else if (today) {
        setCustomEndDate(today);
        setCustomStartDate(addCalendarDays(today, -29));
      }
      return;
    }

    setSelection(nextSelection);
    setPeriod(nextSelection);
    void loadReport({ mode: "preset", period: nextSelection });
  }

  function handleApplyCustomRange() {
    const validationMessage = validateCustomRange(customStartDate, customEndDate, today);
    if (validationMessage) {
      setCustomError(validationMessage);
      return;
    }
    setCustomError("");
    void loadReport({ mode: "custom", startDate: customStartDate, endDate: customEndDate });
  }

  function retryReport() {
    if (selection === "custom") {
      void loadReport({ mode: "custom", startDate: customStartDate, endDate: customEndDate });
      return;
    }
    void loadReport({ mode: "preset", period });
  }

  return (
    <div className="owner-reports-page">
      <OwnerPageHeader
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {report?.venue ? <button className="owner-secondary-button owner-report-export-button" disabled={isLoading} onClick={() => downloadReportCsv(report)} type="button"><ReportDownloadIcon />Export CSV</button> : null}
            <Link className="owner-secondary-button" href="/dashboard/owner/bookings">View bookings</Link>
            <Link className="owner-primary-button" href="/dashboard/owner/calendar">Open calendar</Link>
          </div>
        }
        description="Understand booking demand, paid booking value, court usage, check-ins, and follow-up work from your venue records."
        eyebrow="Venue Manager"
        title="Reports"
      />

      {isLoading && !report ? <ReportsLoading /> : null}

      {!isLoading && error ? (
        <section className="owner-report-message" role="alert">
          <div>
            <p className="owner-section-kicker">Report unavailable</p>
            <h2>We could not load your venue report.</h2>
            <p>{error}</p>
          </div>
          <button className="owner-secondary-button" onClick={retryReport} type="button">Try again</button>
        </section>
      ) : null}

      {!isLoading && !error && report && !report.venue ? (
        <section className="sport-empty-state">
          <p className="owner-section-kicker">Venue setup required</p>
          <h2 className="mt-2 text-xl font-black text-sportNavy">Create your venue to see reports</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">Reports are calculated from your venue&apos;s bookings, courts, slots, payments, refunds, and check-ins.</p>
          <Link className="owner-primary-button mt-5" href="/dashboard/owner/venue-setup">Complete venue setup</Link>
        </section>
      ) : null}

      {!error && report?.venue ? (
        <ReportWorkspace
          customEndDate={customEndDate}
          customError={customError}
          customStartDate={customStartDate}
          isLoading={isLoading}
          onApplyCustomRange={handleApplyCustomRange}
          onCustomEndDateChange={(value) => {
            setCustomEndDate(value);
            setCustomError("");
          }}
          onCustomStartDateChange={(value) => {
            setCustomStartDate(value);
            setCustomError("");
          }}
          onSelectionChange={handleSelectionChange}
          period={period}
          report={report}
          selection={selection}
          today={today}
        />
      ) : null}
    </div>
  );
}

function ReportWorkspace({
  customEndDate,
  customError,
  customStartDate,
  isLoading,
  onApplyCustomRange,
  onCustomEndDateChange,
  onCustomStartDateChange,
  onSelectionChange,
  period,
  report,
  selection,
  today,
}: {
  customEndDate: string;
  customError: string;
  customStartDate: string;
  isLoading: boolean;
  onApplyCustomRange: () => void;
  onCustomEndDateChange: (value: string) => void;
  onCustomStartDateChange: (value: string) => void;
  onSelectionChange: (selection: ReportSelection) => void;
  period: ReportPeriod;
  report: OwnerReportsResponse;
  selection: ReportSelection;
  today: string;
}) {
  const { summary } = report;
  const courtPerformance = [...report.courts].sort((left, right) => right.booked_slot_count - left.booked_slot_count || Number(right.paid_value) - Number(left.paid_value));

  return (
    <>
      <section className="owner-report-controls">
        <div className="owner-report-period-summary">
          <div className="owner-report-period-heading-row">
            <span className="owner-report-period-icon"><ReportCalendarIcon /></span>
            <div className="owner-report-period-heading-content">
              <h2>Reporting Period</h2>
              {report.period.mode === "custom" ? <span className="owner-report-period-mode">Custom</span> : null}
            </div>
          </div>
          <p className="owner-report-period-date">{formatDateOnly(report.period.start_date)} - {formatDateOnly(report.period.end_date)}</p>
          <p className="owner-report-period-description">Reports are calculated from SportSpot records for this venue and period.{isLoading ? <span className="owner-report-refresh-status" aria-live="polite"> Updating...</span> : null}</p>
        </div>
        <div className={`owner-report-period-controls${selection === "custom" ? " is-custom" : ""}`}>
          <label className="owner-report-period-field">
            <span>Period</span>
            <span className="owner-report-select-wrap">
              <ReportCalendarIcon />
              <select
                onChange={(event) => {
                  const nextValue = event.target.value === "custom" ? "custom" : Number(event.target.value) as ReportPeriod;
                  onSelectionChange(nextValue);
                }}
                disabled={isLoading}
                value={selection}
              >
                {periodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </span>
          </label>

          {selection === "custom" ? (
            <div className="owner-report-custom-range" role="group" aria-label="Custom report date range">
              <label className="owner-report-date-field" htmlFor="owner-report-start-date">
                <span>From</span>
                <span className="owner-report-date-input-wrap">
                  <ReportCalendarIcon />
                  <input
                    aria-describedby={customError ? "owner-report-custom-error" : undefined}
                    id="owner-report-start-date"
                    max={today || undefined}
                    onChange={(event) => onCustomStartDateChange(event.target.value)}
                    type="date"
                    value={customStartDate}
                    disabled={isLoading}
                  />
                </span>
              </label>
              <span className="owner-report-date-separator" aria-hidden="true"><ReportArrowIcon /></span>
              <label className="owner-report-date-field" htmlFor="owner-report-end-date">
                <span>To</span>
                <span className="owner-report-date-input-wrap">
                  <ReportCalendarIcon />
                  <input
                    aria-describedby={customError ? "owner-report-custom-error" : undefined}
                    id="owner-report-end-date"
                    max={today || undefined}
                    min={customStartDate || undefined}
                    onChange={(event) => onCustomEndDateChange(event.target.value)}
                    type="date"
                    value={customEndDate}
                    disabled={isLoading}
                  />
                </span>
              </label>
              <button className="owner-primary-button owner-report-custom-apply" disabled={isLoading} onClick={onApplyCustomRange} type="button">
                <ReportCalendarIcon />
                {isLoading ? <LoadingIndicator label="Applying" size="sm" tone="inverse" /> : "Apply"}
              </button>
              {customError ? <p className="owner-report-custom-error" id="owner-report-custom-error" role="alert">{customError}</p> : null}
            </div>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="owner-report-snapshot-heading" className="owner-report-summary-section">
        <div className="owner-report-section-intro">
          <div>
            <p className="owner-section-kicker">Performance snapshot</p>
            <h2 id="owner-report-snapshot-heading">At a glance</h2>
            <p>One clear view of bookings, paid value, capacity use, and court access.</p>
          </div>
          <div className="owner-report-summary-period"><span aria-hidden="true" />{formatDateOnly(report.period.start_date)} - {formatDateOnly(report.period.end_date)}</div>
        </div>
        <section aria-label="Report summary" className="owner-report-metrics">
          <ReportMetric detail={`${summary.paid_booking_count} captured booking${summary.paid_booking_count === 1 ? "" : "s"} · net NPR ${formatMoney(summary.net_value)}`} icon="payments" label="Captured payment value" value={`NPR ${formatMoney(summary.paid_value)}`} tone="primary" />
          <ReportMetric detail={`${summary.confirmed_booking_count + summary.completed_booking_count} confirmed or completed · ${summary.reserved_booking_count} active hold${summary.reserved_booking_count === 1 ? "" : "s"}`} icon="bookings" label="Booking records" value={String(summary.booking_count)} />
          <ReportMetric detail={`${summary.booked_slot_count} of ${summary.published_slot_count} published slots`} icon="availability" label="Slot utilization" value={formatPercent(summary.utilization_percent)} tone="success" />
          <ReportMetric detail="Court access scans recorded" icon="verification" label="Court check-ins" value={String(summary.check_in_count)} />
        </section>
      </section>

      <div className="owner-report-stack">
        <ActivityTrend trend={report.trend} />
        <CourtPerformance courts={courtPerformance} />
      </div>

      <div className="owner-report-grid owner-report-grid-secondary">
        <BookingOutcomes summary={summary} />
        <OperationalFollowUp report={report} />
      </div>

      <div className="owner-report-footer">
        <p>Updated {formatDateTimeInNepal(report.server_now)}.</p>
        <details>
          <summary>How these figures are calculated</summary>
          <p>Paid booking value includes captured payments, including bookings later cancelled with a refund or no-refund outcome. Net value subtracts processed and approved pending refunds. Slot utilization is booked slots divided by published slots; blocked and cancelled slots are excluded. Reports do not claim that money has been transferred to the owner.</p>
        </details>
      </div>
    </>
  );
}

function ReportMetric({ detail, icon, label, tone = "default", value }: { detail: string; icon: "payments" | "bookings" | "availability" | "verification"; label: string; tone?: "default" | "primary" | "success"; value: string }) {
  return (
    <div className={`owner-report-metric owner-report-metric-${tone}`}>
      <div className="owner-report-metric-label"><span className="owner-report-metric-icon"><OwnerDashboardIcon name={icon} /></span><span>{label}</span></div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function ActivityTrend({ trend }: { trend: OwnerReportDay[] }) {
  const [metric, setMetric] = useState<"bookings" | "revenue">("bookings");
  const buckets = buildTrendBuckets(trend);
  const maxValue = Math.max(...buckets.map((bucket) => metric === "bookings" ? bucket.bookingCount : bucket.paidValue), 1);
  const totalValue = buckets.reduce((total, bucket) => total + (metric === "bookings" ? bucket.bookingCount : bucket.paidValue), 0);
  const peakBucket = buckets.reduce((peak, bucket) => {
    const value = metric === "bookings" ? bucket.bookingCount : bucket.paidValue;
    const peakValue = metric === "bookings" ? peak.bookingCount : peak.paidValue;
    return value > peakValue ? bucket : peak;
  }, buckets[0]);
  const peakValue = peakBucket ? metric === "bookings" ? peakBucket.bookingCount : peakBucket.paidValue : 0;

  return (
    <section className="owner-report-panel" aria-labelledby="owner-report-activity-heading">
      <div className="owner-report-panel-header">
        <div>
          <p className="owner-section-kicker">Demand and value</p>
          <h2 id="owner-report-activity-heading">Booking activity</h2>
          <p>Compare booking records or captured payment value across the selected period.</p>
        </div>
        <div className="owner-report-panel-actions">
          <div aria-label="Chart metric" className="owner-report-segmented-control" role="group">
            <button aria-pressed={metric === "bookings"} className={metric === "bookings" ? "is-active" : ""} onClick={() => setMetric("bookings")} type="button">Booking records</button>
            <button aria-pressed={metric === "revenue"} className={metric === "revenue" ? "is-active" : ""} onClick={() => setMetric("revenue")} type="button">Captured value</button>
          </div>
          <Link className="owner-report-panel-link" href="/dashboard/owner/bookings">Open records <span aria-hidden="true">-&gt;</span></Link>
        </div>
      </div>
      {buckets.length ? (
        <div className="owner-report-chart-wrap">
          <div className="owner-report-chart-summary"><strong>{metric === "bookings" ? `${totalValue} booking record${totalValue === 1 ? "" : "s"}` : `NPR ${formatCompactMoney(totalValue)}`}</strong><span>Peak: {metric === "bookings" ? `${peakValue} record${peakValue === 1 ? "" : "s"}` : `NPR ${formatCompactMoney(peakValue)}`}</span></div>
          <div className="owner-report-chart" role="img" aria-label={`${metric === "bookings" ? "Booking record" : "Captured payment value"} trend for the selected period`}>
          <div className="owner-report-bars">
            {buckets.map((bucket) => (
              <div className="owner-report-bar-column" key={bucket.key} title={`${bucket.label}: ${metric === "bookings" ? `${bucket.bookingCount} booking record${bucket.bookingCount === 1 ? "" : "s"}` : `NPR ${formatMoney(bucket.paidValue)}`}`}>
                <div className="owner-report-bar-track"><span style={{ height: `${Math.max((metric === "bookings" ? bucket.bookingCount : bucket.paidValue) ? 12 : 4, ((metric === "bookings" ? bucket.bookingCount : bucket.paidValue) / maxValue) * 100)}%` }} /></div>
                <strong>{metric === "bookings" ? bucket.bookingCount : formatCompactMoney(bucket.paidValue)}</strong>
                <small>{bucket.label}</small>
              </div>
            ))}
          </div>
          </div>
        </div>
      ) : <ReportEmpty text="No booking activity in this period." />}
    </section>
  );
}

function CourtPerformance({ courts }: { courts: OwnerReportCourt[] }) {
  return (
    <section className="owner-report-panel" aria-labelledby="owner-report-courts-heading">
      <div className="owner-report-panel-header">
        <div>
          <p className="owner-section-kicker">Inventory performance</p>
          <h2 id="owner-report-courts-heading">Court performance</h2>
          <p>Compare published capacity and demand by court.</p>
        </div>
        <Link className="owner-report-panel-link" href="/dashboard/owner/courts">Manage courts <span aria-hidden="true">-&gt;</span></Link>
      </div>
      {courts.length ? (
        <div className="owner-report-court-list" role="table">
          <div aria-hidden="true" className="owner-report-court-head"><span>Court</span><span>Utilization</span><span>Bookings</span><span>Paid value</span><span /></div>
          {courts.map((court) => (
            <div className="owner-report-court-row" key={court.id} role="row">
              <div className="owner-report-court-name">
                <strong>{court.name}</strong>
                <span>{court.is_active ? "Active court" : "Inactive court"}</span>
              </div>
              <div className="owner-report-court-utilization"><div className="owner-report-progress"><span style={{ width: `${Math.min(100, Math.max(0, court.utilization_percent))}%` }} /></div><strong>{formatPercent(court.utilization_percent)}</strong><small>{court.booked_slot_count}/{court.published_slot_count} slots</small></div>
              <div className="owner-report-court-stat"><span>Bookings</span><strong>{court.booking_count}</strong></div>
              <div className="owner-report-court-stat"><span>Paid value</span><strong>NPR {formatMoney(court.paid_value)}</strong></div>
              <Link className="owner-report-court-link" href={`/dashboard/owner/courts/${court.id}/slots`}>Slots <span aria-hidden="true">-&gt;</span></Link>
            </div>
          ))}
        </div>
      ) : <ReportEmpty text="Add a court to start measuring its performance." actionHref="/dashboard/owner/courts/create" actionLabel="Add court" />}
    </section>
  );
}

function BookingOutcomes({ summary }: { summary: OwnerReportsResponse["summary"] }) {
  const outcomes = [
    { label: "Confirmed", value: summary.confirmed_booking_count, tone: "success" },
    { label: "Completed", value: summary.completed_booking_count, tone: "primary" },
    { label: "Cancelled", value: summary.cancelled_booking_count, tone: "warning" },
    { label: "Expired holds", value: summary.expired_booking_count, tone: "muted" },
    { label: "Reserved", value: summary.reserved_booking_count, tone: "pending" },
  ];
  const chartTotal = Math.max(summary.booking_count, 1);
  return (
    <section className="owner-report-panel" aria-labelledby="owner-report-outcomes-heading">
      <div className="owner-report-panel-header">
        <div>
          <p className="owner-section-kicker">Reservation health</p>
          <h2 id="owner-report-outcomes-heading">Booking status</h2>
          <p>See how every booking record ended or is progressing.</p>
        </div>
      </div>
      <div className="owner-report-outcome-summary"><strong>{summary.booking_count}</strong><span>Total booking records</span></div>
      <div aria-hidden="true" className="owner-report-outcome-track">
        {outcomes.map((outcome) => outcome.value ? <span className={`owner-report-outcome-segment owner-report-outcome-${outcome.tone}`} key={outcome.label} style={{ width: `${(outcome.value / chartTotal) * 100}%` }} /> : null)}
      </div>
      <div className="owner-report-outcomes">
        {outcomes.map((outcome) => <div className="owner-report-outcome" key={outcome.label}><span className={`owner-report-outcome-dot owner-report-outcome-${outcome.tone}`} /><div><strong>{outcome.value}</strong><p>{outcome.label}</p></div></div>)}
      </div>
    </section>
  );
}

function OperationalFollowUp({ report }: { report: OwnerReportsResponse }) {
  const { summary } = report;
  return (
    <section className="owner-report-panel" aria-labelledby="owner-report-follow-up-heading">
      <div className="owner-report-panel-header">
        <div>
          <p className="owner-section-kicker">Owner actions</p>
          <h2 id="owner-report-follow-up-heading">What needs attention</h2>
          <p>Open the operational queue only when action is needed.</p>
        </div>
      </div>
      <div className="owner-report-follow-up-list">
        <ReportFollowUpRow label="Refunds awaiting review" value={summary.pending_refund_count ? `${summary.pending_refund_count} · NPR ${formatMoney(summary.pending_refund_value)}` : "None"} href="/dashboard/owner/refunds" action="Open refunds" tone={summary.pending_refund_count ? "warning" : "success"} />
        <ReportFollowUpRow label="Active payment holds" value={summary.reserved_booking_count ? String(summary.reserved_booking_count) : "None"} href="/dashboard/owner/calendar" action="Open calendar" tone={summary.reserved_booking_count ? "warning" : "success"} />
        <ReportFollowUpRow label="Blocked court slots" value={summary.blocked_slot_count ? String(summary.blocked_slot_count) : "None"} href="/dashboard/owner/calendar" action="View blocks" tone={summary.blocked_slot_count ? "warning" : "success"} />
        <ReportFollowUpRow label="Refunds processed" value={`NPR ${formatMoney(summary.processed_refund_value)}`} href="/dashboard/owner/refunds" action="View refunds" />
      </div>
    </section>
  );
}

function ReportFollowUpRow({ action, href, label, tone = "default", value }: { action: string; href: string; label: string; tone?: "default" | "success" | "warning"; value: string }) {
  return (
    <div className="owner-report-follow-up-row">
      <div><span>{label}</span><strong className={tone === "warning" ? "is-warning" : tone === "success" ? "is-success" : ""}>{value}</strong></div>
      <Link href={href}>{action} <span aria-hidden="true">-&gt;</span></Link>
    </div>
  );
}

function ReportEmpty({ actionHref, actionLabel, text }: { actionHref?: string; actionLabel?: string; text: string }) {
  return <div className="owner-report-empty"><p>{text}</p>{actionHref && actionLabel ? <Link className="owner-report-panel-link" href={actionHref}>{actionLabel} <span aria-hidden="true">-&gt;</span></Link> : null}</div>;
}

function ReportsLoading() {
  return <section className="sport-loading-inline-panel min-h-[22rem]" aria-label="Loading reports"><LoadingIndicator label="Loading venue reports" size="lg" /></section>;
}

function buildTrendBuckets(trend: OwnerReportDay[]) {
  const bucketCount = Math.min(14, trend.length);
  if (!bucketCount) return [];
  return Array.from({ length: bucketCount }, (_, index) => {
    const start = Math.floor((index * trend.length) / bucketCount);
    const end = Math.max(start + 1, Math.floor(((index + 1) * trend.length) / bucketCount));
    const items = trend.slice(start, end);
    return {
      key: `${items[0].date}-${items[items.length - 1].date}`,
      label: formatDateOnly(items[0].date, { month: "short", day: "numeric" }),
      bookingCount: items.reduce((total, item) => total + item.booking_count, 0),
      paidValue: items.reduce((total, item) => total + Number(item.paid_value), 0),
    };
  });
}

function downloadReportCsv(report: OwnerReportsResponse) {
  if (!report.venue) return;

  const rows: Array<Array<string | number>> = [
    ["SportSpot venue report", report.venue.name],
    ["Reporting period", `${formatDateOnly(report.period.start_date)} - ${formatDateOnly(report.period.end_date)}`],
    [],
    ["Summary", "Value"],
    ["Captured payment value", `NPR ${formatMoney(report.summary.paid_value)}`],
    ["Net booking value", `NPR ${formatMoney(report.summary.net_value)}`],
    ["Booking records", report.summary.booking_count],
    ["Slot utilization", formatPercent(report.summary.utilization_percent)],
    ["Court check-ins", report.summary.check_in_count],
    ["Processed refunds", `NPR ${formatMoney(report.summary.processed_refund_value)}`],
    [],
    ["Court performance"],
    ["Court", "Status", "Bookings", "Paid value", "Utilization", "Booked slots", "Published slots"],
    ...report.courts.map((court) => [
      court.name,
      court.is_active ? "Active" : "Inactive",
      court.booking_count,
      `NPR ${formatMoney(court.paid_value)}`,
      formatPercent(court.utilization_percent),
      court.booked_slot_count,
      court.published_slot_count,
    ]),
    [],
    ["Daily activity"],
    ["Date", "Reservations", "Paid bookings", "Paid value", "Booked slots", "Published slots"],
    ...report.trend.map((day) => [
      formatDateOnly(day.date),
      day.booking_count,
      day.paid_booking_count,
      `NPR ${formatMoney(day.paid_value)}`,
      day.booked_slot_count,
      day.published_slot_count,
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `sportspot-report-${report.period.start_date}-${report.period.end_date}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function formatMoney(value: string | number) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";
}

function formatCompactMoney(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1).replace(/\.0$/, "")}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return formatMoney(value);
}

function formatPercent(value: number) {
  return `${Number(value).toFixed(1).replace(/\.0$/, "")}%`;
}

function validateCustomRange(startDate: string, endDate: string, today: string) {
  if (!startDate || !endDate) return "Choose both a start date and an end date.";
  if (!isValidDateInput(startDate) || !isValidDateInput(endDate)) {
    return "Enter a valid start and end date.";
  }
  if (startDate > endDate) return "The start date must be on or before the end date.";
  if (today && endDate > today) return "Reports cannot include future dates.";
  if (addCalendarDays(startDate, MAX_CUSTOM_REPORT_DAYS - 1) < endDate) {
    return `Choose a range of ${MAX_CUSTOM_REPORT_DAYS} days or fewer.`;
  }
  return "";
}

function isValidDateInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
}

function ReportCalendarIcon() {
  return <svg aria-hidden="true" className="owner-report-control-icon" fill="none" viewBox="0 0 24 24"><rect height="16" rx="2" stroke="currentColor" strokeWidth="1.8" width="18" x="3" y="5" /><path d="M8 3v4m8-4v4M3 10h18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
}

function ReportArrowIcon() {
  return <svg aria-hidden="true" className="owner-report-range-arrow-icon" fill="none" viewBox="0 0 24 24"><path d="M4 12h15m-5-5 5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}

function ReportDownloadIcon() {
  return <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 18v2h14v-2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}
