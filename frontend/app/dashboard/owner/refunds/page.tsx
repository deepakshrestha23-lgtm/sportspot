"use client";

import { useEffect, useState } from "react";

import FeedbackToast from "@/components/FeedbackToast";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateOnly } from "@/lib/dates";
import type { Booking, RefundStatus } from "@/types/venue";

const filters: Array<RefundStatus | "ALL"> = ["ALL", "PENDING_OWNER_ACTION", "REFUNDED", "PARTIALLY_REFUNDED"];

export default function OwnerRefundsPage() {
  const [refunds, setRefunds] = useState<Booking[]>([]);
  const [filter, setFilter] = useState<RefundStatus | "ALL">("PENDING_OWNER_ACTION");
  const [activeBookingId, setActiveBookingId] = useState<number | null>(null);
  const [ownerNotes, setOwnerNotes] = useState<Record<number, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    loadRefunds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function loadRefunds() {
    setIsLoading(true);
    setError("");
    setNotice("");
    try {
      const endpoint = filter === "ALL" ? "/api/venues/owner/refunds/" : `/api/venues/owner/refunds/?status=${filter}`;
      const response = await api.get<{ refunds: Booking[] }>(endpoint);
      setRefunds(response.data.refunds);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load refund requests."));
    } finally {
      setIsLoading(false);
    }
  }

  async function reviewRefund(booking: Booking) {
    setIsWorking(true);
    setActiveBookingId(booking.id);
    setError("");
    setNotice("");
    try {
      const response = await api.post<{ booking: Booking }>(`/api/venues/owner/refunds/${booking.id}/review/`, {
        action: "MARK_REFUNDED",
        owner_note: (ownerNotes[booking.id] || "").trim(),
      });
      setRefunds((currentRefunds) => currentRefunds.map((refund) => (refund.id === response.data.booking.id ? response.data.booking : refund)));
      setOwnerNotes((current) => ({ ...current, [booking.id]: "" }));
      setNotice(`${response.data.booking.booking_code} updated. Refund status: ${formatStatus(response.data.booking.refund_status)}.`);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not update refund request."));
    } finally {
      setIsWorking(false);
      setActiveBookingId(null);
    }
  }

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

      <OwnerPageHeader description="Review eligible refunds for your venue. SportSpot calculates the entitlement; record the outcome for the player." eyebrow="Venue Manager" title="Payments & Refunds" />

      <div className="sport-tab-list overflow-x-auto">
        {filters.map((item) => (
          <button aria-selected={filter === item} className="sport-tab" key={item} onClick={() => setFilter(item)} type="button">
            {formatStatus(item)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="sport-surface mt-6 p-6">Loading refund requests...</div>
      ) : refunds.length === 0 ? (
        <div className="sport-empty-state mt-6">
          <h2 className="text-xl font-black text-sportNavy">No refund requests found</h2>
          <p className="mt-2 text-sm text-slate-600">Eligible booking cancellations for your venue will appear here.</p>
        </div>
      ) : (
        <section className="mt-6 grid gap-5">
          {refunds.map((booking) => (
            <article className="sport-card" key={booking.id}>
              <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr_1fr]">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-sportGreen">{booking.booking_code}</p>
                  <h2 className="mt-1 text-xl font-black text-sportNavy">{booking.player_name}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {booking.venue_name} · {booking.court_name}
                  </p>
                </div>
                <Info label="Booking Date / Time" value={`${formatDateOnly(booking.slot_date)} · ${booking.booking_display_time || booking.slot_display_time}`} />
                <Info label="Amount" value={`Rs ${Number(booking.amount).toLocaleString()}`} />
              </div>

              <div className="mt-5 grid gap-4 rounded-lg bg-slate-50 p-4 md:grid-cols-2">
                <Info label="Refund Tier" value={formatStatus(booking.cancellation_tier)} />
                <Info label="Refund Calculation" value={`${booking.refund_percentage}% · Rs ${Number(booking.refund_amount).toLocaleString()}`} />
                <Info label="Cancellation Reason" value={booking.cancellation_reason || "Not provided"} />
                <Info label="Refund Eligibility Reason" value={booking.refund_reason || "Not provided"} />
                <Info label="Payment Status" value={formatStatus(booking.payment_status)} />
                <Info label="Refund Status" value={formatStatus(booking.refund_status)} />
              </div>

              {booking.refund_owner_note ? (
                <div className="mt-4 rounded-lg border border-slate-200 p-4">
                  <Info label="Owner Note" value={booking.refund_owner_note} />
                </div>
              ) : null}

              {booking.refund_status === "PENDING_OWNER_ACTION" ? (
                <div className="mt-5 space-y-4">
                  <label className="block">
                    <span className="text-sm font-black text-sportNavy">Owner note</span>
                    <textarea
                      className="sport-input mt-2 min-h-20"
                      onChange={(event) => setOwnerNotes((current) => ({ ...current, [booking.id]: event.target.value }))}
                      placeholder="Required: refund reference or processing note."
                      value={ownerNotes[booking.id] || ""}
                    />
                  </label>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <button
                      className="sport-primary-button"
                      disabled={(isWorking && activeBookingId === booking.id) || (ownerNotes[booking.id] || "").trim().length < 3}
                      onClick={() => reviewRefund(booking)}
                      type="button"
                    >
                      {isWorking && activeBookingId === booking.id
                        ? "Processing..."
                        : `Mark Rs ${Number(booking.refund_amount).toLocaleString()} Processed`}
                    </button>
                    <p className="text-xs font-semibold leading-5 text-slate-500">
                      SportSpot has locked this entitlement from the booking policy. It cannot be rejected or reduced here.
                    </p>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      )}
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

function formatStatus(statusValue: string) {
  return statusValue.replaceAll("_", " ");
}
