"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getLocalDateString } from "@/lib/dates";
import type { CourtSlot } from "@/types/venue";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function OwnerCourtSlotsPage() {
  const params = useParams<{ id: string }>();
  const courtId = params.id;
  const [slots, setSlots] = useState<CourtSlot[]>([]);
  const [date, setDate] = useState(getLocalDateString());
  const [form, setForm] = useState({
    available_days: ["Saturday", "Sunday"],
    opening_time: "06:00",
    closing_time: "20:00",
    slot_duration_minutes: "60",
    base_price: "1500",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const feedbackMessage = error || message;
  const feedbackType = error ? "error" : message ? "success" : "info";

  useEffect(() => {
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, courtId]);

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
      const response = await api.post<{ created_count: number; skipped_count: number }>(`/api/venues/owner/courts/${courtId}/slots/generate/`, form);
      setMessage(`Generated ${response.data.created_count} slots. ${response.data.skipped_count} existing slots skipped.`);
      loadSlots();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not generate slots."));
    } finally {
      setIsSaving(false);
    }
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
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <FeedbackToast message={feedbackMessage} onClose={() => { setMessage(""); setError(""); }} type={feedbackType} />

      <section className="rounded-lg bg-sportNavy p-6 text-white shadow-sm">
        <p className="text-sm font-black uppercase tracking-wide text-green-300">Slot Calendar</p>
        <h1 className="mt-2 text-3xl font-black">Generate and manage slots</h1>
        <p className="mt-3 max-w-3xl text-slate-300">
          Slots are the actual bookable times players see on the court detail page. Available slots can be reserved, paid, and then locked as booked.
        </p>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-sportNavy">Generate Slots</h2>
          <p className="mt-2 text-sm text-slate-600">
            Use this when you want to open time blocks for players. Existing slots are skipped, so generating again will not duplicate the same time.
          </p>
          <div className="mt-4 grid gap-4">
            <Input label="Opening Time" type="time" value={form.opening_time} onChange={(value) => setForm({ ...form, opening_time: value })} />
            <Input label="Closing Time" type="time" value={form.closing_time} onChange={(value) => setForm({ ...form, closing_time: value })} />
            <Select label="Slot Duration" value={form.slot_duration_minutes} onChange={(value) => setForm({ ...form, slot_duration_minutes: value })} options={["30", "60", "90"]} />
            <Input label="Base Price" value={form.base_price} onChange={(value) => setForm({ ...form, base_price: value.replace(/[^\d.]/g, "") })} />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {days.map((day) => (
              <label className="flex items-center gap-2 rounded-md border border-slate-200 p-3 text-sm font-semibold text-slate-700" key={day}>
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
          <button className="mt-5 w-full rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" disabled={isSaving} onClick={generateSlots} type="button">
            {isSaving ? "Generating..." : "Generate Slots"}
          </button>
          <div className="mt-4 rounded-md bg-green-50 p-4 text-sm font-semibold text-green-800">
            Available means players can book. Reserved means payment is pending. Booked means payment succeeded. Blocked means you manually closed the slot.
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
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
                    <StatusBadge status={slot.status} />
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
                  {slot.status === "AVAILABLE" ? (
                    <button className="mt-3 text-sm font-black text-red-600 hover:text-red-700" onClick={() => updateSlot(slot.id, "block")} type="button">
                      Block Slot
                    </button>
                  ) : null}
                  {slot.status === "BLOCKED" ? (
                    <button className="mt-3 text-sm font-black text-sportGreen hover:text-green-700" onClick={() => updateSlot(slot.id, "unblock")} type="button">
                      Unblock Slot
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <Link className="mt-5 inline-flex text-sm font-black text-sportGreen hover:text-green-700" href="/dashboard/owner/courts">
        Back to Courts
      </Link>
    </main>
  );
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-sportNavy">{label}</span>
      <input className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-sm outline-none focus:border-sportGreen" onChange={(event) => onChange(event.target.value)} type={type} value={value} />
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

function StatusBadge({ status }: { status: string }) {
  const tone = status === "AVAILABLE" ? "bg-green-100 text-green-800" : status === "BOOKED" ? "bg-blue-100 text-blue-800" : status === "BLOCKED" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800";
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${tone}`}>{formatStatus(status)}</span>;
}

function formatStatus(statusValue: string) {
  return statusValue.replaceAll("_", " ");
}
