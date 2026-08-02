"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import CancelBookingModal, { type CancelBookingPayload } from "@/components/CancelBookingModal";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateOnly } from "@/lib/dates";
import { emitToast } from "@/lib/toast";
import type { Booking, BookingStatus, RefundStatus } from "@/types/venue";

type BookingTab = "upcoming" | "past" | "cancelled";
type SortMode = "soonest" | "latest";

type Filters = {
  from: string;
  to: string;
  status: string;
  sort: SortMode;
};

const defaultFilters: Filters = {
  from: "",
  to: "",
  status: "ALL",
  sort: "soonest",
};

const tabLabels: { key: BookingTab; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "cancelled", label: "Cancelled & Refunds" },
];

export default function PlayerBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [activeTab, setActiveTab] = useState<BookingTab>("upcoming");
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const state = readQueryState();
    setActiveTab(state.tab);
    setFilters(state.filters);
    loadBookings();

    function syncFromHistory() {
      const nextState = readQueryState();
      setActiveTab(nextState.tab);
      setFilters(nextState.filters);
    }

    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, []);

  useEffect(() => {
    setNow(new Date());
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  function updateRoute(nextTab: BookingTab, nextFilters: Filters) {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (nextTab !== "upcoming") params.set("tab", nextTab);
    if (nextFilters.from) params.set("from", nextFilters.from);
    if (nextFilters.to) params.set("to", nextFilters.to);
    if (nextFilters.status !== "ALL") params.set("status", nextFilters.status);
    if (nextFilters.sort !== getDefaultSort(nextTab)) params.set("sort", nextFilters.sort);
    const query = params.toString();
    window.history.replaceState(null, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
  }

  function changeTab(tab: BookingTab) {
    const nextFilters = getFiltersForTab(tab, filters);
    setActiveTab(tab);
    setFilters(nextFilters);
    updateRoute(tab, nextFilters);
  }

  function updateFilters(nextFilters: Filters) {
    setFilters(nextFilters);
    updateRoute(activeTab, nextFilters);
  }

  async function loadBookings() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<{ bookings: Booking[] }>("/api/venues/bookings/my/");
      setBookings(response.data.bookings);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load your bookings. Please try again."));
    } finally {
      setIsLoading(false);
    }
  }

  async function cancelBooking(payload: CancelBookingPayload) {
    if (!bookingToCancel) return;
    setIsCancelling(true);
    try {
      const response = await api.post<{ booking: Booking }>(`/api/venues/bookings/${bookingToCancel.id}/cancel/`, payload);
      setBookings((currentBookings) => currentBookings.map((booking) => (booking.id === response.data.booking.id ? response.data.booking : booking)));
      setBookingToCancel(null);
      emitToast({
        message: getCancellationSuccessMessage(response.data.booking),
        type: "success",
        dedupeKey: `booking-cancelled-${response.data.booking.id}`,
      });
    } catch (requestError) {
      getApiErrorMessage(requestError, "This booking is no longer eligible for cancellation.");
    } finally {
      setIsCancelling(false);
    }
  }

  const grouped = useMemo(() => groupBookings(bookings), [bookings]);
  const tabCounts = {
    upcoming: grouped.upcoming.length,
    past: grouped.past.length,
    cancelled: grouped.cancelled.length,
  };

  const nearestBooking = useMemo(() => getNearestConfirmedBooking(grouped.upcoming, now), [grouped.upcoming, now]);
  const filteredBookings = useMemo(() => {
    const source = grouped[activeTab];
    return applyFilters(source, filters);
  }, [activeTab, filters, grouped]);

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-sportGreen">Court reservations</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-sportNavy sm:text-3xl">My Bookings</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Manage your upcoming court bookings and booking history.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <DateFilter filters={filters} onChange={updateFilters} />
          <Link className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-sportGreen px-5 text-sm font-black text-white shadow-sm transition hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-200" href="/courts">
            <PlusIcon /> Book a Court
          </Link>
        </div>
      </section>

      {isLoading ? <TrackerSkeleton /> : nearestBooking && now ? <NextBookingTracker booking={nearestBooking} now={now} /> : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-4 pt-4 sm:px-5 sm:pt-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Booking sections">
            {tabLabels.map((tab) => (
              <TabButton active={activeTab === tab.key} count={tabCounts[tab.key]} key={tab.key} label={tab.label} onClick={() => changeTab(tab.key)} />
            ))}
          </div>
          <div className="grid gap-2 pb-4 sm:grid-cols-2 lg:min-w-[360px] lg:pb-3">
            <label className="block">
              <span className="sr-only">Booking status</span>
              <select className={selectClassName} onChange={(event) => updateFilters({ ...filters, status: event.target.value })} value={filters.status}>
                {getStatusOptions(activeTab).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="sr-only">Sort bookings</span>
              <select className={selectClassName} onChange={(event) => updateFilters({ ...filters, sort: event.target.value as SortMode })} value={filters.sort}>
                {getSortOptions(activeTab).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {isLoading ? (
          <BookingsSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={loadBookings} />
        ) : filteredBookings.length === 0 ? (
          <EmptyState activeTab={activeTab} hasFilters={hasActiveFilters(activeTab, filters)} onClear={() => updateFilters(getFiltersForTab(activeTab, defaultFilters))} />
        ) : (
          <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-2 2xl:grid-cols-3">
            {filteredBookings.map((booking) => (
              <BookingCard booking={booking} key={booking.id} onCancel={() => setBookingToCancel(booking)} />
            ))}
          </div>
        )}
      </section>

      {bookingToCancel ? (
        <CancelBookingModal actor="player" booking={bookingToCancel} isWorking={isCancelling} onClose={() => setBookingToCancel(null)} onConfirm={cancelBooking} />
      ) : null}
    </div>
  );
}

function DateFilter({ filters, onChange }: { filters: Filters; onChange: (filters: Filters) => void }) {
  return (
    <details className="group relative">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-sportNavy shadow-sm transition hover:border-green-200 hover:text-sportGreen focus:outline-none focus:ring-2 focus:ring-green-200">
        <CalendarIcon /> {getDateFilterLabel(filters)}
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-[min(90vw,360px)] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">From</span>
            <input className={inputClassName} onChange={(event) => { const from = event.target.value; onChange({ ...filters, from, to: filters.to && filters.to < from ? "" : filters.to }); }} type="date" value={filters.from} />
          </label>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">To</span>
            <input className={inputClassName} min={filters.from || undefined} onChange={(event) => onChange({ ...filters, to: event.target.value })} type="date" value={filters.to} />
          </label>
        </div>
        <button className="mt-3 min-h-10 w-full rounded-xl border border-slate-200 text-sm font-black text-slate-600 hover:bg-slate-50" onClick={() => onChange({ ...filters, from: "", to: "" })} type="button">
          Clear Dates
        </button>
      </div>
    </details>
  );
}

function NextBookingTracker({ booking, now }: { booking: Booking; now: Date }) {
  const phase = getBookingPhase(booking, now);
  const countdown = getCountdownParts(booking, now);
  const directionHref = booking.venue_map_location || "";

  if (phase === "ended") return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-white shadow-lg">
      <div className="grid lg:grid-cols-[1.15fr_1fr_auto]">
        <div className="p-5 sm:p-6">
          <div className="flex items-center gap-2 text-sm font-black text-green-300"><span className="h-2.5 w-2.5 rounded-full bg-green-400" /> Live Tracking</div>
          <h2 className="mt-3 text-2xl font-black uppercase tracking-tight sm:text-3xl">{booking.venue_name}</h2>
          <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-300"><LocationIcon /> {booking.court_name} · {booking.venue_area}, {booking.venue_city}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusBadge status={booking.status} />
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-slate-200">{formatDateOnly(booking.slot_date)}</span>
          </div>
        </div>
        <div className="border-y border-white/10 bg-black/15 p-5 text-center sm:p-6 lg:border-x lg:border-y-0">
          <p className="text-sm font-black text-slate-300">{phase === "before" ? "Starts in" : phase === "active" ? "In progress" : "Starting now"}</p>
          {phase === "before" ? (
            <div className="mt-3 flex items-end justify-center gap-3 font-black">
              <CountdownUnit label="Hrs" value={countdown.hours} />
              <span className="pb-5 text-2xl text-slate-500">:</span>
              <CountdownUnit label="Mins" value={countdown.minutes} />
              <span className="pb-5 text-2xl text-slate-500">:</span>
              <CountdownUnit label="Secs" value={countdown.seconds} />
            </div>
          ) : (
            <p className="mt-3 text-3xl font-black text-green-300">{phase === "active" ? "Now" : "Starting"}</p>
          )}
          <p className="mt-3 text-xs font-semibold text-slate-400">{booking.booking_display_time || booking.slot_display_time}</p>
        </div>
        <div className="flex flex-col justify-center gap-3 p-5 sm:flex-row sm:items-center sm:p-6 lg:flex-col">
          <Link className="inline-flex min-h-11 items-center justify-center rounded-xl bg-white px-5 text-sm font-black text-sportNavy hover:bg-slate-100" href={`/dashboard/player/bookings/${booking.id}`}>
            View Booking
          </Link>
          {directionHref ? (
            <a className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-green-500 px-5 text-sm font-black text-green-950 hover:bg-green-400" href={directionHref} rel="noreferrer" target="_blank">
              <DirectionIcon /> Get Directions
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function BookingCard({ booking, onCancel }: { booking: Booking; onCancel: () => void }) {
  const imageSrc = getMediaSrc(booking.venue_primary_image || booking.court_photo);
  const time = booking.booking_display_time || booking.slot_display_time;
  const isReserved = booking.status === "RESERVED" && booking.payment_status === "PENDING";
  const isConfirmed = booking.status === "CONFIRMED" && booking.payment_status === "PAID";
  const isCompleted = booking.status === "COMPLETED";
  const isCancelled = booking.status === "CANCELLED" || booking.status === "EXPIRED";

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-green-200 hover:shadow-md">
      <div className="relative h-40 overflow-hidden bg-slate-100">
        {imageSrc ? (
          <img alt={`${booking.venue_name} court`} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" src={imageSrc} />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-green-900 text-sm font-black uppercase tracking-[0.16em] text-white">SportSpot</div>
        )}
        <div className="absolute right-3 top-3"><StatusBadge status={booking.status} /></div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-sportGreen">{booking.booking_code}</p>
            <h2 className="mt-1 line-clamp-2 text-xl font-black leading-tight text-sportNavy">{booking.venue_name}</h2>
          </div>
          <p className="shrink-0 text-right text-lg font-black text-sportGreen">NPR<br />{formatMoney(booking.amount)}</p>
        </div>
        <div className="mt-4 space-y-2.5 text-sm font-semibold text-slate-600">
          <IconLine icon={<CourtIcon />} text={`${booking.court_name} · ${booking.venue_area}, ${booking.venue_city}`} />
          <IconLine icon={<CalendarIcon />} text={`${formatDateOnly(booking.slot_date)} · ${time}`} />
          <IconLine icon={<ClockIcon />} text={`${formatDuration(booking.total_duration_minutes)} · ${booking.slots_count} slot${booking.slots_count === 1 ? "" : "s"}`} />
        </div>
        {isCancelled ? (
          <div className="mt-4 rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Refund status</p>
            <p className="mt-1 text-sm font-black text-sportNavy">{formatRefundStatus(booking.refund_status)}</p>
            {booking.refund_reason ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{booking.refund_reason}</p> : null}
          </div>
        ) : null}
        <div className="mt-auto pt-5">
          <div className="mb-4 h-px bg-slate-100" />
          <div className="grid gap-2 sm:grid-cols-2">
            <Link className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-100 px-4 text-sm font-black text-sportNavy hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-green-200" href={`/dashboard/player/bookings/${booking.id}`}>
              View Booking
            </Link>
            {isReserved ? (
              <Link className="inline-flex min-h-11 items-center justify-center rounded-xl bg-sportGreen px-4 text-sm font-black text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-200" href={`/dashboard/player/bookings/payment/${booking.id}`}>
                Continue Payment
              </Link>
            ) : isConfirmed ? (
              <Link className="inline-flex min-h-11 items-center justify-center rounded-xl bg-sportGreen px-4 text-sm font-black text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-200" href={`/dashboard/player/bookings/${booking.id}`}>
                View Booking Pass
              </Link>
            ) : isCompleted ? (
              <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-green-200 px-4 text-sm font-black text-sportGreen hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-green-200" href={`/courts/${booking.venue}`}>
                Book Again
              </Link>
            ) : null}
            {booking.venue_map_location ? (
              <a className="inline-flex min-h-11 items-center justify-center rounded-xl border border-green-200 px-4 text-sm font-black text-sportGreen hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-green-200" href={booking.venue_map_location} rel="noreferrer" target="_blank">
                Get Directions
              </a>
            ) : null}
            {booking.can_cancel ? (
              <button className="inline-flex min-h-11 items-center justify-center rounded-xl border border-red-200 px-4 text-sm font-black text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-200" onClick={onCancel} type="button">
                Cancel Booking
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function EmptyState({ activeTab, hasFilters, onClear }: { activeTab: BookingTab; hasFilters: boolean; onClear: () => void }) {
  const copy = {
    upcoming: {
      title: "You have no upcoming bookings.",
      description: "Book an approved Cricksal court and your reservation will appear here.",
      action: "Book a Court",
      href: "/courts",
    },
    past: {
      title: "You have no past bookings yet.",
      description: "Completed court bookings will appear here after your slot ends.",
      action: "Browse Courts",
      href: "/courts",
    },
    cancelled: {
      title: "You have no cancellations or refunds.",
      description: "Cancelled, expired, and refund-related bookings will appear here.",
      action: "View Upcoming",
      href: "",
    },
  }[activeTab];

  return (
    <section className="m-4 rounded-2xl border border-dashed border-green-300 bg-green-50 p-8 text-center sm:m-5">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-sportGreen shadow-sm"><CalendarIcon /></div>
      <h2 className="mt-4 text-xl font-black text-sportNavy">{hasFilters ? "No bookings match your filters." : copy.title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">{hasFilters ? "Try changing the date range or status filter." : copy.description}</p>
      <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
        {hasFilters ? (
          <button className="inline-flex min-h-11 items-center justify-center rounded-xl bg-sportGreen px-5 text-sm font-black text-white hover:bg-green-700" onClick={onClear} type="button">Clear Filters</button>
        ) : copy.href ? (
          <Link className="inline-flex min-h-11 items-center justify-center rounded-xl bg-sportGreen px-5 text-sm font-black text-white hover:bg-green-700" href={copy.href}>{copy.action}</Link>
        ) : null}
      </div>
    </section>
  );
}

function BookingsSkeleton() {
  return (
    <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-2 2xl:grid-cols-3">
      {[0, 1, 2].map((item) => <div className="h-[420px] animate-pulse rounded-2xl bg-slate-100" key={item} />)}
    </div>
  );
}

function TrackerSkeleton() {
  return <div className="h-44 animate-pulse rounded-2xl bg-slate-100" />;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="m-4 rounded-2xl border border-red-100 bg-red-50 p-6 sm:m-5">
      <p className="text-sm font-black uppercase tracking-wide text-red-600">Bookings unavailable</p>
      <h2 className="mt-2 text-2xl font-black text-red-950">We could not load your bookings.</h2>
      <p className="mt-2 max-w-xl text-sm font-semibold leading-6 text-red-700">{message}</p>
      <button className="mt-5 min-h-11 rounded-xl bg-red-600 px-5 text-sm font-black text-white hover:bg-red-700" onClick={onRetry} type="button">Retry</button>
    </section>
  );
}

function TabButton({ active, count, label, onClick }: { active: boolean; count: number; label: string; onClick: () => void }) {
  return (
    <button aria-selected={active} className={`relative min-h-12 shrink-0 px-3 text-sm font-black transition focus:outline-none focus:ring-2 focus:ring-green-200 ${active ? "text-sportGreen" : "text-slate-600 hover:text-sportNavy"}`} onClick={onClick} role="tab" type="button">
      {label}
      {count > 0 ? <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${active ? "bg-green-50 text-sportGreen" : "bg-slate-100 text-slate-600"}`}>{count}</span> : null}
      {active ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-sportGreen" /> : null}
    </button>
  );
}

function StatusBadge({ status }: { status: BookingStatus }) {
  const tone = {
    RESERVED: "bg-amber-100 text-amber-800",
    CONFIRMED: "bg-green-100 text-green-800",
    CANCELLED: "bg-red-100 text-red-800",
    EXPIRED: "bg-slate-200 text-slate-700",
    COMPLETED: "bg-blue-100 text-blue-800",
  }[status];
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${tone}`}>{formatBookingStatus(status)}</span>;
}

function CountdownUnit({ label, value }: { label: string; value: number }) {
  return <div><p className="text-4xl font-black tabular-nums sm:text-5xl">{String(value).padStart(2, "0")}</p><p className="mt-1 text-xs font-black uppercase text-slate-400">{label}</p></div>;
}

function IconLine({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <p className="flex items-start gap-2"><span className="mt-0.5 text-sportGreen">{icon}</span><span className="min-w-0">{text}</span></p>;
}

function getDateFilterLabel(filters: Filters) {
  if (filters.from && filters.to) return `${formatDateOnly(filters.from, { month: "short", day: "numeric" })} - ${formatDateOnly(filters.to, { month: "short", day: "numeric" })}`;
  if (filters.from) return `From ${formatDateOnly(filters.from, { month: "short", day: "numeric" })}`;
  if (filters.to) return `Until ${formatDateOnly(filters.to, { month: "short", day: "numeric" })}`;
  return "All Dates";
}

function getDefaultSort(tab: BookingTab): SortMode {
  return tab === "upcoming" ? "soonest" : "latest";
}

function getFiltersForTab(tab: BookingTab, currentFilters: Filters): Filters {
  return {
    ...currentFilters,
    status: "ALL",
    sort: getDefaultSort(tab),
  };
}

function getStatusOptions(tab: BookingTab) {
  if (tab === "upcoming") {
    return [
      { value: "ALL", label: "All upcoming" },
      { value: "CONFIRMED", label: "Confirmed" },
      { value: "RESERVED", label: "Awaiting payment" },
    ];
  }

  if (tab === "past") {
    return [
      { value: "ALL", label: "All past bookings" },
      { value: "COMPLETED", label: "Completed" },
    ];
  }

  return [
    { value: "ALL", label: "All cancelled & refunds" },
    { value: "CANCELLED", label: "Cancelled" },
    { value: "EXPIRED", label: "Expired" },
    { value: "REFUND_PENDING", label: "Refund pending" },
    { value: "REFUND_PROCESSED", label: "Refund processed" },
    { value: "REFUND_NOT_ELIGIBLE", label: "Not eligible" },
  ];
}

function getSortOptions(tab: BookingTab): { value: SortMode; label: string }[] {
  if (tab === "upcoming") {
    return [
      { value: "soonest", label: "Upcoming soonest" },
      { value: "latest", label: "Recently booked" },
    ];
  }

  if (tab === "past") {
    return [
      { value: "latest", label: "Recently completed" },
      { value: "soonest", label: "Oldest completed" },
    ];
  }

  return [
    { value: "latest", label: "Recently updated" },
    { value: "soonest", label: "Original booking date" },
  ];
}

function normalizeStatusForTab(tab: BookingTab, status: string) {
  return getStatusOptions(tab).some((option) => option.value === status) ? status : "ALL";
}

function matchesStatusFilter(booking: Booking, status: string) {
  if (status === "ALL") return true;
  if (["RESERVED", "CONFIRMED", "COMPLETED", "CANCELLED", "EXPIRED"].includes(status)) return booking.status === status;
  if (status === "REFUND_PENDING") return booking.refund_status === "PENDING_OWNER_ACTION" || booking.payment_status === "REFUND_PENDING";
  if (status === "REFUND_PROCESSED") return booking.refund_status === "REFUNDED" || booking.refund_status === "PARTIALLY_REFUNDED";
  if (status === "REFUND_NOT_ELIGIBLE") return booking.refund_status === "NOT_ELIGIBLE" || booking.payment_status === "NO_REFUND";
  return true;
}
function groupBookings(bookings: Booking[]) {
  return {
    upcoming: bookings.filter((booking) => ["RESERVED", "CONFIRMED"].includes(booking.status)),
    past: bookings.filter((booking) => booking.status === "COMPLETED"),
    cancelled: bookings.filter((booking) => booking.status === "CANCELLED" || booking.status === "EXPIRED" || isRefundRelated(booking)),
  };
}

function applyFilters(bookings: Booking[], filters: Filters) {
  const filtered = bookings.filter((booking) => {
    if (!matchesStatusFilter(booking, filters.status)) return false;
    if (filters.from && booking.slot_date < filters.from) return false;
    if (filters.to && booking.slot_date > filters.to) return false;
    return true;
  });

  return [...filtered].sort((a, b) => {
    if (filters.sort === "latest") return getLatestActivityMs(b) - getLatestActivityMs(a);
    return getBookingStartMs(a) - getBookingStartMs(b);
  });
}

function getNearestConfirmedBooking(bookings: Booking[], now: Date | null) {
  if (!now) return null;
  return bookings
    .filter((booking) => booking.status === "CONFIRMED" && booking.payment_status === "PAID")
    .filter((booking) => getBookingEndMs(booking) >= now.getTime())
    .sort((a, b) => getBookingStartMs(a) - getBookingStartMs(b))[0] || null;
}

function getBookingPhase(booking: Booking, now: Date) {
  const startMs = getBookingStartMs(booking);
  const endMs = getBookingEndMs(booking);
  const currentMs = now.getTime();
  if (currentMs >= endMs) return "ended";
  if (currentMs >= startMs) return "active";
  if (startMs - currentMs <= 1000) return "starting";
  return "before";
}

function getCountdownParts(booking: Booking, now: Date) {
  const diffSeconds = Math.max(0, Math.floor((getBookingStartMs(booking) - now.getTime()) / 1000));
  return {
    hours: Math.floor(diffSeconds / 3600),
    minutes: Math.floor((diffSeconds % 3600) / 60),
    seconds: diffSeconds % 60,
  };
}

function getBookingStartMs(booking: Booking) {
  if (booking.slot_start_at) return new Date(booking.slot_start_at).getTime();
  return new Date(`${booking.slot_date}T${booking.booking_start_time || booking.slot_start_time}`).getTime();
}

function getBookingEndMs(booking: Booking) {
  return getBookingStartMs(booking) + booking.total_duration_minutes * 60 * 1000;
}

function getLatestActivityMs(booking: Booking) {
  const activityDate = booking.cancelled_at || booking.completed_at || booking.confirmed_at || booking.updated_at || booking.created_at;
  return new Date(activityDate).getTime();
}

function isRefundRelated(booking: Booking) {
  return booking.refund_status !== "NOT_REQUIRED" || ["REFUND_PENDING", "REFUNDED", "PARTIALLY_REFUNDED", "NO_REFUND"].includes(booking.payment_status);
}

function hasActiveFilters(_tab: BookingTab, filters: Filters) {
  return Boolean(filters.from || filters.to || filters.status !== "ALL");
}

function readQueryState(): { tab: BookingTab; filters: Filters } {
  if (typeof window === "undefined") return { tab: "upcoming", filters: defaultFilters };
  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get("tab") as BookingTab | null;
  const tab = tabParam && ["upcoming", "past", "cancelled"].includes(tabParam) ? tabParam : "upcoming";
  const sortParam = params.get("sort") as SortMode | null;
  const sort = sortParam === "soonest" || sortParam === "latest" ? sortParam : getDefaultSort(tab);
  return {
    tab,
    filters: {
      from: params.get("from") || "",
      to: params.get("to") || "",
      status: normalizeStatusForTab(tab, params.get("status") || "ALL"),
      sort,
    },
  };
}

function getCancellationSuccessMessage(booking: Booking) {
  if (booking.refund_status === "PENDING_OWNER_ACTION") return "Your booking has been cancelled. Your refund request is being reviewed by the venue.";
  if (booking.refund_status === "NOT_ELIGIBLE") return "Your booking has been cancelled. This booking is not eligible for a refund.";
  return "Your booking has been cancelled.";
}

function formatBookingStatus(status: BookingStatus) {
  const labels: Record<BookingStatus, string> = {
    RESERVED: "Awaiting payment",
    CONFIRMED: "Confirmed",
    CANCELLED: "Cancelled",
    EXPIRED: "Expired",
    COMPLETED: "Completed",
  };
  return labels[status];
}

function formatRefundStatus(status: RefundStatus) {
  const labels: Record<RefundStatus, string> = {
    NOT_REQUIRED: "No refund needed",
    PENDING_OWNER_ACTION: "Pending review",
    NOT_ELIGIBLE: "Not eligible",
    REJECTED: "Rejected",
    REFUNDED: "Processed",
    PARTIALLY_REFUNDED: "Processed",
  };
  return labels[status];
}

function formatDuration(minutes: number) {
  if (!minutes) return "Not set";
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hour${hours === 1 ? "" : "s"}` : `${minutes} minutes`;
}

function formatMoney(value: string) {
  return Number(value || 0).toLocaleString("en-NP", { maximumFractionDigits: 0 });
}

function getMediaSrc(value: string | null | undefined) {
  if (!value) return "";
  if (value.startsWith("http")) return value;
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
  return `${apiBaseUrl}${value}`;
}

const inputClassName = "mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-sportGreen focus:ring-2 focus:ring-green-100";
const selectClassName = "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-sportNavy outline-none transition focus:border-sportGreen focus:ring-2 focus:ring-green-100";

function PlusIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" /></svg>; }
function CalendarIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M7 3v4M17 3v4M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
function LocationIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M12 21s7-4.4 7-11a7 7 0 1 0-14 0c0 6.6 7 11 7 11Z" stroke="currentColor" strokeWidth="2" /><path d="M12 10.5h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="3" /></svg>; }
function DirectionIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="m12 3 9 9-9 9-9-9 9-9Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" /><path d="M9 12h6m0 0-2-2m2 2-2 2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
function CourtIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M4 6h16v12H4V6Zm8 0v12M4 12h16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
function ClockIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
