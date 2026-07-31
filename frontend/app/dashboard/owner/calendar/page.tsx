"use client";

import { useEffect, useState } from "react";

import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getLocalDateString } from "@/lib/dates";
import type { CourtSlot } from "@/types/venue";

export default function OwnerCalendarPage() {
  const [slots, setSlots] = useState<CourtSlot[]>([]);
  const [date, setDate] = useState(getLocalDateString());
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const feedbackMessage = error || message;
  const feedbackType = error ? "error" : message ? "success" : "info";
  const statusCounts = getStatusCounts(slots);

  useEffect(() => {
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function loadSlots() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<{ slots: CourtSlot[] }>(`/api/venues/owner/slots/?date=${date}`);
      setSlots(response.data.slots);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load slot calendar."));
    } finally {
      setIsLoading(false);
    }
  }

  async function updateSlot(slotId: number, action: "block" | "unblock") {
    setMessage("");
    setError("");
    try {
      await api.post(`/api/venues/owner/slots/${slotId}/${action}/`);
      setMessage(action === "block" ? "Slot blocked successfully." : "Slot unblocked successfully.");
      loadSlots();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not update slot."));
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <FeedbackToast message={feedbackMessage} onClose={() => { setMessage(""); setError(""); }} type={feedbackType} />

      <section className="flex flex-col gap-4 rounded-lg bg-sportNavy p-6 text-white shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-wide text-green-300">Slot Calendar</p>
          <h1 className="mt-2 text-3xl font-black">Daily slot status</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-300">
            Use this as your operations board: unpaid holds, confirmed bookings, blocked slots, and completed history all stay visible here.
          </p>
        </div>
        <input className="rounded-md border border-white/20 bg-white px-3 py-2 text-sm text-sportNavy outline-none" onChange={(event) => setDate(event.target.value)} type="date" value={date} />
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(["AVAILABLE", "RESERVED", "BOOKED", "BLOCKED", "CANCELLED"] as const).map((status) => (
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" key={status}>
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">{formatStatus(status)}</p>
            <p className="mt-2 text-2xl font-black text-sportNavy">{statusCounts[status] || 0}</p>
          </div>
        ))}
      </section>

      {isLoading ? (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">Loading slots...</div>
      ) : slots.length === 0 ? (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-black text-sportNavy">No slots for this date</h2>
          <p className="mt-2 text-sm text-slate-600">Generate slots from Court Management to fill this calendar.</p>
        </div>
      ) : (
        <section className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {slots.map((slot) => (
            <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" key={slot.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-black text-sportNavy">{slot.court_name}</h2>
                  <p className="mt-1 text-sm text-slate-600">{slot.display_time}</p>
                  <p className="mt-1 text-sm font-black text-sportNavy">Rs {Number(slot.price).toLocaleString()}</p>
                </div>
                <StatusBadge status={slot.status} />
              </div>
              {slot.status === "AVAILABLE" ? (
                <button className="mt-4 rounded-md border border-red-200 px-4 py-2 text-sm font-black text-red-600 hover:bg-red-50" onClick={() => updateSlot(slot.id, "block")} type="button">
                  Block Slot
                </button>
              ) : null}
              {slot.active_booking ? (
                <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-black uppercase tracking-wide text-sportGreen">{slot.active_booking.booking_code}</p>
                  <p className="mt-1 text-sm font-black text-sportNavy">{slot.active_booking.player_name}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {formatStatus(slot.active_booking.status)} · {formatStatus(slot.active_booking.payment_status)}
                  </p>
                </div>
              ) : null}
              {slot.status === "BLOCKED" ? (
                <button className="mt-4 rounded-md border border-green-200 px-4 py-2 text-sm font-black text-sportGreen hover:bg-green-50" onClick={() => updateSlot(slot.id, "unblock")} type="button">
                  Unblock Slot
                </button>
              ) : null}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "AVAILABLE" ? "bg-green-100 text-green-800" : status === "BOOKED" ? "bg-blue-100 text-blue-800" : status === "BLOCKED" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800";
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${tone}`}>{formatStatus(status)}</span>;
}

function getStatusCounts(slots: CourtSlot[]) {
  return slots.reduce<Record<string, number>>((counts, slot) => {
    counts[slot.status] = (counts[slot.status] || 0) + 1;
    return counts;
  }, {});
}

function formatStatus(statusValue: string) {
  return statusValue.replaceAll("_", " ");
}
