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
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState("");
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
        const response = await api.post<{ booking: Booking; detail?: string }>(
          `/api/venues/bookings/${bookingId}/khalti/verify/`,
          { pidx },
        );
        setBooking(response.data.booking);
        if (response.data.booking.status === "CONFIRMED") {
          emitToast({ message: "Your booking has been confirmed.", type: "success", dedupeKey: `booking-confirmed-${response.data.booking.id}` });
          router.replace(`/dashboard/player/bookings/${response.data.booking.id}`);
          return;
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
    <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wide text-purple-600">Khalti Payment</p>
      <h1 className="mt-2 text-3xl font-black text-sportNavy">
        {isVerifying ? "Verifying your payment" : error ? "Payment needs attention" : "Payment status checked"}
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        SportSpot checks Khalti directly before confirming your Cricksal booking. This keeps the booking pass tied to a verified payment.
      </p>

      <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-black text-slate-600">Gateway status</span>
          <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-purple-700">
            {khaltiStatus || booking?.khalti_status || "Checking"}
          </span>
        </div>
        {booking ? (
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <Info label="Booking code" value={booking.booking_code} />
            <Info label="Payment" value={booking.payment_status} />
            <Info label="Booking" value={booking.status} />
            <Info label="Amount" value={`Rs ${Number(booking.amount).toLocaleString()}`} />
          </div>
        ) : null}
      </div>

      {isVerifying ? (
        <div className="mt-6 rounded-lg bg-green-50 p-4 text-sm font-semibold text-green-800">
          Please wait. We are confirming your payment with Khalti.
        </div>
      ) : null}

      {error ? <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div> : null}

      {!isVerifying ? (
        <div className="mt-6 flex flex-wrap gap-3">
          {booking?.status === "CONFIRMED" ? (
            <Link className="rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" href={`/dashboard/player/bookings/${booking.id}`}>
              View Booking Pass
            </Link>
          ) : null}
          {bookingId ? (
            <Link className="rounded-md border border-slate-200 px-5 py-3 text-sm font-black text-sportNavy hover:bg-slate-50" href={`/dashboard/player/bookings/payment/${bookingId}`}>
              Back to Payment
            </Link>
          ) : null}
          <Link className="rounded-md border border-slate-200 px-5 py-3 text-sm font-black text-sportNavy hover:bg-slate-50" href="/dashboard/player/bookings">
            My Bookings
          </Link>
        </div>
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

export default function KhaltiReturnPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="h-6 w-48 animate-pulse rounded bg-slate-200" />
          <div className="mt-4 h-28 animate-pulse rounded bg-slate-100" />
        </div>
      }
    >
      <KhaltiReturnContent />
    </Suspense>
  );
}
