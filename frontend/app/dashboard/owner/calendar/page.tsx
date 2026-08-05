"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getLocalDateString } from "@/lib/dates";
import { emitToast } from "@/lib/toast";
import type { Booking, CourtSlot, OwnerCalendarBlockConflict, OwnerCalendarResponse, OwnerCalendarViewMode, SlotBlockType } from "@/types/venue";

const BLOCK_TYPES: Array<{ value: SlotBlockType; label: string }> = [
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "TEMPORARY_CLOSURE", label: "Temporary closure" },
  { value: "PRIVATE_USE", label: "Private use" },
  { value: "VENUE_UNAVAILABLE", label: "Venue unavailable" },
  { value: "OTHER", label: "Other" },
];
const HOUR_HEIGHT = 76;

type VisualBlock = {
  key: string;
  courtId: number;
  top: number;
  height: number;
  kind: "booking" | "reserved" | "blocked";
  statusLabel: string;
  title: string;
  subtitle: string;
  timeLabel: string;
  booking?: Booking;
};

type CalendarRange = { start: number; end: number };

export default function OwnerCalendarPage() {
  const [calendar, setCalendar] = useState<OwnerCalendarResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState(getLocalDateString());
  const [viewMode, setViewMode] = useState<OwnerCalendarViewMode>("day");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [isBlockOpen, setIsBlockOpen] = useState(false);

  useEffect(() => {
    loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, viewMode]);

  async function loadCalendar() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<OwnerCalendarResponse>(`/api/venues/owner/calendar/?date=${selectedDate}&view=${viewMode}`);
      setCalendar(response.data);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load your calendar. Please try again."));
    } finally {
      setIsLoading(false);
    }
  }

  const courts = calendar?.courts ?? [];
  const hasVenue = Boolean(calendar?.venue);
  const hasOpeningHours = Boolean(calendar?.opening_time && calendar?.closing_time);

  return (
    <>
      <OwnerPageHeader
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button className="owner-secondary-button" onClick={() => setSelectedDate(getLocalDateString())} type="button">Today</button>
            <div className="inline-flex overflow-hidden rounded-md border border-slate-200 bg-white p-1">
              {(["day", "week"] as OwnerCalendarViewMode[]).map((mode) => (
                <button className={`rounded px-3 py-2 text-sm font-black transition ${viewMode === mode ? "bg-sportGreen text-white" : "text-slate-600 hover:bg-slate-50"}`} key={mode} onClick={() => setViewMode(mode)} type="button">
                  {capitalize(mode)}
                </button>
              ))}
            </div>
            <button className="owner-primary-button" disabled={!courts.length} onClick={() => setIsBlockOpen(true)} type="button">Block Court Time</button>
          </div>
        }
        description="Review confirmed bookings, payment holds, blocked periods and court maintenance from one operational calendar."
        eyebrow="Venue Manager"
        title="Calendar"
      />

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button aria-label="Previous date" className="calendar-nav-button" onClick={() => setSelectedDate(shiftDate(selectedDate, viewMode === "day" ? -1 : -7))} type="button">&lt;</button>
            <div className="min-w-[210px] rounded-md border border-slate-200 bg-slate-50 px-4 py-2">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{viewMode === "week" ? "Selected week" : "Selected day"}</p>
              <p className="text-sm font-black text-sportNavy">{calendar ? getCalendarTitle(calendar) : formatDateLabel(selectedDate)}</p>
            </div>
            <button aria-label="Next date" className="calendar-nav-button" onClick={() => setSelectedDate(shiftDate(selectedDate, viewMode === "day" ? 1 : 7))} type="button">&gt;</button>
            <input className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-sportNavy outline-none transition focus:border-sportGreen focus:ring-2 focus:ring-green-100" onChange={(event) => setSelectedDate(event.target.value)} type="date" value={selectedDate} />
          </div>
          {calendar ? <CalendarStats calendar={calendar} /> : null}
        </div>
      </section>

      {isLoading ? <CalendarSkeleton /> : null}
      {!isLoading && error ? <ErrorState error={error} onRetry={loadCalendar} /> : null}
      {!isLoading && !error && !hasVenue ? <EmptyState title="Set up your venue first" message="Your calendar will appear after you add venue details, courts and availability." actionHref="/dashboard/owner/venue-setup" actionLabel="Complete Venue Setup" /> : null}
      {!isLoading && !error && hasVenue && courts.length === 0 ? <EmptyState title="No courts configured" message="Add at least one court before managing your venue calendar." actionHref="/dashboard/owner/courts" actionLabel="Add Court" /> : null}
      {!isLoading && !error && hasVenue && courts.length > 0 && !hasOpeningHours ? <EmptyState title="Opening hours are missing" message="Add opening and closing hours so the calendar can show your operating day clearly." actionHref="/dashboard/owner/venue-setup" actionLabel="Update Venue Hours" /> : null}

      {!isLoading && !error && calendar && hasVenue && courts.length > 0 && hasOpeningHours ? (
        <>
          {calendar.slots.length === 0 && calendar.bookings.length === 0 ? <EmptyState title="No schedule for this period" message="No generated slots, bookings or blocked court time exist for the selected date." actionHref="/dashboard/owner/availability" actionLabel="Manage Availability" /> : null}
          <div className="hidden lg:block">{viewMode === "day" ? <DayCalendarGrid calendar={calendar} onSelectBooking={setSelectedBooking} /> : <WeekCalendarGrid calendar={calendar} onSelectBooking={setSelectedBooking} />}</div>
          <div className="lg:hidden"><MobileAgenda calendar={calendar} onSelectBooking={setSelectedBooking} viewMode={viewMode} /></div>
        </>
      ) : null}

      {calendar ? <BlockCourtModal calendar={calendar} isOpen={isBlockOpen} onBlocked={() => { setIsBlockOpen(false); loadCalendar(); }} onClose={() => setIsBlockOpen(false)} selectedDate={selectedDate} /> : null}
      <BookingDetailsDrawer booking={selectedBooking} onClose={() => setSelectedBooking(null)} />
    </>
  );
}

function CalendarStats({ calendar }: { calendar: OwnerCalendarResponse }) {
  const items = [
    { label: "Bookings", value: calendar.stats.bookings_count },
    { label: "Confirmed", value: calendar.stats.confirmed_bookings },
    { label: "Payment holds", value: calendar.stats.reserved_holds },
    { label: "Blocked slots", value: calendar.stats.blocked_slots },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2" key={item.label}>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
          <p className="mt-1 text-lg font-black text-sportNavy">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function DayCalendarGrid({ calendar, onSelectBooking }: { calendar: OwnerCalendarResponse; onSelectBooking: (booking: Booking) => void }) {
  const range = getCalendarRange(calendar);
  const times = buildHourMarks(range.start, range.end);
  const blocks = buildDayBlocks(calendar, range);
  const currentOffset = getCurrentTimeOffset(calendar.date, range);
  const gridHeight = Math.max(420, ((range.end - range.start) / 60) * HOUR_HEIGHT);

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="grid border-b border-slate-200 bg-white" style={{ gridTemplateColumns: `88px repeat(${calendar.courts.length}, minmax(210px, 1fr))` }}>
        <div className="flex h-14 items-center justify-center border-r border-slate-200 text-xs font-black uppercase tracking-[0.14em] text-slate-500">Time</div>
        {calendar.courts.map((court) => <div className="flex h-14 items-center justify-center border-r border-slate-100 px-3 text-sm font-black text-sportNavy last:border-r-0" key={court.id}>{court.name}</div>)}
      </div>
      <div className="relative overflow-x-auto">
        <div className="grid min-w-[900px]" style={{ gridTemplateColumns: `88px repeat(${calendar.courts.length}, minmax(210px, 1fr))`, height: gridHeight }}>
          <div className="relative border-r border-slate-200 bg-slate-50">
            {times.map((minute) => <div className="absolute left-0 right-0 border-t border-slate-200 px-3 pt-2 text-xs font-semibold text-slate-500" key={minute} style={{ top: minuteToTop(minute, range) }}>{formatMinuteLabel(minute)}</div>)}
          </div>
          {calendar.courts.map((court) => (
            <div className="relative border-r border-slate-100 last:border-r-0" key={court.id}>
              {times.map((minute) => <div className="absolute left-0 right-0 border-t border-slate-100" key={minute} style={{ top: minuteToTop(minute, range) }} />)}
              {blocks.filter((block) => block.courtId === court.id).map((block) => <CalendarBlock block={block} key={block.key} onSelectBooking={onSelectBooking} />)}
            </div>
          ))}
        </div>
        {currentOffset !== null ? <div className="pointer-events-none absolute left-[88px] right-0 z-20 h-0.5 bg-red-500" style={{ top: currentOffset }}><span className="absolute -left-2 -top-1.5 h-3 w-3 rounded-full bg-red-500" /></div> : null}
      </div>
    </section>
  );
}

function WeekCalendarGrid({ calendar, onSelectBooking }: { calendar: OwnerCalendarResponse; onSelectBooking: (booking: Booking) => void }) {
  const days = getWeekDays(calendar.week_start);
  return (
    <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid min-w-[980px] grid-cols-7 gap-3">
        {days.map((day) => {
          const bookings = calendar.bookings.filter((booking) => booking.slot_date === day);
          const blockedSlots = calendar.slots.filter((slot) => slot.date === day && slot.status === "BLOCKED");
          return (
            <article className="min-h-[360px] rounded-md border border-slate-200 bg-slate-50 p-3" key={day}>
              <h3 className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{formatWeekday(day)}</h3>
              <p className="mt-1 text-sm font-black text-sportNavy">{formatShortDate(day)}</p>
              <div className="mt-3 space-y-2">
                {bookings.map((booking) => <button className="w-full rounded-md border border-green-200 bg-white p-3 text-left shadow-sm transition hover:border-sportGreen" key={`booking-${booking.id}`} onClick={() => onSelectBooking(booking)} type="button"><p className="text-xs font-black text-sportGreen">{formatTimeRange(booking.booking_start_time, booking.booking_end_time)}</p><p className="mt-1 truncate text-sm font-black text-sportNavy">{booking.player_name}</p><p className="mt-1 truncate text-xs font-semibold text-slate-500">{booking.court_name}</p></button>)}
                {blockedSlots.slice(0, 4).map((slot) => <div className="rounded-md border border-red-100 bg-red-50 p-3" key={`slot-${slot.id}`}><p className="text-xs font-black text-red-700">{formatTimeRange(slot.start_time, slot.end_time)}</p><p className="mt-1 truncate text-sm font-black text-red-900">{slot.block_type_display || "Blocked"}</p><p className="mt-1 truncate text-xs font-semibold text-red-700">{slot.court_name}</p></div>)}
                {!bookings.length && !blockedSlots.length ? <p className="rounded-md border border-dashed border-slate-200 bg-white p-3 text-xs font-semibold text-slate-500">No bookings or blocks.</p> : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CalendarBlock({ block, onSelectBooking }: { block: VisualBlock; onSelectBooking: (booking: Booking) => void }) {
  const isCompact = block.height < 74;
  const isTiny = block.height < 52;
  const content = (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden rounded-md border shadow-sm ${isCompact ? "px-3 py-2" : "p-3"} ${blockTone(block.kind)}`}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[10px] font-black uppercase tracking-[0.1em]">{block.statusLabel}</p>
        {isTiny ? <p className="shrink-0 text-[10px] font-bold opacity-75">{block.timeLabel}</p> : null}
      </div>
      <p className={`${isCompact ? "mt-0.5 text-xs" : "mt-1 text-sm"} min-w-0 truncate font-black leading-tight`}>{block.title}</p>
      {!isTiny ? <p className="mt-0.5 min-w-0 truncate text-[11px] font-semibold leading-tight opacity-80">{block.timeLabel}</p> : null}
      {!isCompact ? <p className="mt-auto min-w-0 truncate pt-1 text-[11px] font-semibold leading-tight opacity-70">{block.subtitle}</p> : null}
    </div>
  );
  return <div className="absolute left-3 right-3 z-10" style={{ top: `${block.top}px`, height: `${block.height}px` }}>{block.booking ? <button className="h-full w-full text-left focus:outline-none focus:ring-2 focus:ring-sportGreen focus:ring-offset-1" onClick={() => onSelectBooking(block.booking as Booking)} type="button">{content}</button> : content}</div>;
}

function MobileAgenda({ calendar, onSelectBooking, viewMode }: { calendar: OwnerCalendarResponse; onSelectBooking: (booking: Booking) => void; viewMode: OwnerCalendarViewMode }) {
  const days = viewMode === "week" ? getWeekDays(calendar.week_start) : [calendar.date];
  return (
    <section className="space-y-4">
      {days.map((day) => {
        const bookings = calendar.bookings.filter((booking) => booking.slot_date === day);
        const blockedSlots = calendar.slots.filter((slot) => slot.date === day && slot.status === "BLOCKED");
        return <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" key={day}><h2 className="text-sm font-black text-sportNavy">{formatDateLabel(day)}</h2><div className="mt-3 space-y-3">{bookings.map((booking) => <button className="w-full rounded-md border border-slate-200 bg-white p-4 text-left transition hover:border-sportGreen" key={booking.id} onClick={() => onSelectBooking(booking)} type="button"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-sportNavy">{booking.player_name}</p><p className="mt-1 text-sm font-semibold text-slate-600">{booking.court_name} - {formatTimeRange(booking.booking_start_time, booking.booking_end_time)}</p></div><StatusPill value={booking.status} /></div><p className="mt-2 text-xs font-semibold text-slate-500">{booking.booking_code} - {paymentLabel(booking.payment_status)}</p></button>)}{blockedSlots.map((slot) => <div className="rounded-md border border-red-100 bg-red-50 p-4" key={slot.id}><p className="text-xs font-black uppercase tracking-[0.12em] text-red-700">{slot.block_type_display || "Blocked"}</p><p className="mt-1 font-black text-red-950">{slot.court_name}</p><p className="mt-1 text-sm font-semibold text-red-700">{formatTimeRange(slot.start_time, slot.end_time)}</p>{slot.block_reason ? <p className="mt-2 text-sm text-red-800">{slot.block_reason}</p> : null}</div>)}{!bookings.length && !blockedSlots.length ? <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-500">No bookings or blocked periods for this day.</p> : null}</div></article>;
      })}
    </section>
  );
}

function BookingDetailsDrawer({ booking, onClose }: { booking: Booking | null; onClose: () => void }) {
  if (!booking) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-sportNavy/40" role="dialog" aria-modal="true" aria-label="Booking details">
      <button className="absolute inset-0 cursor-default" onClick={onClose} type="button" aria-label="Close booking details" />
      <aside className="relative h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-sportGreen">Booking details</p><h2 className="mt-1 text-2xl font-black text-sportNavy">{booking.booking_code}</h2></div><button className="rounded-full border border-slate-200 px-3 py-1 text-sm font-black text-slate-600 hover:bg-slate-50" onClick={onClose} type="button">Close</button></div>
        <div className="mt-6 space-y-3">
          <DetailRow label="Player" value={booking.player_name} />
          <DetailRow label="Court" value={booking.court_name} />
          <DetailRow label="Date" value={formatDateLabel(booking.slot_date)} />
          <DetailRow label="Time" value={formatTimeRange(booking.booking_start_time, booking.booking_end_time)} />
          <DetailRow label="Duration" value={`${booking.total_duration_minutes} minutes`} />
          <DetailRow label="Amount" value={`NPR ${formatMoney(booking.amount)}`} />
          <DetailRow label="Booking status" value={statusLabel(booking.status)} />
          <DetailRow label="Payment status" value={paymentLabel(booking.payment_status)} />
        </div>
        <Link className="owner-primary-button mt-6 w-full" href={`/dashboard/owner/bookings?booking=${booking.id}`}>View Full Details</Link>
      </aside>
    </div>
  );
}

function BlockCourtModal({ calendar, isOpen, onBlocked, onClose, selectedDate }: { calendar: OwnerCalendarResponse; isOpen: boolean; onBlocked: () => void; onClose: () => void; selectedDate: string }) {
  const [courtId, setCourtId] = useState("");
  const [startDate, setStartDate] = useState(selectedDate);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [blockType, setBlockType] = useState<SlotBlockType>("MAINTENANCE");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflicts, setConflicts] = useState<OwnerCalendarBlockConflict[]>([]);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setCourtId(calendar.courts[0]?.id ? String(calendar.courts[0].id) : "");
      setStartDate(selectedDate);
      setConflicts([]);
      setFormError("");
    }
  }, [calendar.courts, isOpen, selectedDate]);

  if (!isOpen) return null;

  async function submitBlock() {
    setConflicts([]);
    setFormError("");
    if (!courtId || !startDate || !startTime || !endTime || !reason.trim()) {
      setFormError("Choose a court, time and reason before blocking availability.");
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await api.post<{ blocked_count: number }>("/api/venues/owner/calendar/block/", { court_id: Number(courtId), start_date: startDate, end_date: startDate, start_time: startTime, end_time: endTime, block_type: blockType, reason, internal_note: note });
      emitToast({ message: `${response.data.blocked_count} slot${response.data.blocked_count === 1 ? "" : "s"} blocked.`, type: "success", dedupeKey: "owner-calendar-blocked" });
      onBlocked();
    } catch (requestError) {
      const typedError = requestError as { response?: { status?: number; data?: { detail?: string; conflicts?: OwnerCalendarBlockConflict[] } } };
      if (typedError.response?.status === 409 && typedError.response.data?.conflicts) {
        setConflicts(typedError.response.data.conflicts);
        setFormError(typedError.response.data.detail || "This time conflicts with an existing booking.");
      } else {
        const message = getApiErrorMessage(requestError, "We could not block that time. Please try again.");
        setFormError(message);
        emitToast({ message, type: "error", dedupeKey: "owner-calendar-block-error" });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-sportNavy/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Block court time">
      <button className="absolute inset-0 cursor-default" onClick={onClose} type="button" aria-label="Close block court form" />
      <section className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-lg sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-sportGreen">Block court time</p><h2 className="mt-1 text-2xl font-black text-sportNavy">Create an unavailable period</h2><p className="mt-2 text-sm text-slate-600">Use this for maintenance, closures, private use or any time players should not be able to book.</p></div><button className="rounded-full border border-slate-200 px-3 py-1 text-sm font-black text-slate-600 hover:bg-slate-50" onClick={onClose} type="button">Close</button></div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="calendar-field sm:col-span-2">Court<select value={courtId} onChange={(event) => setCourtId(event.target.value)}>{calendar.courts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</select></label>
          <label className="calendar-field">Date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label className="calendar-field">Block type<select value={blockType} onChange={(event) => setBlockType(event.target.value as SlotBlockType)}>{BLOCK_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
          <label className="calendar-field">Start time<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
          <label className="calendar-field">End time<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
          <label className="calendar-field sm:col-span-2">Reason<input placeholder="Example: Surface cleaning" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <label className="calendar-field sm:col-span-2">Internal note optional<textarea rows={3} placeholder="Add details for your staff if needed." value={note} onChange={(event) => setNote(event.target.value)} /></label>
        </div>
        {formError ? <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{formError}</div> : null}
        {conflicts.length ? <div className="mt-3 space-y-2 rounded-md border border-red-100 bg-red-50 p-4"><p className="text-sm font-black text-red-950">Booking conflicts</p>{conflicts.map((conflict) => <div className="rounded border border-red-100 bg-white p-3 text-sm" key={conflict.slot_id}><p className="font-black text-red-950">{conflict.court_name} - {conflict.display_time}</p><p className="mt-1 text-red-700">{conflict.booking ? `${conflict.booking.player_name} (${conflict.booking.booking_code})` : statusLabel(conflict.status)}</p></div>)}</div> : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button className="owner-secondary-button" disabled={isSubmitting} onClick={onClose} type="button">Cancel</button><button className="owner-primary-button" disabled={isSubmitting} onClick={submitBlock} type="button">{isSubmitting ? "Blocking..." : "Confirm Block"}</button></div>
      </section>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return <div className="flex items-center justify-between gap-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3"><span className="text-sm font-semibold text-slate-500">{label}</span><span className="text-right text-sm font-black text-sportNavy">{value}</span></div>;
}

function StatusPill({ value }: { value: string }) {
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${statusTone(value)}`}>{statusLabel(value)}</span>;
}

function CalendarSkeleton() {
  return <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className="h-12 animate-pulse rounded bg-slate-100" /><div className="grid gap-3 lg:grid-cols-4">{[1, 2, 3, 4].map((item) => <div className="h-32 animate-pulse rounded bg-slate-100" key={item} />)}</div><div className="h-[420px] animate-pulse rounded bg-slate-100" /></section>;
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <section className="rounded-lg border border-red-100 bg-white p-8 text-center shadow-sm"><h2 className="text-xl font-black text-sportNavy">Calendar could not be loaded</h2><p className="mt-2 text-sm text-slate-600">{error}</p><button className="owner-primary-button mt-5" onClick={onRetry} type="button">Retry</button></section>;
}

function EmptyState({ actionHref, actionLabel, message, title }: { actionHref?: string; actionLabel?: string; message: string; title: string }) {
  return <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm"><h2 className="text-xl font-black text-sportNavy">{title}</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">{message}</p>{actionHref && actionLabel ? <Link className="owner-primary-button mt-5" href={actionHref}>{actionLabel}</Link> : null}</section>;
}

function buildDayBlocks(calendar: OwnerCalendarResponse, range: CalendarRange): VisualBlock[] {
  const bookingBlocks = calendar.bookings.filter((booking) => booking.slot_date === calendar.date).map((booking) => {
    const start = parseMinutes(booking.booking_start_time);
    const end = parseMinutes(booking.booking_end_time);
    return { key: `booking-${booking.id}`, courtId: booking.court, top: minuteToTop(start, range), height: minutesToHeight(Math.max(30, end - start)), kind: booking.status === "RESERVED" ? "reserved" as const : "booking" as const, statusLabel: `${statusLabel(booking.status)} - ${paymentLabel(booking.payment_status)}`, title: booking.player_name, subtitle: booking.booking_code, timeLabel: formatTimeRange(booking.booking_start_time, booking.booking_end_time), booking };
  });
  const blockedBlocks = calendar.slots.filter((slot) => slot.date === calendar.date && slot.status === "BLOCKED").map((slot) => {
    const start = parseMinutes(slot.start_time);
    const end = parseMinutes(slot.end_time);
    return { key: `blocked-${slot.id}`, courtId: slot.court, top: minuteToTop(start, range), height: minutesToHeight(Math.max(30, end - start)), kind: "blocked" as const, statusLabel: slot.block_type_display || "Blocked", title: slot.block_reason || "Unavailable", subtitle: slot.court_name, timeLabel: formatTimeRange(slot.start_time, slot.end_time) };
  });
  return [...bookingBlocks, ...blockedBlocks].sort((a, b) => a.top - b.top);
}

function getCalendarRange(calendar: OwnerCalendarResponse): CalendarRange {
  const opening = calendar.opening_time ? parseMinutes(calendar.opening_time) : 360;
  const closing = calendar.closing_time ? parseMinutes(calendar.closing_time) : 1320;
  const slotMinutes = calendar.slots.flatMap((slot) => [parseMinutes(slot.start_time), parseMinutes(slot.end_time)]);
  const bookingMinutes = calendar.bookings.flatMap((booking) => [parseMinutes(booking.booking_start_time), parseMinutes(booking.booking_end_time)]);
  const minutes = [opening, closing, ...slotMinutes, ...bookingMinutes].filter((value) => Number.isFinite(value));
  const start = Math.max(0, Math.floor(Math.min(...minutes) / 60) * 60);
  const end = Math.min(1440, Math.ceil(Math.max(...minutes) / 60) * 60);
  return { start, end: Math.max(end, start + 60) };
}

function buildHourMarks(start: number, end: number) {
  const marks: number[] = [];
  for (let minute = start; minute <= end; minute += 60) marks.push(minute);
  return marks;
}

function minuteToTop(minute: number, range: CalendarRange) {
  return ((minute - range.start) / 60) * HOUR_HEIGHT;
}

function minutesToHeight(minutes: number) {
  return Math.max(54, (minutes / 60) * HOUR_HEIGHT - 8);
}

function getCurrentTimeOffset(date: string, range: CalendarRange) {
  if (date !== getLocalDateString()) return null;
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  if (minute < range.start || minute > range.end) return null;
  return minuteToTop(minute, range);
}

function parseMinutes(value?: string | null) {
  if (!value) return 0;
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function formatMinuteLabel(minute: number) {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return new Date(2020, 0, 1, hours, minutes).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatTimeRange(start?: string | null, end?: string | null) {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

function formatTime(value?: string | null) {
  if (!value) return "TBD";
  const [hours = "0", minutes = "0"] = value.split(":");
  return new Date(2020, 0, 1, Number(hours), Number(minutes)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function getWeekDays(weekStart: string) {
  return Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index));
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function getCalendarTitle(calendar: OwnerCalendarResponse) {
  if (calendar.view === "week") return `${formatShortDate(calendar.week_start)} - ${formatShortDate(calendar.week_end)}`;
  return formatDateLabel(calendar.date);
}

function formatDateLabel(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

function formatShortDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatWeekday(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

function formatMoney(value: string) {
  return Number(value || 0).toLocaleString("en-NP", { maximumFractionDigits: 0 });
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function paymentLabel(value: string) {
  if (value === "PAID") return "Paid";
  if (value === "PENDING") return "Payment pending";
  if (value === "REFUND_PENDING") return "Refund pending";
  if (value === "NO_REFUND") return "No refund";
  return statusLabel(value);
}

function blockTone(kind: VisualBlock["kind"]) {
  if (kind === "blocked") return "border-red-200 bg-red-50 text-red-900";
  if (kind === "reserved") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-green-200 bg-green-50 text-green-950";
}

function statusTone(value: string) {
  if (["CONFIRMED", "COMPLETED", "PAID"].includes(value)) return "bg-green-100 text-green-800";
  if (["RESERVED", "PENDING"].includes(value)) return "bg-amber-100 text-amber-800";
  if (["BLOCKED", "CANCELLED", "FAILED"].includes(value)) return "bg-red-100 text-red-800";
  return "bg-slate-100 text-slate-700";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
