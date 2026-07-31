"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import CancelBookingModal, { type CancelBookingPayload } from "@/components/CancelBookingModal";
import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateOnly, getLocalDateString } from "@/lib/dates";
import type { Booking } from "@/types/venue";

export default function PlayerBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState("UPCOMING");
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);
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
      const response = await api.get<{ bookings: Booking[] }>("/api/venues/bookings/my/");
      setBookings(response.data.bookings);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load bookings."));
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
      setNotice(`Booking ${response.data.booking.booking_code} has been cancelled. Refund status: ${formatStatus(response.data.booking.refund_status)}.`);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not cancel booking."));
    } finally {
      setIsCancelling(false);
    }
  }

  const today = getLocalDateString();
  const visibleBookings = bookings.filter((booking) => {
    if (filter === "UPCOMING") return booking.slot_date >= today && ["RESERVED", "CONFIRMED"].includes(booking.status);
    if (filter === "PAST") return booking.slot_date < today || booking.status === "COMPLETED";
    return ["CANCELLED", "EXPIRED"].includes(booking.status);
  });

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-sportNavy p-6 text-white shadow-sm">
        <p className="text-sm font-black uppercase tracking-wide text-green-300">My Bookings</p>
        <h1 className="mt-2 text-3xl font-black">Court booking history</h1>
        <p className="mt-3 text-slate-300">View reserved, confirmed, expired, and completed Cricksal court bookings.</p>
      </section>
      <FeedbackToast message={error || notice} onClose={() => { setError(""); setNotice(""); }} type={error ? "error" : "success"} />

      <div className="flex flex-wrap gap-2">
        {["UPCOMING", "PAST", "CANCELLED / EXPIRED"].map((item) => (
          <button className={`rounded-full px-4 py-2 text-sm font-black ${filter === item ? "bg-sportGreen text-white" : "bg-white text-slate-700"}`} key={item} onClick={() => setFilter(item)} type="button">
            {item}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">Loading bookings...</div>
      ) : visibleBookings.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-black text-sportNavy">No bookings here yet</h2>
          <p className="mt-2 text-sm text-slate-600">Book an approved Cricksal court and it will appear here.</p>
          <Link className="mt-5 inline-flex rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" href="/courts">
            Browse Courts
          </Link>
        </div>
      ) : (
        <section className="grid gap-4">
          {visibleBookings.map((booking) => (
            <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" key={booking.id}>
              <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-center">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-sportGreen">{booking.booking_code}</p>
                  <h2 className="mt-1 text-lg font-black text-sportNavy">{booking.court_name}</h2>
                  <p className="mt-1 text-sm text-slate-600">{booking.venue_name}</p>
                </div>
                <Info label="Date / Time" value={`${formatDateOnly(booking.slot_date)} · ${booking.booking_display_time || booking.slot_display_time}`} />
                <Info label="Duration" value={`${formatDuration(booking.total_duration_minutes)} · ${booking.slots_count} slot${booking.slots_count === 1 ? "" : "s"}`} />
                <Info label="Amount" value={`Rs ${Number(booking.amount).toLocaleString()}`} />
                {Number(booking.refund_amount) > 0 ? (
                  <Info label="Refund" value={`${booking.refund_percentage}% · Rs ${Number(booking.refund_amount).toLocaleString()}`} />
                ) : null}
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Badge label={booking.status} />
                  <Badge label={booking.payment_status} />
                  <Badge label={booking.refund_status} />
                  {booking.can_cancel ? (
                    <button className="rounded-md border border-red-200 px-4 py-2 text-sm font-black text-red-600 hover:bg-red-50" onClick={() => setBookingToCancel(booking)} type="button">
                      Cancel Booking
                    </button>
                  ) : null}
                  <Link className="rounded-md bg-sportGreen px-4 py-2 text-sm font-black text-white hover:bg-green-700" href={booking.status === "RESERVED" ? `/dashboard/player/bookings/payment/${booking.id}` : `/dashboard/player/bookings/${booking.id}`}>
                    {booking.status === "RESERVED" ? "Pay Now" : "View Booking"}
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {bookingToCancel ? (
        <CancelBookingModal actor="player" booking={bookingToCancel} isWorking={isCancelling} onClose={() => setBookingToCancel(null)} onConfirm={cancelBooking} />
      ) : null}
    </div>
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
