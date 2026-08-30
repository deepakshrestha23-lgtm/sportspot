"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import FeedbackToast from "@/components/FeedbackToast";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import LoadingIndicator from "@/components/LoadingIndicator";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateOnly, formatDateTimeInNepal } from "@/lib/dates";
import type { Booking, RefundStatus } from "@/types/venue";

type RefundFilter = RefundStatus | "ALL";

const filters: Array<{ label: string; value: RefundFilter }> = [
  { label: "All records", value: "ALL" },
  { label: "Needs action", value: "PENDING_OWNER_ACTION" },
  { label: "Refunded", value: "REFUNDED" },
  { label: "Partially refunded", value: "PARTIALLY_REFUNDED" },
  { label: "Rejected", value: "REJECTED" },
];

export default function OwnerRefundsPage() {
  const [refunds, setRefunds] = useState<Booking[]>([]);
  const [filter, setFilter] = useState<RefundFilter>("PENDING_OWNER_ACTION");
  const [activeBookingId, setActiveBookingId] = useState<number | null>(null);
  const [ownerNotes, setOwnerNotes] = useState<Record<number, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void loadRefunds();
  }, []);

  async function loadRefunds() {
    setIsLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await api.get<{ refunds: Booking[] }>("/api/venues/owner/refunds/");
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

  const visibleRefunds = useMemo(
    () => refunds.filter((booking) => filter === "ALL" || booking.refund_status === filter),
    [filter, refunds],
  );
  const pendingCount = refunds.filter((booking) => booking.refund_status === "PENDING_OWNER_ACTION").length;
  const processedCount = refunds.filter((booking) => booking.refund_status === "REFUNDED").length;
  const partialCount = refunds.filter((booking) => booking.refund_status === "PARTIALLY_REFUNDED").length;
  const pendingValue = refunds
    .filter((booking) => booking.refund_status === "PENDING_OWNER_ACTION")
    .reduce((total, booking) => total + Number(booking.refund_amount || 0), 0);

  return (
    <div className="owner-refunds-page space-y-6">
      <FeedbackToast
        message={error || notice}
        onClose={() => {
          setError("");
          setNotice("");
        }}
        type={error ? "error" : notice ? "success" : "info"}
      />

      <OwnerPageHeader
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link className="owner-secondary-button" href="/dashboard/owner/reports">View reports</Link>
            <button className="owner-secondary-button" disabled={isLoading} onClick={() => void loadRefunds()} type="button">
              {isLoading ? "Refreshing..." : "Refresh records"}
            </button>
          </div>
        }
        description="Review policy-approved refunds and record the payment outcome for cancelled venue bookings."
        eyebrow="Venue Manager"
        title="Payments & Refunds"
      />

      <section aria-label="Refund summary" className="owner-refund-summary">
        <SummaryItem label="Needs owner action" value={String(pendingCount)} detail={pendingCount ? `NPR ${formatMoney(pendingValue)} to record` : "Queue is clear"} tone="warning" />
        <SummaryItem label="Refunded" value={String(processedCount)} detail="Full refund records" tone="success" />
        <SummaryItem label="Partially refunded" value={String(partialCount)} detail="Partial refund records" tone="info" />
      </section>

      <section aria-labelledby="refund-queue-heading" className="owner-refund-workspace">
        <div className="owner-refund-workspace-header">
          <div>
            <p className="owner-section-kicker">Refund queue</p>
            <h2 id="refund-queue-heading">Payment outcomes</h2>
            <p>Each record stays tied to its booking, cancellation policy, and refund decision.</p>
          </div>
          <span className="owner-refund-count">{visibleRefunds.length} shown</span>
        </div>

        <div aria-label="Filter refund records" className="owner-refund-filters" role="tablist">
          {filters.map((item) => {
            const count = item.value === "ALL" ? refunds.length : refunds.filter((booking) => booking.refund_status === item.value).length;
            return (
              <button
                aria-selected={filter === item.value}
                className="owner-refund-filter"
                key={item.value}
                onClick={() => setFilter(item.value)}
                role="tab"
                type="button"
              >
                <span>{item.label}</span>
                <span className="owner-refund-filter-count">{count}</span>
              </button>
            );
          })}
        </div>

        {isLoading ? <RefundsLoading /> : null}

        {!isLoading && visibleRefunds.length === 0 ? (
          <div className="owner-refund-empty">
            <span className="owner-refund-empty-mark" aria-hidden="true" />
            <div>
              <h3>{filter === "PENDING_OWNER_ACTION" ? "No refunds need your action" : "No matching refund records"}</h3>
              <p>{filter === "PENDING_OWNER_ACTION" ? "When a paid booking is cancelled with a refund entitlement, it will appear in this queue." : "Try another status filter to review a different payment outcome."}</p>
            </div>
          </div>
        ) : null}

        {!isLoading && visibleRefunds.length ? (
          <div className="owner-refund-list">
            {visibleRefunds.map((booking) => (
              <RefundRecord
                booking={booking}
                isWorking={isWorking && activeBookingId === booking.id}
                key={booking.id}
                note={ownerNotes[booking.id] || ""}
                onNoteChange={(note) => setOwnerNotes((current) => ({ ...current, [booking.id]: note }))}
                onReview={() => void reviewRefund(booking)}
              />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function SummaryItem({ detail, label, tone, value }: { detail: string; label: string; tone: "info" | "success" | "warning"; value: string }) {
  return (
    <div className={`owner-refund-summary-item owner-refund-summary-${tone}`}>
      <span className="owner-refund-summary-label">{label}</span>
      <strong>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}

function RefundRecord({ booking, isWorking, note, onNoteChange, onReview }: { booking: Booking; isWorking: boolean; note: string; onNoteChange: (note: string) => void; onReview: () => void }) {
  const isPending = booking.refund_status === "PENDING_OWNER_ACTION";
  const refundAmount = formatMoney(booking.refund_amount);

  return (
    <article className="owner-refund-record">
      <div className="owner-refund-record-header">
        <div className="owner-refund-primary">
          <div className="owner-refund-identity">
            <span aria-hidden="true" className="owner-refund-avatar">{getInitials(booking.player_name)}</span>
            <div className="min-w-0">
              <p className="owner-refund-code">{booking.booking_code}</p>
              <h3>{booking.player_name}</h3>
              <p>{booking.venue_name} <span aria-hidden="true">&middot;</span> {booking.court_name}</p>
            </div>
          </div>
          <div className="owner-refund-schedule">
            <span className="owner-refund-label">Booking time</span>
            <strong>{formatDateOnly(booking.slot_date)} <span aria-hidden="true">&middot;</span> {booking.booking_display_time || booking.slot_display_time}</strong>
            <span>{formatDuration(booking.total_duration_minutes)} <span aria-hidden="true">&middot;</span> {booking.slots_count} slot{booking.slots_count === 1 ? "" : "s"}</span>
          </div>
        </div>
        <div className="owner-refund-financial">
          <div className="owner-refund-status-block">
            <span className="owner-refund-label">Refund status</span>
            <StatusPill status={booking.refund_status} />
          </div>
          <div className="owner-refund-total">
            <span className="owner-refund-label">Total paid</span>
            <strong>NPR {formatMoney(booking.amount)}</strong>
          </div>
        </div>
      </div>

      <div className="owner-refund-facts">
        <Fact label="Refund due" value={`${booking.refund_percentage}% · NPR ${refundAmount}`} emphasis />
        <Fact label="Refund tier" value={formatStatus(booking.cancellation_tier)} />
        <Fact label="Payment status" value={formatStatus(booking.payment_status)} />
        <Fact label="Cancelled because" value={booking.cancellation_reason || "Reason not provided"} />
      </div>

      <div className="owner-refund-policy-note">
        <span>Policy decision</span>
        <p>{booking.refund_reason || "No additional eligibility note was recorded."}</p>
      </div>

      {isPending ? (
        <div className="owner-refund-action">
          <div className="owner-refund-action-copy">
            <p className="owner-refund-label">Owner action required</p>
            <h4>Record the refund after you process it</h4>
            <p>SportSpot has already calculated the entitlement. Add a bank, wallet, or transaction reference so the player has a clear audit trail.</p>
          </div>
          <div className="owner-refund-action-form">
            <label className="owner-refund-note-field">
              <span>Processing note</span>
              <textarea onChange={(event) => onNoteChange(event.target.value)} placeholder="Example: Khalti refund reference RF-1001" value={note} />
              <small>{note.trim().length < 3 ? "At least 3 characters required" : "Ready to record"}</small>
            </label>
            <button className="owner-primary-button" disabled={isWorking || note.trim().length < 3} onClick={onReview} type="button">
              {isWorking ? "Recording..." : `Record NPR ${refundAmount} processed`}
            </button>
          </div>
        </div>
      ) : (
        <div className="owner-refund-history">
          <div>
            <span className="owner-refund-label">Owner record</span>
            <strong>{booking.refund_owner_note || "No processing note recorded"}</strong>
          </div>
          <div>
            <span className="owner-refund-label">Recorded</span>
            <strong>{booking.refund_reviewed_at ? formatDateTimeInNepal(booking.refund_reviewed_at) : "No timestamp available"}</strong>
          </div>
          <div>
            <span className="owner-refund-label">Status</span>
            <strong>{booking.refund_status === "REJECTED" ? "No refund processed" : "Record complete"}</strong>
          </div>
        </div>
      )}
    </article>
  );
}

function Fact({ emphasis = false, label, value }: { emphasis?: boolean; label: string; value: string }) {
  return (
    <div className="owner-refund-fact">
      <span>{label}</span>
      <strong className={emphasis ? "is-emphasis" : ""}>{value}</strong>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return <span className={`owner-refund-status owner-refund-status-${getStatusTone(status)}`}>{formatStatus(status)}</span>;
}

function RefundsLoading() {
  return (
    <div aria-label="Loading refund records" className="sport-loading-inline-panel min-h-[14rem]"><LoadingIndicator label="Loading refund records" /></div>
  );
}

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

function getStatusTone(status: string) {
  if (["REFUNDED", "PAID"].includes(status)) return "success";
  if (["PENDING_OWNER_ACTION", "PARTIALLY_REFUNDED", "REFUND_PENDING"].includes(status)) return "warning";
  if (["REJECTED", "FAILED"].includes(status)) return "danger";
  return "neutral";
}

function formatDuration(minutes: number) {
  if (!minutes) return "Duration not set";
  const hours = minutes / 60;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function formatMoney(value: string | number) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";
}

function formatStatus(statusValue: string) {
  return statusValue.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}
