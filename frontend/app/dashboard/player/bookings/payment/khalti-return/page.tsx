"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { emitToast } from "@/lib/toast";
import type { Booking } from "@/types/venue";

function KhaltiReturnContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bookingId = searchParams.get("booking_id");
  const pidx = searchParams.get("pidx");
  const khaltiStatus = searchParams.get("status");
  const matchmakingGameId = searchParams.get("matchmaking_game");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isVerifying, setIsVerifying] = useState(true);

  useEffect(() => {
    async function verifyPayment() {
      if (!bookingId || !pidx) {
        setError("We could not verify your payment. Please open your booking and try again.");
        emitToast({ message: "We could not verify your payment. Please open your booking and try again.", type: "error" });
        setIsVerifying(false);
        return;
      }

      try {
        const response = await api.post<{ booking: Booking; detail?: string; matchmaking_game?: { id: number; title: string; room_url: string; manage_url: string; requires_reconfirmation: boolean } }>(
          `/api/venues/bookings/${bookingId}/khalti/verify/`,
          { pidx },
        );
        setBooking(response.data.booking);
        setNotice(response.data.detail || "");
        if (response.data.booking.status === "CONFIRMED") {
          if (response.data.matchmaking_game || response.data.booking.matchmaking_game || matchmakingGameId) {
            const gameId = response.data.matchmaking_game?.id || response.data.booking.matchmaking_game || matchmakingGameId;
            emitToast({ message: response.data.matchmaking_game?.requires_reconfirmation ? "Your booking is confirmed. Players may need to reconfirm the updated game plan." : "Your booking is confirmed and the game has been updated.", type: "success", dedupeKey: `game-booking-confirmed-${response.data.booking.id}` });
            router.replace(response.data.matchmaking_game?.room_url || `/dashboard/player/games/${gameId}/room`);
            return;
          }
          emitToast({ message: "Your booking has been confirmed.", type: "success", dedupeKey: `booking-confirmed-${response.data.booking.id}` });
          router.replace(`/dashboard/player/bookings/${response.data.booking.id}`);
          return;
        }
        if (response.data.detail) {
          emitToast({ message: response.data.detail, type: "warning", dedupeKey: `khalti-payment-notice-${response.data.booking.id}` });
        }
      } catch (requestError) {
        setError(getApiErrorMessage(requestError, "We could not verify your payment. Please try again."));
      } finally {
        setIsVerifying(false);
      }
    }

    verifyPayment();
  }, [bookingId, pidx, router]);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <p className="sport-eyebrow">Payment verification</p>
      <h1 className="mt-1 text-2xl font-bold text-sportNavy sm:text-3xl">
        {isVerifying ? "Verifying your payment" : error ? "Payment needs attention" : "Payment status checked"}
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        SportSpot checks Khalti directly before confirming your Cricksal booking. This keeps the booking pass tied to a verified payment.
      </p>

      <div className="sport-surface mt-6 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold text-slate-600">Payment status</span>
          <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-sportGreen">
            {formatStatus(khaltiStatus || booking?.khalti_status || "Checking")}
          </span>
        </div>
        {booking ? (
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <Info label="Booking code" value={booking.booking_code} />
            <Info label="Payment" value={formatStatus(booking.payment_status)} />
            <Info label="Booking" value={formatStatus(booking.status)} />
            <Info label="Amount" value={formatNpr(booking.amount)} />
          </div>
        ) : null}
      </div>

      {isVerifying ? (
        <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-950" role="status">
          Please wait. We are confirming your payment with Khalti.
        </div>
      ) : null}

      {notice && !error ? <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950" role="status">{notice}</div> : null}
      {error ? <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-950" role="alert">{error}</div> : null}

      {!isVerifying ? (
        <div className="mt-6 flex flex-wrap gap-3">
          {booking?.status === "CONFIRMED" ? (
            <Link className="sport-primary-button" href={`/dashboard/player/bookings/${booking.id}`}>
              View Booking Pass
            </Link>
          ) : null}
          {bookingId ? (
            <Link className="sport-secondary-button" href={`/dashboard/player/bookings/payment/${bookingId}`}>
              Back to Payment
            </Link>
          ) : null}
          <Link className="sport-secondary-button" href="/dashboard/player/bookings">
            My Bookings
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">{label}</p>
      <p className="mt-1 font-bold text-sportNavy">{value}</p>
    </div>
  );
}

function formatNpr(value: string | number) {
  return `NPR ${Number(value).toLocaleString("en-NP")}`;
}

function formatStatus(value: string) {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export default function KhaltiReturnPage() {
  return (
    <Suspense
      fallback={
        <div aria-label="Loading payment verification" className="mx-auto w-full max-w-2xl" role="status">
          <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
          <div className="mt-4 h-40 animate-pulse rounded-xl bg-white" />
        </div>
      }
    >
      <KhaltiReturnContent />
    </Suspense>
  );
}
