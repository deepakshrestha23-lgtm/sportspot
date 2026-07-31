"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateOnly, formatDateTimeInNepal } from "@/lib/dates";
import { emitToast } from "@/lib/toast";
import type { Booking } from "@/types/venue";

export default function PaymentPage() {
  const params = useParams<{ bookingId: string }>();
  const bookingId = params.bookingId;
  const [booking, setBooking] = useState<Booking | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingKhalti, setIsStartingKhalti] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "warning">("success");
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const expiryRefreshDone = useRef(false);

  useEffect(() => {
    loadBooking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  useEffect(() => {
    if (!booking?.reserved_until || booking.status !== "RESERVED") {
      setRemainingSeconds(null);
      return;
    }

    const reservedUntil = booking.reserved_until;
    expiryRefreshDone.current = false;

    function updateTimer() {
      const secondsLeft = getRemainingSeconds(reservedUntil);
      setRemainingSeconds(secondsLeft);

      if (secondsLeft <= 0 && !expiryRefreshDone.current) {
        expiryRefreshDone.current = true;
        setNoticeTone("warning");
        setNotice("Reservation expired. The selected slot has been released for other players.");
        emitToast({ message: "Reservation expired. Please choose another slot.", type: "warning", dedupeKey: `booking-expired-${booking?.id}` });
        loadBooking({ silent: true });
      }
    }

    updateTimer();
    const timer = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.id, booking?.reserved_until, booking?.status]);

  async function loadBooking(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setIsLoading(true);
      setError("");
      setNotice("");
      setNoticeTone("success");
    }
    try {
      const response = await api.get<{ booking: Booking }>(`/api/venues/bookings/${bookingId}/`);
      setBooking(response.data.booking);
      if (response.data.booking.status === "EXPIRED") {
        setNoticeTone("warning");
        setNotice("Reservation expired. The selected slot has been released for other players.");
        emitToast({ message: "Reservation expired. Please choose another slot.", type: "warning", dedupeKey: `booking-expired-${booking?.id}` });
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load booking."));
    } finally {
      if (!options?.silent) {
        setIsLoading(false);
      }
    }
  }

  async function payWithKhalti() {
    if (!booking || booking.status !== "RESERVED" || (remainingSeconds !== null && remainingSeconds <= 0)) {
      setError("This reservation is no longer available for payment. Please choose another slot.");
      emitToast({ message: "This reservation is no longer available for payment. Please choose another slot.", type: "warning" });
      return;
    }

    setIsStartingKhalti(true);
    setError("");
    setNotice("");
    try {
      const response = await api.post<{ payment_url: string; pidx: string; booking: Booking }>(
        `/api/venues/bookings/${bookingId}/khalti/initiate/`,
      );
      window.location.href = response.data.payment_url;
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Payment could not be started. Please try again."));
      loadBooking({ silent: true });
    } finally {
      setIsStartingKhalti(false);
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 h-24 animate-pulse rounded bg-slate-100" />
      </div>
    );
  }

  if (!booking) {
    return <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">Booking not found.</div>;
  }

  const safeRemainingSeconds = remainingSeconds ?? getRemainingSeconds(booking.reserved_until);
  const reservationWindowSeconds = getReservationWindowSeconds(booking);
  const progressWidth = booking.status === "RESERVED" ? Math.max(0, Math.min(100, (safeRemainingSeconds / reservationWindowSeconds) * 100)) : 0;
  const isExpired = booking.status === "EXPIRED" || (booking.status === "RESERVED" && safeRemainingSeconds <= 0);
  const canPay = booking.status === "RESERVED" && safeRemainingSeconds > 0 && !isStartingKhalti;
  const timerTone = safeRemainingSeconds <= 120 ? "text-red-600" : safeRemainingSeconds <= 300 ? "text-amber-600" : "text-sportGreen";

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-xl bg-sportNavy text-white shadow-sm">
        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_340px]">
          <div>
            <p className="text-sm font-black uppercase tracking-wide text-green-300">Payment</p>
            <h1 className="mt-2 text-3xl font-black">Complete your reservation</h1>
            <p className="mt-3 max-w-2xl text-slate-300">
              Your selected Cricksal slot is held for a short time while you complete payment. The booking is confirmed only after payment succeeds.
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-white p-5 text-sportNavy shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">Reservation timer</p>
                <p className={`mt-2 text-4xl font-black tabular-nums ${isExpired ? "text-red-600" : timerTone}`}>
                  {booking.status === "RESERVED" ? formatCountdown(safeRemainingSeconds) : booking.status}
                </p>
              </div>
              <StatusBadge label={isExpired ? "Expired" : booking.status === "RESERVED" ? "Held" : booking.status} tone={isExpired ? "danger" : booking.status === "RESERVED" ? "success" : "neutral"} />
            </div>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full transition-all duration-500 ${safeRemainingSeconds <= 120 ? "bg-red-500" : "bg-sportGreen"}`} style={{ width: `${progressWidth}%` }} />
            </div>
            <p className="mt-3 text-xs font-semibold text-slate-500">
              Reserved until {formatDateTime(booking.reserved_until)}
            </p>
          </div>
        </div>
      </section>


      <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">Booking Code</p>
                <h2 className="mt-1 text-2xl font-black text-sportNavy">{booking.booking_code}</h2>
              </div>
              <div className="flex gap-2">
                <StatusBadge label={booking.status} tone={isExpired ? "danger" : booking.status === "RESERVED" ? "success" : "neutral"} />
                <StatusBadge label={booking.payment_status} tone={booking.payment_status === "PAID" ? "success" : booking.payment_status === "FAILED" ? "danger" : "warning"} />
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Info label="Venue" value={booking.venue_name} />
              <Info label="Court" value={booking.court_name} />
              <Info label="Date" value={formatDate(booking.slot_date)} />
              <Info label="Time" value={booking.booking_display_time || booking.slot_display_time} />
              <Info label="Duration" value={`${formatDuration(booking.total_duration_minutes)} · ${booking.slots_count} slot${booking.slots_count === 1 ? "" : "s"}`} />
              <Info label="Amount" value={`Rs ${Number(booking.amount).toLocaleString()}`} />
            </div>

            {booking.slots.length ? (
              <div className="mt-6 rounded-lg border border-slate-200">
                <div className="border-b border-slate-200 px-4 py-3">
                  <p className="text-sm font-black text-sportNavy">Reserved slot{booking.slots.length === 1 ? "" : "s"}</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {booking.slots.map((slot, index) => (
                    <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm" key={slot.id}>
                      <span className="font-bold text-slate-600">Slot {index + 1}</span>
                      <span className="font-black text-sportNavy">{slot.display_time}</span>
                      <span className="font-bold text-slate-600">Rs {Number(slot.price).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-purple-100 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-purple-600">Khalti</p>
                <p className="mt-1 text-lg font-black text-sportNavy">Pay securely with Khalti</p>
                <p className="mt-2 text-sm text-slate-600">
                  Continue to Khalti to complete payment. SportSpot will confirm your booking after the payment is verified.
                </p>
              </div>
              <StatusBadge label="Secure Payment" tone="success" />
            </div>

            {isExpired ? (
              <div className="mt-5 rounded-lg border border-red-100 bg-red-50 p-4 text-sm font-semibold text-red-700">
                This reservation expired before payment was completed. Please return to the venue page and select an available slot again.
              </div>
            ) : null}

            <button
              className="mt-6 w-full rounded-md bg-[#5d2e8e] px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-[#4c2378] disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={!canPay || isStartingKhalti}
              onClick={payWithKhalti}
              type="button"
            >
              {isStartingKhalti ? "Opening Khalti..." : "Pay with Khalti"}
            </button>

            <div className="mt-4 rounded-lg bg-purple-50 p-4 text-xs font-semibold leading-relaxed text-purple-900">
              Your booking will remain reserved until the countdown ends. If payment is not completed in time, the slot will be released.
            </div>
          </div>
        </div>

        <div className="h-fit rounded-lg border border-slate-200 bg-white p-6 shadow-sm lg:sticky lg:top-24">
          <p className="text-lg font-black text-sportNavy">Payment summary</p>
          <div className="mt-5 space-y-3 text-sm">
            <SummaryRow label="Court" value={booking.court_name} />
            <SummaryRow label="Date" value={formatDate(booking.slot_date)} />
            <SummaryRow label="Time" value={booking.booking_display_time || booking.slot_display_time} />
            <SummaryRow label="Duration" value={formatDuration(booking.total_duration_minutes)} />
            <SummaryRow label="Slots" value={`${booking.slots_count}`} />
            <div className="border-t border-slate-200 pt-3">
              <SummaryRow label="Total" value={`Rs ${Number(booking.amount).toLocaleString()}`} strong />
            </div>
          </div>

          <div className="mt-6 rounded-lg bg-slate-50 p-4 text-xs font-semibold leading-relaxed text-slate-600">
            Slot is locked only during the countdown. Successful payment confirms all selected slots in one booking pass.
          </div>
        </div>
      </section>
    </div>
  );
}

function getRemainingSeconds(reservedUntil: string | null | undefined) {
  if (!reservedUntil) return 0;
  return Math.max(0, Math.ceil((new Date(reservedUntil).getTime() - Date.now()) / 1000));
}

function getReservationWindowSeconds(booking: Booking) {
  const reservedUntil = new Date(booking.reserved_until).getTime();
  const createdAt = new Date(booking.created_at).getTime();
  if (Number.isNaN(reservedUntil) || Number.isNaN(createdAt) || reservedUntil <= createdAt) {
    return 600;
  }
  return Math.max(1, Math.ceil((reservedUntil - createdAt) / 1000));
}

function formatCountdown(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remaining = safeSeconds % 60;
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

function formatDuration(minutes: number) {
  if (!minutes) return "Not set";
  const hours = minutes / 60;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function formatDate(dateValue: string) {
  return formatDateOnly(dateValue, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(dateValue: string | null) {
  return formatDateTimeInNepal(dateValue, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-4">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 font-black text-sportNavy">{value}</p>
    </div>
  );
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-semibold text-slate-500">{label}</span>
      <span className={strong ? "text-lg font-black text-sportNavy" : "font-black text-sportNavy"}>{value}</span>
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "success" | "warning" | "danger" | "neutral" }) {
  const toneClasses = {
    success: "bg-green-100 text-green-700",
    warning: "bg-amber-100 text-amber-700",
    danger: "bg-red-100 text-red-700",
    neutral: "bg-slate-100 text-slate-700",
  };

  return <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${toneClasses[tone]}`}>{label}</span>;
}
