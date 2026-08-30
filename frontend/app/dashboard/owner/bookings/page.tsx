"use client";

import { useEffect, useState } from "react";

import CancelBookingModal, { type CancelBookingPayload } from "@/components/CancelBookingModal";
import BookingMessageModal, { type BookingMessagePayload } from "@/components/BookingMessageModal";
import BookingVerificationPanel from "@/components/BookingVerificationPanel";
import FeedbackToast from "@/components/FeedbackToast";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
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
  const [showVerifier, setShowVerifier] = useState(false);

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
    <div className="space-y-6">
      <FeedbackToast
        message={error || notice}
        onClose={() => {
          setError("");
          setNotice("");
        }}
        type={error ? "error" : notice ? "success" : "info"}
      />
      <OwnerPageHeader
        actions={<button className="sport-secondary-button" onClick={() => setShowVerifier((current) => !current)} type="button">{showVerifier ? "Hide verifier" : "Verify booking"}</button>}
        description="Review reservations, payment status, and check in arriving players with a booking pass or code."
        eyebrow="Venue Manager"
        title="Bookings"
      />

      {showVerifier ? <BookingVerificationPanel onClose={() => setShowVerifier(false)} /> : null}

      <section className="owner-booking-toolbar" aria-label="Booking filters">
        <div className="owner-booking-toolbar-heading">
          <div>
            <p className="sport-eyebrow">Booking desk</p>
            <h2 className="text-lg font-black text-sportNavy">Reservation records</h2>
          </div>
          <p className="text-sm text-slate-500">{visibleBookings.length} shown</p>
        </div>
        <div className="owner-booking-filters" role="tablist" aria-label="Filter booking records">
          {["ALL", "TODAY", "RESERVED", "CONFIRMED", "COMPLETED", "CANCELLED"].map((item) => {
            const count = countBookings(bookings, item);
            return (
              <button aria-selected={filter === item} className="owner-booking-filter" key={item} onClick={() => setFilter(item)} role="tab" type="button">
                <span>{formatFilterLabel(item)}</span>
                <span className="owner-booking-filter-count">{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {isLoading ? (
        <div className="owner-panel owner-booking-loading mt-6 p-6">Loading bookings...</div>
      ) : visibleBookings.length === 0 ? (
        <div className="sport-empty-state owner-booking-empty mt-6">
          <h2 className="text-xl font-black text-sportNavy">No bookings found</h2>
          <p className="mt-2 text-sm text-slate-600">Bookings matching this filter will appear here.</p>
        </div>
      ) : (
        <section className="owner-booking-panel mt-6" aria-label="Venue booking records">
          {visibleBookings.map((booking) => (
            <article className="owner-booking-record" key={booking.id}>
              <div className="owner-booking-record-main">
                <div className="owner-booking-player">
                  <span className="owner-booking-avatar" aria-hidden="true">{getInitials(booking.player_name)}</span>
                  <div className="min-w-0">
                    <p className="owner-booking-code">{booking.booking_code}</p>
                    <h2 className="mt-1 truncate text-lg font-black text-sportNavy">{booking.player_name}</h2>
                  </div>
                </div>
                <Info label="Court" value={booking.court_name} />
                <Info label="When" value={`${formatDateOnly(booking.slot_date)} · ${booking.booking_display_time || booking.slot_display_time}`} />
                <Info label="Duration" value={`${formatDuration(booking.total_duration_minutes)} · ${booking.slots_count} slot${booking.slots_count === 1 ? "" : "s"}`} />
                <div className="owner-booking-total">
                  <p className="owner-booking-label">Total</p>
                  <p className="mt-1 text-lg font-black text-sportGreen">NPR {Number(booking.amount).toLocaleString()}</p>
                </div>
              </div>
              <div className="owner-booking-record-footer">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge label={booking.status} />
                  <Badge label={booking.payment_status} />
                  {booking.refund_status !== "NOT_REQUIRED" ? <Badge label={booking.refund_status} /> : null}
                  {booking.check_in?.status === "CHECKED_IN" ? <span className="owner-booking-checkin">Court check-in recorded</span> : null}
                </div>
                <div className="owner-booking-actions">
                  {["RESERVED", "CONFIRMED"].includes(booking.status) ? (
                    <button className="sport-secondary-button" onClick={() => setBookingToMessage(booking)} type="button">
                      Message player
                    </button>
                  ) : null}
                  {booking.can_cancel ? (
                    <button className="sport-secondary-button border-red-200 text-red-700 hover:bg-red-50" onClick={() => setBookingToCancel(booking)} type="button">
                      Cancel booking
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
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="owner-booking-label">{label}</p>
      <p className="mt-1 truncate font-black text-sportNavy">{value}</p>
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return <span className={`owner-booking-status owner-booking-status-${getStatusTone(label)}`}>{formatStatus(label)}</span>;
}

function countBookings(bookings: Booking[], filter: string) {
  return bookings.filter((booking) => {
    if (filter === "ALL") return true;
    if (filter === "TODAY") return booking.slot_date === getLocalDateString();
    if (filter === "CANCELLED") return ["CANCELLED", "EXPIRED"].includes(booking.status);
    return booking.status === filter;
  }).length;
}

function formatFilterLabel(value: string) {
  return value === "ALL" ? "All" : value.charAt(0) + value.slice(1).toLowerCase();
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "?";
}

function getStatusTone(value: string) {
  if (["CONFIRMED", "PAID", "REFUNDED", "CHECKED_IN"].includes(value)) return "success";
  if (["RESERVED", "PENDING", "PENDING_OWNER_ACTION", "PARTIALLY_REFUNDED"].includes(value)) return "warning";
  if (["CANCELLED", "FAILED", "REJECTED"].includes(value)) return "danger";
  if (["COMPLETED"].includes(value)) return "info";
  return "neutral";
}

function formatDuration(minutes: number) {
  if (!minutes) return "Not set";
  const hours = minutes / 60;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function formatStatus(statusValue: string) {
  return statusValue
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
