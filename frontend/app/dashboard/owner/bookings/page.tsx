"use client";

import { useEffect, useState } from "react";

import CancelBookingModal, { type CancelBookingPayload } from "@/components/CancelBookingModal";
import BookingMessageModal, { type BookingMessagePayload } from "@/components/BookingMessageModal";
import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateOnly, getLocalDateString } from "@/lib/dates";
import type { Booking } from "@/types/venue";

export default function OwnerBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState("ALL");
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);
  const [bookingToMessage, setBookingToMessage] = useState<Booking | null>(null);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    loadBookings();
  }, []);

  async function loadBookings() {
    setIsLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await api.get<{ bookings: Booking[] }>("/api/venues/owner/bookings/");
      setBookings(response.data.bookings);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load owner bookings."));
    } finally {
      setIsLoading(false);
    }
  }

  async function cancelBooking(payload: CancelBookingPayload) {
    if (!bookingToCancel) return;
    setIsCancelling(true);
    setError("");
    setNotice("");
    try {
      const response = await api.post<{ booking: Booking }>(`/api/venues/bookings/${bookingToCancel.id}/cancel/`, payload);
      setBookings((currentBookings) => currentBookings.map((booking) => (booking.id === response.data.booking.id ? response.data.booking : booking)));
      setBookingToCancel(null);
      setNotice(`Booking ${response.data.booking.booking_code} cancelled. Refund status: ${formatStatus(response.data.booking.refund_status)}.`);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not cancel owner booking."));
    } finally {
      setIsCancelling(false);
    }
  }

  async function sendBookingMessage(payload: BookingMessagePayload) {
    if (!bookingToMessage) return;
    setIsSendingMessage(true);
    setError("");
    setNotice("");
    try {
      await api.post(`/api/venues/owner/bookings/${bookingToMessage.id}/messages/`, payload);
      setNotice(`Important message sent to ${bookingToMessage.player_name}.`);
      setBookingToMessage(null);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not send booking message."));
    } finally {
      setIsSendingMessage(false);
    }
  }

  const visibleBookings = bookings.filter((booking) => {
    if (filter === "ALL") return true;
    if (filter === "TODAY") return booking.slot_date === getLocalDateString();
    if (filter === "CANCELLED") return ["CANCELLED", "EXPIRED"].includes(booking.status);
    return booking.status === filter;
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <FeedbackToast
        message={error || notice}
        onClose={() => {
          setError("");
          setNotice("");
        }}
        type={error ? "error" : notice ? "success" : "info"}
      />
      <section className="rounded-lg bg-sportNavy p-6 text-white shadow-sm">
        <p className="text-sm font-black uppercase tracking-wide text-green-300">Owner Bookings</p>
        <h1 className="mt-2 text-3xl font-black">Bookings for your venue</h1>
      </section>

      <div className="mt-6 flex flex-wrap gap-2">
        {["ALL", "TODAY", "RESERVED", "CONFIRMED", "COMPLETED", "CANCELLED"].map((item) => (
          <button className={`rounded-full px-4 py-2 text-sm font-black ${filter === item ? "bg-sportGreen text-white" : "bg-white text-slate-700"}`} key={item} onClick={() => setFilter(item)} type="button">
            {item}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">Loading bookings...</div>
      ) : visibleBookings.length === 0 ? (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-black text-sportNavy">No bookings found</h2>
          <p className="mt-2 text-sm text-slate-600">Confirmed player bookings will appear here.</p>
        </div>
      ) : (
        <section className="mt-6 grid gap-4">
          {visibleBookings.map((booking) => (
            <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" key={booking.id}>
              <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr_1fr] lg:items-center">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-sportGreen">{booking.booking_code}</p>
                  <h2 className="mt-1 text-lg font-black text-sportNavy">{booking.player_name}</h2>
                  <p className="mt-1 text-sm text-slate-600">{booking.court_name}</p>
                </div>
                <Info label="Date / Time" value={`${formatDateOnly(booking.slot_date)} · ${booking.booking_display_time || booking.slot_display_time}`} />
                <Info label="Duration" value={`${formatDuration(booking.total_duration_minutes)} · ${booking.slots_count} slot${booking.slots_count === 1 ? "" : "s"}`} />
                <Info label="Amount" value={`Rs ${Number(booking.amount).toLocaleString()}`} />
                <div className="flex flex-wrap gap-2">
                  <Badge label={booking.status} />
                  <Badge label={booking.payment_status} />
                  <Badge label={booking.refund_status} />
                  {booking.status === "COMPLETED" ? (
                    <span className="rounded-md bg-green-50 px-4 py-2 text-sm font-black text-green-800">Completed history</span>
                  ) : null}
                  {["RESERVED", "CONFIRMED"].includes(booking.status) ? (
                    <button className="rounded-md border border-green-200 px-4 py-2 text-sm font-black text-sportGreen hover:bg-green-50" onClick={() => setBookingToMessage(booking)} type="button">
                      Message Player
                    </button>
                  ) : null}
                  {booking.can_cancel ? (
                    <button className="rounded-md border border-red-200 px-4 py-2 text-sm font-black text-red-600 hover:bg-red-50" onClick={() => setBookingToCancel(booking)} type="button">
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {bookingToCancel ? (
        <CancelBookingModal actor="owner" booking={bookingToCancel} isWorking={isCancelling} onClose={() => setBookingToCancel(null)} onConfirm={cancelBooking} />
      ) : null}
      {bookingToMessage ? (
        <BookingMessageModal booking={bookingToMessage} isWorking={isSendingMessage} onClose={() => setBookingToMessage(null)} onSend={sendBookingMessage} />
      ) : null}
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-black text-sportNavy">{value}</p>
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{formatStatus(label)}</span>;
}

function formatDuration(minutes: number) {
  if (!minutes) return "Not set";
  const hours = minutes / 60;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function formatStatus(statusValue: string) {
  return statusValue.replaceAll("_", " ");
}
