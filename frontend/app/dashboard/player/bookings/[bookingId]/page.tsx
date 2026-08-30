"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";

import CancelBookingModal, { type CancelBookingPayload } from "@/components/CancelBookingModal";
import BackButton from "@/components/BackButton";
import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateOnly, formatDateTimeInNepal } from "@/lib/dates";
import type { Booking } from "@/types/venue";

export default function BookingPassPage() {
  const params = useParams<{ bookingId: string }>();
  const bookingId = params.bookingId;
  const [booking, setBooking] = useState<Booking | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    loadBooking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  async function loadBooking() {
    setIsLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await api.get<{ booking: Booking }>(`/api/venues/bookings/${bookingId}/`);
      setBooking(response.data.booking);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load booking pass."));
    } finally {
      setIsLoading(false);
    }
  }

  async function cancelBooking(payload: CancelBookingPayload) {
    if (!booking) return;
    setIsCancelling(true);
    setError("");
    setNotice("");
    try {
      const response = await api.post<{ booking: Booking }>(`/api/venues/bookings/${booking.id}/cancel/`, payload);
      setBooking(response.data.booking);
      setShowCancelModal(false);
      setNotice(`Your booking has been cancelled. Refund status: ${formatStatus(response.data.booking.refund_status)}.`);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not cancel booking."));
    } finally {
      setIsCancelling(false);
    }
  }

  if (isLoading) {
    return <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">Loading booking pass...</div>;
  }

  if (!booking) {
    return <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">Booking not found.</div>;
  }

  return (
    <div className="space-y-6">
      <BackButton href="/dashboard/player/bookings" label="Back to bookings" />
      <FeedbackToast message={error || notice} onClose={() => { setError(""); setNotice(""); }} type={error ? "error" : "success"} />

      <section className="overflow-hidden rounded-xl border border-green-200 bg-white shadow-sm">
        <div className="bg-sportNavy p-6 text-white">
          <p className="text-sm font-black uppercase tracking-wide text-green-300">Booking Pass</p>
          <h1 className="mt-2 text-3xl font-black">{booking.status === "CONFIRMED" ? "Booking Confirmed" : "Booking Details"}</h1>
          <p className="mt-2 text-slate-300">Show this booking pass at the venue.</p>
        </div>
        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_220px]">
          <div className="grid gap-4 sm:grid-cols-2">
            <Info label="Booking Code" value={booking.booking_code} />
            <Info label="Player Name" value={booking.player_name} />
            <Info label="Court" value={booking.court_name} />
            <Info label="Venue" value={booking.venue_name} />
            <Info label="Address" value={`${booking.venue_address}, ${booking.venue_area}, ${booking.venue_city}`} />
            <Info label="Date / Time" value={`${formatDateOnly(booking.slot_date)} · ${booking.booking_display_time || booking.slot_display_time}`} />
            <Info label="Duration" value={`${formatDuration(booking.total_duration_minutes)} · ${booking.slots_count} slot${booking.slots_count === 1 ? "" : "s"}`} />
            <Info label="Amount Paid" value={`Rs ${Number(booking.amount).toLocaleString()}`} />
            <Info label="Payment Status" value={booking.payment_status} />
            <Info label="Refund Status" value={formatStatus(booking.refund_status)} />
            {booking.completed_at ? <Info label="Completed At" value={formatDateTimeInNepal(booking.completed_at)} /> : null}
            {booking.cancellation_tier !== "NOT_APPLICABLE" ? (
              <Info label="Cancellation Outcome" value={formatStatus(booking.cancellation_tier)} />
            ) : null}
            {Number(booking.refund_amount) > 0 ? (
              <Info
                label="Refund Entitlement"
                value={`${booking.refund_percentage}% · Rs ${Number(booking.refund_amount).toLocaleString()}`}
              />
            ) : null}
            {booking.refund_reason ? <Info label="Refund Message" value={booking.refund_reason} /> : null}
            {booking.refund_owner_note ? <Info label="Owner Refund Note" value={booking.refund_owner_note} /> : null}
            <Info label="Booking Status" value={booking.status} />
            {booking.cancelled_at ? <Info label="Cancelled By" value={booking.cancelled_by_name || booking.cancellation_actor_role || "System"} /> : null}
            {booking.cancellation_reason ? <Info label="Cancellation Reason" value={booking.cancellation_reason} /> : null}
          </div>
          <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-5 text-center">
            {booking.check_in?.qr_token ? (
              <>
                <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
                  <QRCodeSVG bgColor="#ffffff" fgColor="#10213f" includeMargin level="M" size={176} value={booking.check_in.qr_token} />
                </div>
                <p className="mt-4 text-xs font-black uppercase tracking-[0.14em] text-sportGreen">Venue check-in pass</p>
                <p className="mt-1 text-sm font-semibold leading-5 text-slate-600">{booking.check_in.message}</p>
                <p className="mt-3 rounded-lg bg-white px-3 py-2 font-mono text-xs font-black tracking-wide text-sportNavy">{booking.booking_code}</p>
              </>
            ) : (
              <>
                <p className="text-sm font-black text-sportNavy">Booking pass unavailable</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">A venue check-in pass appears after successful payment confirmation. Use the booking code for this record when speaking with the venue.</p>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-sportGreen">Protected Policy Snapshot</p>
            <h2 className="mt-1 text-xl font-black text-sportNavy">Cancellation terms for this booking</h2>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
            Version {booking.cancellation_policy_details.version}
          </span>
        </div>
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {booking.cancellation_policy_details.summary.map((rule) => (
            <li className="flex gap-2 rounded-md bg-slate-50 p-3 text-sm font-semibold leading-6 text-slate-700" key={rule}>
              <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-sportGreen" />
              {rule}
            </li>
          ))}
        </ul>
        {booking.cancellation_policy_details.additional_notes ? (
          <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-600">
            {booking.cancellation_policy_details.additional_notes}
          </p>
        ) : null}
      </section>

      {booking.venue_messages.length > 0 ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <p className="text-xs font-black uppercase tracking-wide text-amber-700">Venue updates</p>
          <h2 className="mt-1 text-xl font-black text-sportNavy">Messages about this booking</h2>
          <div className="mt-4 space-y-3">
            {booking.venue_messages.map((venueMessage) => (
              <article className="rounded-md border border-amber-200 bg-white p-4" key={venueMessage.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-black text-sportNavy">{venueMessage.message_type_display}</p>
                  <time className="text-xs font-semibold text-slate-400" dateTime={venueMessage.created_at}>
                    {formatMessageTime(venueMessage.created_at)}
                  </time>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-700">{venueMessage.message}</p>
                <p className="mt-2 text-xs font-semibold text-slate-400">From {venueMessage.sender_name}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {booking.can_cancel ? (
          <button className="rounded-md border border-red-200 px-5 py-3 text-sm font-black text-red-600 hover:bg-red-50" onClick={() => setShowCancelModal(true)} type="button">
            Cancel Booking
          </button>
        ) : null}
        <Link className="inline-flex rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" href="/dashboard/player/bookings">
          Back to My Bookings
        </Link>
      </div>

      {showCancelModal && booking ? (
        <CancelBookingModal actor="player" booking={booking} isWorking={isCancelling} onClose={() => setShowCancelModal(false)} onConfirm={cancelBooking} />
      ) : null}
    </div>
  );
}

function formatDuration(minutes: number) {
  if (!minutes) return "Not set";
  const hours = minutes / 60;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-4">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 font-black text-sportNavy">{value}</p>
    </div>
  );
}

function formatStatus(statusValue: string) {
  return statusValue.replaceAll("_", " ");
}

function formatMessageTime(value: string) {
  return formatDateTimeInNepal(value, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
