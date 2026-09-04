"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateOnly, formatDateTimeInNepal } from "@/lib/dates";
import { emitToast } from "@/lib/toast";
import BackButton from "@/components/BackButton";
import type { Booking } from "@/types/venue";

export default function PaymentPage() {
  const params = useParams<{ bookingId: string }>();
  const bookingId = params.bookingId;
  const searchParams = useSearchParams();
  const matchmakingGameId = searchParams.get("matchmaking_game");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingKhalti, setIsStartingKhalti] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
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

  async function cancelReservation() {
    if (!booking || booking.status !== "RESERVED") return;

    setIsCancelling(true);
    setError("");
    try {
      const response = await api.post<{ booking: Booking }>(`/api/venues/bookings/${booking.id}/cancel/`, {
        reason: "Player cancelled the unpaid reservation.",
      });
      setBooking(response.data.booking);
      setShowCancelConfirmation(false);
      setNoticeTone("warning");
      setNotice("Your reservation was cancelled and the held time was released.");
      emitToast({ message: "Your reservation was cancelled.", type: "success", dedupeKey: `reservation-cancelled-${booking.id}` });
    } catch (requestError) {
      const message = getApiErrorMessage(requestError, "We could not cancel this reservation. Please try again.");
      setError(message);
      emitToast({ message, type: "error", dedupeKey: `reservation-cancel-error-${booking.id}` });
      loadBooking({ silent: true });
    } finally {
      setIsCancelling(false);
    }
  }

  if (isLoading) {
    return (
      <div aria-label="Loading reservation" className="space-y-5" role="status">
        <div className="h-5 w-32 animate-pulse rounded bg-slate-200" />
        <div className="h-28 animate-pulse rounded-xl bg-white" />
        <div className="grid gap-6 lg:grid-cols-[1fr_350px]"><div className="h-96 animate-pulse rounded-xl bg-white" /><div className="h-72 animate-pulse rounded-xl bg-white" /></div>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="space-y-5">
        <BackButton href="/dashboard/player/bookings" label="Back to bookings" />
        <div className="sport-error-state" role="alert">
          <p className="font-bold">{error || "Booking not found."}</p>
          <p className="mt-1 text-sm">We could not load this reservation. It may have expired or may no longer be available.</p>
          <button className="sport-secondary-button mt-4" onClick={() => void loadBooking()} type="button">Try again</button>
        </div>
      </div>
    );
  }

  const safeRemainingSeconds = remainingSeconds ?? getRemainingSeconds(booking.reserved_until);
  const reservationWindowSeconds = getReservationWindowSeconds(booking);
  const progressWidth = booking.status === "RESERVED" ? Math.max(0, Math.min(100, (safeRemainingSeconds / reservationWindowSeconds) * 100)) : 0;
  const isExpired = booking.status === "EXPIRED" || (booking.status === "RESERVED" && safeRemainingSeconds <= 0);
  const canPay = booking.status === "RESERVED" && safeRemainingSeconds > 0 && !isStartingKhalti;
  const timerTone = safeRemainingSeconds <= 120 ? "text-red-700" : safeRemainingSeconds <= 300 ? "text-amber-700" : "text-sportGreen";

  return (
    <div className="space-y-6">
      <BackButton href="/dashboard/player/bookings" label="Back to bookings" />

      <header className="flex flex-col gap-2 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="sport-eyebrow">Court reservation</p><h1 className="mt-1 text-2xl font-bold text-sportNavy sm:text-3xl">Complete your booking</h1><p className="mt-1 text-sm text-slate-600">Review the details below, then continue securely to Khalti.</p></div>
        <span className="text-xs font-semibold text-slate-500">Nepal Time (NPT)</span>
      </header>

      {matchmakingGameId || booking.matchmaking_game ? (
        <section className="rounded-xl border border-green-200 bg-green-50/80 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-sportGreen">Game booking handoff</p>
          <p className="mt-1 text-sm font-semibold text-green-950">After Khalti confirms payment, SportSpot will attach this booking to {booking.matchmaking_game_title || "your game plan"} automatically.</p>
        </section>
      ) : null}

      {notice ? <div className={`rounded-lg border px-4 py-3 text-sm font-semibold ${noticeTone === "warning" ? "border-amber-200 bg-amber-50 text-amber-950" : "border-green-200 bg-green-50 text-green-950"}`} role="status">{notice}</div> : null}
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-950" role="alert">{error}</div> : null}

      <section className="sport-surface p-5 sm:p-6">
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_260px] sm:items-center">
          <div>
            <p className="sport-eyebrow">Reservation hold</p>
            <p className="mt-2 text-lg font-bold text-sportNavy">Your selected time is temporarily held</p>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">Complete payment before the timer ends. The booking is confirmed only after payment is verified.</p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Time remaining</p>
                <p aria-live="polite" className={`mt-1 text-3xl font-bold tabular-nums ${isExpired ? "text-red-700" : timerTone}`}>
                  {booking.status === "RESERVED" ? formatCountdown(safeRemainingSeconds) : formatStatus(booking.status)}
                </p>
              </div>
              <StatusBadge label={isExpired ? "Expired" : booking.status === "RESERVED" ? "Held" : formatStatus(booking.status)} tone={isExpired ? "danger" : booking.status === "RESERVED" ? "success" : "neutral"} />
            </div>
            <div aria-hidden="true" className="mt-4 h-2 overflow-hidden rounded-full bg-white">
              <div className={`h-full rounded-full transition-all duration-500 ${safeRemainingSeconds <= 120 ? "bg-red-600" : "bg-sportGreen"}`} style={{ width: `${progressWidth}%` }} />
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-500">Reserved until {formatDateTime(booking.reserved_until)}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_350px]">
        <div className="space-y-6">
          <div className="sport-surface p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Booking code</p>
                <h2 className="mt-1 text-xl font-bold text-sportNavy">{booking.booking_code}</h2>
              </div>
              <div className="flex gap-2">
                <StatusBadge label={isExpired ? "Expired" : formatStatus(booking.status)} tone={isExpired ? "danger" : booking.status === "RESERVED" ? "success" : "neutral"} />
                <StatusBadge label={formatStatus(booking.payment_status)} tone={booking.payment_status === "PAID" ? "success" : booking.payment_status === "FAILED" ? "danger" : "warning"} />
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Info label="Venue" value={booking.venue_name} />
              <Info label="Court" value={booking.court_name} />
              <Info label="Date" value={formatDate(booking.slot_date)} />
              <Info label="Time" value={booking.booking_display_time || booking.slot_display_time} />
              <Info label="Duration" value={`${formatDuration(booking.total_duration_minutes)} · ${booking.slots_count} slot${booking.slots_count === 1 ? "" : "s"}`} />
              <Info label="Amount" value={formatNpr(booking.amount)} />
            </div>

            {booking.slots.length ? (
              <div className="mt-6 border-t border-slate-200 pt-5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-sportNavy">Reserved slot{booking.slots.length === 1 ? "" : "s"}</p>
                  <span className="text-xs font-semibold text-slate-500">{booking.slots.length} selected</span>
                </div>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {booking.slots.map((slot) => (
                    <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm" key={slot.id}>
                      <span className="font-semibold text-slate-600">{slot.display_time}</span>
                      <span className="font-bold text-sportNavy">{formatNpr(slot.price)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="sport-surface p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="sport-eyebrow">Payment</p>
                <p className="mt-1 text-lg font-bold text-sportNavy">Pay securely with Khalti</p>
                <p className="mt-2 text-sm text-slate-600">
                  Continue to Khalti to complete payment. SportSpot will confirm your booking after the payment is verified.
                </p>
              </div>
              <span className="inline-flex h-10 items-center rounded-md border border-slate-200 bg-white px-3 shadow-[0_2px_6px_rgba(15,23,42,0.04)]"><KhaltiLogo /></span>
            </div>

            {isExpired ? (
              <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900">
                This reservation expired before payment was completed. Please return to the venue page and select an available slot again.
              </div>
            ) : null}

            <button className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-md border border-[#e60023] bg-white px-5 text-sm font-bold text-sportNavy transition hover:bg-[#fff5f6] disabled:cursor-not-allowed disabled:opacity-60" disabled={!canPay || isStartingKhalti} onClick={payWithKhalti} type="button">
              {isStartingKhalti ? "Opening Khalti..." : <><span>Continue to</span><KhaltiLogo /></>}
            </button>

            {booking.status === "RESERVED" ? (
              <div className="mt-4 border-t border-slate-200 pt-4">
                {!showCancelConfirmation ? (
                  <button className="text-sm font-semibold text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-red-700" disabled={isCancelling} onClick={() => setShowCancelConfirmation(true)} type="button">
                    Cancel reservation
                  </button>
                ) : (
                  <div>
                    <p className="text-sm font-bold text-sportNavy">Release this held time?</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">No payment has been completed. The reservation will be cancelled and the time made available again.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button className="inline-flex min-h-10 items-center justify-center rounded-md bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60" disabled={isCancelling} onClick={cancelReservation} type="button">
                        {isCancelling ? "Cancelling..." : "Release Reservation"}
                      </button>
                      <button className="sport-secondary-button" disabled={isCancelling} onClick={() => setShowCancelConfirmation(false)} type="button">
                        Keep Reservation
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {booking.status === "CANCELLED" || booking.status === "EXPIRED" ? (
              <Link className="mt-4 block text-center text-sm font-bold text-sportGreen hover:text-green-700" href={`/courts/${booking.court}`}>
                Choose another time
              </Link>
            ) : null}

            <div className="mt-4 rounded-lg bg-slate-50 p-4 text-xs font-semibold leading-relaxed text-slate-600">
              Your booking will remain reserved until the countdown ends. If payment is not completed in time, the slot will be released.
            </div>
          </div>
        </div>

        <div className="sport-surface h-fit p-5 lg:sticky lg:top-24">
          <p className="text-lg font-bold text-sportNavy">Payment summary</p>
          <div className="mt-5 space-y-3 text-sm">
            <SummaryRow label="Court" value={booking.court_name} />
            <SummaryRow label="Date" value={formatDate(booking.slot_date)} />
            <SummaryRow label="Time" value={booking.booking_display_time || booking.slot_display_time} />
            <SummaryRow label="Duration" value={formatDuration(booking.total_duration_minutes)} />
            <SummaryRow label="Slots" value={`${booking.slots_count}`} />
            <div className="border-t border-slate-200 pt-3">
              <SummaryRow label="Total" value={formatNpr(booking.amount)} strong />
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

function formatNpr(value: string | number) {
  return `NPR ${Number(value).toLocaleString("en-NP")}`;
}

function formatStatus(value: string) {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
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
      <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">{label}</p>
      <p className="mt-2 font-bold text-sportNavy">{value}</p>
    </div>
  );
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-semibold text-slate-500">{label}</span>
      <span className={strong ? "text-lg font-bold text-sportNavy" : "font-bold text-sportNavy"}>{value}</span>
    </div>
  );
}

function KhaltiLogo() {
  return <Image alt="Khalti" className="h-6 w-auto" height={30} priority src="/images/khalti-logo.png" width={68} />;
}

function StatusBadge({ label, tone }: { label: string; tone: "success" | "warning" | "danger" | "neutral" }) {
  const toneClasses = {
    success: "bg-green-100 text-green-700",
    warning: "bg-amber-100 text-amber-700",
    danger: "bg-red-100 text-red-700",
    neutral: "bg-slate-100 text-slate-700",
  };

  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${toneClasses[tone]}`}>{label}</span>;
}
