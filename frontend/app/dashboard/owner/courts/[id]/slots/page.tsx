"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import FeedbackToast from "@/components/FeedbackToast";
import TimeSelect from "@/components/TimeSelect";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { addCalendarDays, buildTimeOptions, formatDateOnly, getLocalDateString } from "@/lib/dates";
import { estimateGeneratedSlots } from "@/lib/slotSchedule";
import type { CourtSlot } from "@/types/venue";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const today = getLocalDateString();
const maximumGenerationDate = addCalendarDays(today, 89);

export default function OwnerCourtSlotsPage() {
  const params = useParams<{ id: string }>();
  const courtId = params.id;
  const [slots, setSlots] = useState<CourtSlot[]>([]);
  const [date, setDate] = useState(getLocalDateString());
  const [form, setForm] = useState({
    available_days: ["Saturday", "Sunday"],
    start_date: today,
    end_date: addCalendarDays(today, 29),
    opening_time: "06:00",
    closing_time: "20:00",
    slot_duration_minutes: "60",
    base_price: "1500",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const feedbackMessage = error || message;
  const feedbackType = error ? "error" : message ? "success" : "info";
  const estimatedSlots = estimateGeneratedSlots({
    startDate: form.start_date,
    endDate: form.end_date,
    availableDays: form.available_days,
    openingTime: form.opening_time,
    closingTime: form.closing_time,
    durationMinutes: form.slot_duration_minutes,
  });

  useEffect(() => {
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, courtId]);

  useEffect(() => {
    loadGenerationDefaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courtId]);

  async function loadGenerationDefaults() {
    try {
      const [venueResponse, courtResponse] = await Promise.all([
        api.get<{ venue: { opening_time: string | null; closing_time: string | null } | null }>("/api/venues/owner/venue/"),
        api.get<{ court: { lowest_price: string | null } }>(`/api/venues/owner/courts/${courtId}/`),
      ]);
      const venue = venueResponse.data.venue;
      const court = courtResponse.data.court;
      setForm((current) => ({
        ...current,
        opening_time: venue?.opening_time?.slice(0, 5) || current.opening_time,
        closing_time: venue?.closing_time?.slice(0, 5) || current.closing_time,
        base_price: court?.lowest_price || current.base_price,
      }));
    } catch {
      // The generation form remains usable with sensible local defaults if
      // optional defaults cannot be loaded.
    }
  }

  async function loadSlots() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<{ slots: CourtSlot[] }>(`/api/venues/owner/slots/?court_id=${courtId}&date=${date}`);
      setSlots(response.data.slots);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load slots."));
    } finally {
      setIsLoading(false);
    }
  }

  async function generateSlots() {
    setIsSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await api.post<{
        created_count: number;
        skipped_count: number;
        existing_count: number;
        overlap_count: number;
        skipped_past_count: number;
        trailing_minutes: number;
        start_date: string;
        end_date: string;
      }>(`/api/venues/owner/courts/${courtId}/slots/generate/`, form);
      const notes = [
        response.data.existing_count ? `${response.data.existing_count} existing slots kept` : "",
        response.data.overlap_count ? `${response.data.overlap_count} overlapping slots skipped` : "",
        response.data.skipped_past_count ? `${response.data.skipped_past_count} past slots skipped` : "",
        response.data.trailing_minutes ? `${response.data.trailing_minutes} minutes left unused at the end of each selected day` : "",
      ].filter(Boolean);
      setMessage(
        `Created ${response.data.created_count} slots from ${formatDateOnly(response.data.start_date)} to ${formatDateOnly(response.data.end_date)}.${notes.length ? ` ${notes.join(". ")}.` : ""}`,
      );
      loadSlots();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not generate slots."));
    } finally {
      setIsSaving(false);
    }
  }

  async function clearFutureSlots() {
    setIsSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await api.post<{
        cleared_count: number;
        protected_count: number;
        start_date: string;
        end_date: string;
      }>(`/api/venues/owner/courts/${courtId}/slots/clear/`, {
        start_date: form.start_date,
        end_date: form.end_date,
      });
      setMessage(
        response.data.cleared_count
          ? `Cleared ${response.data.cleared_count} future unbooked slots from ${formatDateOnly(response.data.start_date)} to ${formatDateOnly(response.data.end_date)}. ${response.data.protected_count} slots were kept protected.`
          : `No future unbooked slots were cleared. ${response.data.protected_count} slots in this range were kept protected.`,
      );
      setIsClearConfirmOpen(false);
      await loadSlots();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not clear future availability."));
    } finally {
      setIsSaving(false);
    }
  }

  function updateGenerationRange(field: "start_date" | "end_date", value: string) {
    setForm((current) => {
      if (field === "start_date") {
        return { ...current, start_date: value, end_date: current.end_date < value ? value : current.end_date };
      }
      return { ...current, end_date: value };
    });
  }

  function selectDays(nextDays: string[]) {
    setForm((current) => ({ ...current, available_days: nextDays }));
  }

  async function updateSlot(slotId: number, action: "block" | "unblock") {
    setMessage("");
    setError("");
    try {
      await api.post(`/api/venues/owner/slots/${slotId}/${action}/`);
      setMessage(action === "block" ? "Slot blocked. Players cannot book it now." : "Slot unblocked. Players can book it again.");
      loadSlots();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not update slot."));
    }
  }

  return (
    <div className="space-y-6">
      <FeedbackToast message={feedbackMessage} onClose={() => { setMessage(""); setError(""); }} type={feedbackType} />

      <OwnerPageHeader backHref="/dashboard/owner/courts" backLabel="Back to courts" description="Create a dated publishing window for this court, set its rate, and manage future availability." eyebrow="Venue Manager" title="Court Slots" />

      <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="owner-panel sport-card">
          <h2 className="text-xl font-black text-sportNavy">Generate Slots</h2>
          <p className="mt-2 text-sm text-slate-600">
            Set one weekly schedule and choose exactly how far ahead players should be able to book. Existing slots are kept, so generating again is safe.
          </p>
          <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-black text-sportNavy">Publishing window</h3>
                <p className="mt-1 text-xs leading-5 text-slate-600">The selected weekdays repeat between these dates. You can generate up to 90 days at a time.</p>
              </div>
              <span className="rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-black text-green-800">Nepal time</span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Input label="Generate from" type="date" min={today} max={maximumGenerationDate} value={form.start_date} onChange={(value) => updateGenerationRange("start_date", value)} />
              <Input label="Generate until" type="date" min={form.start_date} max={maximumGenerationDate} value={form.end_date} onChange={(value) => updateGenerationRange("end_date", value)} />
            </div>
            <p className="mt-3 text-xs font-semibold text-slate-600">Estimated: up to <strong className="text-sportNavy">{estimatedSlots.toLocaleString()}</strong> slots for this court.</p>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block"><span className="text-sm font-black text-sportNavy">Opening time</span><TimeSelect ariaLabel="Opening time" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-sm outline-none focus:border-sportGreen" options={buildTimeOptions()} value={form.opening_time} onChange={(value) => setForm({ ...form, opening_time: value })} /></label>
            <label className="block"><span className="text-sm font-black text-sportNavy">Closing time</span><TimeSelect ariaLabel="Closing time" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-sm outline-none focus:border-sportGreen" options={buildTimeOptions()} value={form.closing_time} onChange={(value) => setForm({ ...form, closing_time: value })} /></label>
            <Select label="Slot duration" value={form.slot_duration_minutes} onChange={(value) => setForm({ ...form, slot_duration_minutes: value })} options={["30", "60", "90"]} />
            <Input label="Price per slot (NPR)" value={form.base_price} onChange={(value) => setForm({ ...form, base_price: value.replace(/[^\d.]/g, "") })} />
          </div>
          <div className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black text-sportNavy">Available weekdays</p>
              <div className="flex gap-2 text-xs font-black">
                <button className="rounded-md border border-slate-300 px-2.5 py-1.5 text-slate-600 hover:border-sportGreen hover:text-sportGreen" onClick={() => selectDays(days)} type="button">Every day</button>
                <button className="rounded-md border border-slate-300 px-2.5 py-1.5 text-slate-600 hover:border-sportGreen hover:text-sportGreen" onClick={() => selectDays(["Saturday", "Sunday"])} type="button">Weekends</button>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {days.map((day) => (
              <label className="flex min-h-11 items-center gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700" key={day}>
                <input
                  checked={form.available_days.includes(day)}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      available_days: event.target.checked
                        ? [...form.available_days, day]
                        : form.available_days.filter((item) => item !== day),
                    })
                  }
                  type="checkbox"
                />
                {day}
              </label>
            ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">{form.available_days.length} of 7 days selected</p>
          </div>
          <button className="sport-primary-button mt-5 w-full" disabled={isSaving} onClick={generateSlots} type="button">
            {isSaving ? "Generating..." : "Generate Slots"}
          </button>
          <button
            className="sport-secondary-button mt-3 w-full border-red-200 text-red-700 hover:bg-red-50"
            disabled={isSaving}
            onClick={() => setIsClearConfirmOpen(true)}
            type="button"
          >
            Clear Future Availability
          </button>
          {isClearConfirmOpen ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-950" role="alertdialog" aria-label="Confirm clearing future availability">
              <p className="font-black">Clear unbooked slots in this date range?</p>
              <p className="mt-2 leading-6">
                This removes only future available slots from {formatDateOnly(form.start_date)} to {formatDateOnly(form.end_date)}. Booked, reserved, blocked, past, and historical slots stay untouched. This cannot be undone.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="rounded-md bg-red-700 px-4 py-2.5 text-sm font-black text-white hover:bg-red-800 disabled:opacity-60" disabled={isSaving} onClick={clearFutureSlots} type="button">
                  {isSaving ? "Clearing..." : "Clear Unbooked Slots"}
                </button>
                <button className="rounded-md border border-red-200 bg-white px-4 py-2.5 text-sm font-black text-red-800 hover:bg-red-100" disabled={isSaving} onClick={() => setIsClearConfirmOpen(false)} type="button">
                  Keep Slots
                </button>
              </div>
            </div>
          ) : null}
          <div className="mt-4 rounded-md bg-green-50 p-4 text-sm leading-6 text-green-900">
            <strong>Safe to repeat:</strong> available means players can book, reserved means payment is pending, booked means payment succeeded, and blocked means you closed the slot. Generating adds new inventory only. Clearing removes only future unbooked availability in the selected range; use the Calendar when you need to block a specific published time.
          </div>
        </div>

        <div className="owner-panel rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-black text-sportNavy">Slots</h2>
            <input className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sportGreen" onChange={(event) => setDate(event.target.value)} type="date" value={date} />
          </div>
          {isLoading ? (
            <p className="mt-5 text-sm text-slate-500">Loading slots...</p>
          ) : slots.length === 0 ? (
            <p className="mt-5 rounded-md bg-slate-50 p-4 text-sm text-slate-600">No slots for this date yet.</p>
          ) : (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {slots.map((slot) => (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4" key={slot.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-sportNavy">{slot.display_time}</p>
                      <p className="mt-1 text-sm text-slate-600">Rs {Number(slot.price).toLocaleString()}</p>
                    </div>
                    <StatusBadge isInProgress={slot.is_in_progress} isPast={slot.is_past} status={slot.status} />
                  </div>
                  {slot.active_booking ? (
                    <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-sm">
                      <p className="text-xs font-black uppercase tracking-wide text-sportGreen">{slot.active_booking.booking_code}</p>
                      <p className="mt-1 font-black text-sportNavy">{slot.active_booking.player_name}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        {formatStatus(slot.active_booking.status)} · {formatStatus(slot.active_booking.payment_status)}
                      </p>
                    </div>
                  ) : null}
                  {slot.status === "AVAILABLE" && !slot.is_past ? (
                    <button className="mt-3 text-sm font-black text-red-600 hover:text-red-700" onClick={() => updateSlot(slot.id, "block")} type="button">
                      Block Slot
                    </button>
                  ) : null}
                  {slot.status === "BLOCKED" && !slot.is_past ? (
                    <button className="mt-3 text-sm font-black text-sportGreen hover:text-green-700" onClick={() => updateSlot(slot.id, "unblock")} type="button">
                      Unblock Slot
                    </button>
                  ) : null}
                  {slot.is_past ? <p className="mt-3 text-xs font-semibold text-slate-500">Past time kept for booking history.</p> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <Link className="mt-5 inline-flex text-sm font-black text-sportGreen hover:text-green-700" href="/dashboard/owner/courts">
        Back to Courts
      </Link>
    </div>
  );
}

function Input({ label, value, onChange, type = "text", min, max }: { label: string; value: string; onChange: (value: string) => void; type?: string; min?: string; max?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-sportNavy">{label}</span>
      <input className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-sm outline-none focus:border-sportGreen" max={max} min={min} onChange={(event) => onChange(event.target.value)} type={type} value={value} />
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-sportNavy">{label}</span>
      <select className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-sm outline-none focus:border-sportGreen" onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option} minutes
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusBadge({ isInProgress, isPast, status }: { isInProgress: boolean; isPast: boolean; status: string }) {
  if (isInProgress) return <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">In progress</span>;
  if (isPast) return <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-black text-slate-700">Past</span>;
  const tone = status === "AVAILABLE" ? "bg-green-100 text-green-800" : status === "BOOKED" ? "bg-blue-100 text-blue-800" : status === "BLOCKED" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800";
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${tone}`}>{formatStatus(status)}</span>;
}

function formatStatus(statusValue: string) {
  return statusValue.replaceAll("_", " ");
}
