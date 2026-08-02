"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { OwnerDashboardIcon, VenueLifecycleBadge } from "@/components/owner/VenueOwnerSidebar";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateTimeInNepal } from "@/lib/dates";
import type {
  BookingStatus,
  OwnerCourtStatus,
  OwnerLifecycleState,
  OwnerNextBooking,
  OwnerOverviewResponse,
  OwnerPendingAction,
  OwnerQuickAction,
  OwnerRecentActivity,
  OwnerScheduleItem,
  PaymentStatus,
} from "@/types/venue";

export default function OwnerDashboardPage() {
  const [overview, setOverview] = useState<OwnerOverviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadOverview();
  }, []);

  async function loadOverview() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<OwnerOverviewResponse>("/api/venues/owner/overview/");
      setOverview(response.data);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load your venue overview. Please try again."));
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) return <OverviewSkeleton />;

  if (error || !overview) {
    return (
      <section className="rounded-lg border border-red-100 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-black uppercase tracking-wide text-red-600">Overview unavailable</p>
        <h1 className="mt-2 text-2xl font-black text-sportNavy">We could not load your venue overview.</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">Please try again. Your venue data has not been changed.</p>
        <button className="mt-5 rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" onClick={loadOverview} type="button">
          Retry
        </button>
      </section>
    );
  }

  const venueName = overview.venue?.name || "your venue";

  return (
    <div className="space-y-6">
      <OwnerPageHeader
        actions={
          <Link className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-200" href="/dashboard/owner/calendar">
            <OwnerDashboardIcon name="calendar" />
            View Calendar
          </Link>
        }
        description={`Here's what is happening at ${venueName} today.`}
        title="Venue Overview"
      />

      <VenueStatusBanner lifecycleState={overview.lifecycle_state} overview={overview} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon="calendar" href="/dashboard/owner/bookings?filter=today" label="Today's Bookings" value={overview.summary.today_bookings} />
        <SummaryCard icon="payments" href="/dashboard/owner/bookings?filter=today" label="Today's Expected Revenue" value={`NPR ${formatMoney(overview.summary.today_expected_revenue)}`} />
        <SummaryCard icon="venue" href="/dashboard/owner/calendar" label="Courts in Use" value={`${overview.summary.courts_in_use}/${overview.summary.total_active_courts}`} />
        <SummaryCard icon="payments" href="/dashboard/owner/refunds" label="Pending Refund Requests" value={overview.summary.pending_refund_requests} tone={overview.summary.pending_refund_requests ? "warning" : "default"} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <TodaySchedule items={overview.today_schedule} />
          <RecentActivity items={overview.recent_activity} />
        </div>
        <div className="space-y-6">
          <NextBookingCard booking={overview.next_booking} serverNow={overview.server_now} />
          <PendingActions actions={overview.pending_actions} />
          <CourtStatusList courts={overview.court_statuses} />
          <QuickActions actions={overview.quick_actions} />
        </div>
      </section>
    </div>
  );
}

function VenueStatusBanner({ lifecycleState, overview }: { lifecycleState: OwnerLifecycleState; overview: OwnerOverviewResponse }) {
  if (lifecycleState === "ACTIVE") return null;

  const content: Record<OwnerLifecycleState, { title: string; body: string; label: string; href: string }> = {
    NO_VENUE: {
      title: "Complete your venue setup before submitting it for verification.",
      body: "Add venue details, courts, availability, pricing and proof documents to start the approval process.",
      label: "Complete Setup",
      href: "/dashboard/owner/venue-setup",
    },
    SETUP_INCOMPLETE: {
      title: "Complete your venue setup before submitting it for verification.",
      body: "Your venue can be saved as a draft until all required details are ready.",
      label: "Continue Setup",
      href: "/dashboard/owner/venue-setup",
    },
    PENDING_VERIFICATION: {
      title: "Your venue is currently under verification.",
      body: "Players cannot book this venue until it is approved.",
      label: "View Verification",
      href: "/dashboard/owner/venue",
    },
    CHANGES_REQUIRED: {
      title: "Changes are required before your venue can be approved.",
      body: overview.venue?.admin_review_note || "Review the feedback and resubmit your venue when the changes are complete.",
      label: "Review Feedback",
      href: "/dashboard/owner/venue-setup",
    },
    TEMPORARILY_INACTIVE: {
      title: "Your venue is currently unavailable for new bookings.",
      body: "Existing records remain available, but players cannot make new bookings while the venue is inactive.",
      label: "Manage Venue Status",
      href: "/dashboard/owner/venue",
    },
    SUSPENDED: {
      title: "Your venue has been suspended and cannot accept new bookings.",
      body: "Contact support or review venue details before making operational changes.",
      label: "Get Support",
      href: "/support",
    },
    ACTIVE: { title: "", body: "", label: "", href: "" },
  };

  const item = content[lifecycleState];
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 shadow-sm sm:flex sm:items-start sm:justify-between sm:gap-5">
      <div className="min-w-0">
        <VenueLifecycleBadge state={lifecycleState} />
        <h2 className="mt-3 text-lg font-black text-sportNavy">{item.title}</h2>
        <p className="mt-1 text-sm leading-6 text-amber-900">{item.body}</p>
      </div>
      <Link className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-sportGreen px-4 text-sm font-black text-white hover:bg-green-700 sm:mt-0" href={item.href}>
        {item.label}
      </Link>
    </section>
  );
}

function SummaryCard({ href, icon, label, tone = "default", value }: { href: string; icon: "calendar" | "payments" | "venue"; label: string; tone?: "default" | "warning"; value: string | number }) {
  return (
    <Link className="group rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-green-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-green-200" href={href}>
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${tone === "warning" ? "bg-red-50 text-red-600" : "bg-green-50 text-sportGreen"}`}>
          <OwnerDashboardIcon name={icon} />
        </span>
        {tone === "warning" ? <span className="rounded-full bg-red-100 px-2 py-1 text-[11px] font-black text-red-700">Attention</span> : null}
      </div>
      <p className="mt-4 text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black text-sportNavy">{value}</p>
    </Link>
  );
}

function TodaySchedule({ items }: { items: OwnerScheduleItem[] }) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-lg font-black text-sportNavy">Today's Schedule</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">Confirmed and operationally relevant bookings</p>
        </div>
        <Link className="text-sm font-black text-sportGreen hover:text-green-700" href="/dashboard/owner/calendar">View Full Calendar</Link>
      </div>
      {items.length ? (
        <div className="divide-y divide-slate-100">
          {items.map((item) => (
            <article className="grid gap-3 px-5 py-4 sm:grid-cols-[96px_minmax(0,1fr)_auto] sm:items-center" key={item.id}>
              <div className="text-sm font-black text-sportNavy">{item.display_time.split(" - ")[0]}</div>
              <div className="min-w-0 border-l-4 border-green-300 pl-4">
                <h3 className="truncate font-black text-sportNavy">{item.court_name}</h3>
                <p className="mt-1 text-sm text-slate-600">{item.player_name} · {item.duration_minutes} min · {item.booking_code}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <StatusBadge label={bookingStatusLabel(item.booking_status)} tone={bookingStatusTone(item.booking_status)} />
                <StatusBadge label={paymentStatusLabel(item.payment_status)} tone={paymentStatusTone(item.payment_status)} />
                <Link className="rounded-md border border-slate-200 px-3 py-2 text-xs font-black text-sportNavy hover:border-green-200 hover:text-sportGreen" href={item.action_url}>View</Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyBlock title="No bookings scheduled today" description="Confirmed bookings for today will appear here in time order." />
      )}
    </section>
  );
}

function NextBookingCard({ booking, serverNow }: { booking: OwnerNextBooking | null; serverNow: string }) {
  if (!booking) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-sportNavy">Next Booking</h2>
        <EmptyBlock compact title="No upcoming confirmed booking" description="The next confirmed booking will appear here." />
      </section>
    );
  }

  return (
    <section className="rounded-xl bg-sportGreen p-5 text-white shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-green-100">Up next</p>
      <h2 className="mt-3 text-2xl font-black">{booking.player_name}</h2>
      <p className="mt-1 text-sm font-semibold text-green-50">{booking.court_name} · {booking.display_time}</p>
      <Countdown endAt={booking.end_at} serverNow={serverNow} startAt={booking.start_at} />
      <div className="mt-5 flex flex-wrap gap-2">
        <Link className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md bg-white px-4 text-sm font-black text-sportGreen hover:bg-green-50" href={booking.action_url}>View Details</Link>
      </div>
    </section>
  );
}

function Countdown({ endAt, serverNow, startAt }: { endAt: string | null; serverNow: string; startAt: string | null }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const serverMs = new Date(serverNow).getTime();
    const clientAtFetchMs = Date.now();
    const offsetMs = clientAtFetchMs - serverMs;
    const tick = () => setNow(new Date(Date.now() - offsetMs));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [serverNow]);

  if (!now || !startAt || !endAt) return <p className="mt-4 text-sm font-semibold text-green-50">Checking start time...</p>;

  const start = new Date(startAt);
  const end = new Date(endAt);
  const msUntilStart = Math.max(0, start.getTime() - now.getTime());
  const isInProgress = now >= start && now < end;
  const hasEnded = now >= end;

  if (hasEnded) return <p className="mt-4 text-sm font-black text-green-50">This booking has ended.</p>;
  if (isInProgress) return <p className="mt-4 text-lg font-black text-white">In progress</p>;
  if (msUntilStart === 0) return <p className="mt-4 text-lg font-black text-white">Starting now</p>;

  const totalSeconds = Math.floor(msUntilStart / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return (
    <div className="mt-5" aria-live="off">
      <p className="text-sm font-semibold text-green-50">Starts in</p>
      <div className="mt-2 flex items-center gap-2">
        <CountdownUnit label="Hrs" value={hours} />
        <CountdownUnit label="Min" value={minutes} />
        <CountdownUnit label="Sec" value={seconds} />
      </div>
    </div>
  );
}

function CountdownUnit({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white/15 px-3 py-2 text-center">
      <p className="text-xl font-black text-white">{String(value).padStart(2, "0")}</p>
      <p className="text-[10px] font-black uppercase tracking-wide text-green-100">{label}</p>
    </div>
  );
}

function PendingActions({ actions }: { actions: OwnerPendingAction[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <h2 className="text-lg font-black text-sportNavy">Pending Actions</h2>
        {actions.length ? <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-black text-red-700">{actions.length}</span> : null}
      </div>
      {actions.length ? (
        <div className="space-y-3 p-4">
          {actions.map((action) => (
            <article className="rounded-lg border border-slate-200 bg-slate-50 p-4" key={action.id}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-black text-sportNavy">{action.title}</h3>
                <StatusBadge label={priorityLabel(action.priority)} tone={action.priority === "URGENT" ? "red" : action.priority === "IMPORTANT" ? "amber" : "slate"} />
              </div>
              <p className="mt-2 text-sm leading-5 text-slate-600">{action.reason}</p>
              <Link className="mt-3 inline-flex rounded-md bg-sportGreen px-3 py-2 text-xs font-black text-white hover:bg-green-700" href={action.action_url}>{action.action_label}</Link>
            </article>
          ))}
        </div>
      ) : (
        <EmptyBlock compact title="No actions need your attention" description="Important venue tasks will appear here." />
      )}
    </section>
  );
}

function CourtStatusList({ courts }: { courts: OwnerCourtStatus[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-lg font-black text-sportNavy">Court Status</h2>
      </div>
      {courts.length ? (
        <div className="space-y-2 p-4">
          {courts.map((court) => (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-3" key={court.court_id}>
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-sportNavy">{court.court_name}</p>
                <p className="mt-1 truncate text-xs font-semibold text-slate-500">{court.next_booking_label}</p>
              </div>
              <StatusBadge label={court.status_label} tone={courtStatusTone(court.status)} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyBlock compact title="No courts configured" description="Add at least one court to begin managing availability." />
      )}
    </section>
  );
}

function RecentActivity({ items }: { items: OwnerRecentActivity[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-lg font-black text-sportNavy">Recent Activity</h2>
      </div>
      {items.length ? (
        <div className="divide-y divide-slate-100">
          {items.map((item) => (
            <article className="flex gap-3 px-5 py-4" key={item.id}>
              <span className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${item.priority === "URGENT" ? "bg-red-50 text-red-600" : "bg-green-50 text-sportGreen"}`}>
                <OwnerDashboardIcon name={item.priority === "URGENT" ? "support" : "overview"} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-black text-sportNavy">{item.title}</h3>
                <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-600">{item.message}</p>
                <p className="mt-2 text-xs font-semibold text-slate-500">{formatDateTimeInNepal(item.created_at)}</p>
              </div>
              {item.action_url ? <Link className="self-start text-xs font-black text-sportGreen hover:text-green-700" href={item.action_url}>View</Link> : null}
            </article>
          ))}
        </div>
      ) : (
        <EmptyBlock title="No recent activity" description="Bookings, payments, refunds and verification updates will appear here." />
      )}
    </section>
  );
}

function QuickActions({ actions }: { actions: OwnerQuickAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
      {actions.map((action) => (
        <Link
          className={`inline-flex min-h-12 items-center justify-center rounded-lg border px-4 text-sm font-black transition focus:outline-none focus:ring-2 focus:ring-green-200 ${
            action.tone === "primary"
              ? "border-sportGreen bg-sportGreen text-white hover:bg-green-700"
              : action.tone === "warning"
                ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                : "border-slate-200 bg-white text-sportNavy hover:border-green-200 hover:text-sportGreen"
          }`}
          href={action.href}
          key={`${action.label}-${action.href}`}
        >
          {action.label}
        </Link>
      ))}
    </section>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "green" | "amber" | "red" | "blue" | "slate" }) {
  const classes = {
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-700",
    blue: "bg-blue-100 text-blue-700",
    slate: "bg-slate-100 text-slate-700",
  }[tone];
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${classes}`}>{label}</span>;
}

function EmptyBlock({ compact = false, description, title }: { compact?: boolean; description: string; title: string }) {
  return (
    <div className={`${compact ? "p-4" : "p-8"} text-center`}>
      <h3 className="font-black text-sportNavy">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-32 animate-pulse rounded-lg bg-white" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => <div className="h-36 animate-pulse rounded-lg bg-white" key={item} />)}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <div className="h-80 animate-pulse rounded-lg bg-white" />
          <div className="h-64 animate-pulse rounded-lg bg-white" />
        </div>
        <div className="space-y-6">
          <div className="h-64 animate-pulse rounded-lg bg-white" />
          <div className="h-72 animate-pulse rounded-lg bg-white" />
        </div>
      </div>
    </div>
  );
}

type BadgeTone = "green" | "amber" | "red" | "blue" | "slate";

function formatMoney(value: string) {
  return Number(value || 0).toLocaleString("en-NP", { maximumFractionDigits: 0 });
}

function bookingStatusLabel(status: BookingStatus) {
  return {
    RESERVED: "Reserved",
    CONFIRMED: "Confirmed",
    CANCELLED: "Cancelled",
    EXPIRED: "Expired",
    COMPLETED: "Completed",
  }[status];
}

function bookingStatusTone(status: BookingStatus): BadgeTone {
  const tones: Record<BookingStatus, BadgeTone> = {
    RESERVED: "amber",
    CONFIRMED: "green",
    CANCELLED: "red",
    EXPIRED: "slate",
    COMPLETED: "blue",
  };
  return tones[status];
}

function paymentStatusLabel(status: PaymentStatus) {
  return {
    PENDING: "Payment pending",
    PAID: "Paid",
    CANCELLED: "Payment cancelled",
    FAILED: "Payment failed",
    REFUND_PENDING: "Refund pending",
    REFUNDED: "Refunded",
    PARTIALLY_REFUNDED: "Partially refunded",
    NO_REFUND: "No refund",
  }[status];
}

function paymentStatusTone(status: PaymentStatus): BadgeTone {
  const tones: Record<PaymentStatus, BadgeTone> = {
    PENDING: "amber",
    PAID: "green",
    CANCELLED: "slate",
    FAILED: "red",
    REFUND_PENDING: "amber",
    REFUNDED: "blue",
    PARTIALLY_REFUNDED: "blue",
    NO_REFUND: "slate",
  };
  return tones[status];
}

function priorityLabel(priority: OwnerPendingAction["priority"]) {
  return priority === "URGENT" ? "Urgent" : priority === "IMPORTANT" ? "Important" : "Normal";
}

function courtStatusTone(status: OwnerCourtStatus["status"]): BadgeTone {
  const tones: Record<OwnerCourtStatus["status"], BadgeTone> = {
    AVAILABLE: "green",
    OCCUPIED: "blue",
    BLOCKED: "red",
    UNDER_MAINTENANCE: "amber",
    INACTIVE: "slate",
  };
  return tones[status];
}
