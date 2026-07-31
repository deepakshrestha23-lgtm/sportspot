"use client";

import { useState } from "react";

import { formatDateOnly } from "@/lib/dates";
import type { Booking } from "@/types/venue";

export type CancelBookingPayload = {
  reason?: string;
  slot_action?: "AVAILABLE" | "BLOCK";
};

type CancelBookingModalProps = {
  actor: "player" | "owner";
  booking: Booking;
  isWorking?: boolean;
  onClose: () => void;
  onConfirm: (payload: CancelBookingPayload) => void;
};

export default function CancelBookingModal({ actor, booking, isWorking = false, onClose, onConfirm }: CancelBookingModalProps) {
  const [reason, setReason] = useState("");
  const [slotAction, setSlotAction] = useState<"AVAILABLE" | "BLOCK">("AVAILABLE");
  const isOwner = actor === "owner";
  const requiresReason = isOwner;
  const canSubmit = !requiresReason || reason.trim().length >= 5;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/70 px-4 py-6">
      <section className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="border-b border-slate-200 p-6">
          <p className="text-xs font-black uppercase tracking-wide text-red-600">Cancel Booking</p>
          <h2 className="mt-2 text-2xl font-black text-sportNavy">Are you sure you want to cancel this booking?</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Review the booking and the exact policy outcome before confirming. SportSpot calculates eligibility from the policy saved with this booking.
          </p>
        </div>

        <div className="space-y-5 p-6">
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
            <Info label="Venue" value={booking.venue_name} />
            <Info label="Court" value={booking.court_name} />
            <Info label="Date" value={formatDateOnly(booking.slot_date)} />
            <Info label="Time" value={booking.booking_display_time || booking.slot_display_time} />
            <Info label="Duration" value={`${formatDuration(booking.total_duration_minutes)} · ${booking.slots_count} slot${booking.slots_count === 1 ? "" : "s"}`} />
            <Info label="Amount" value={`Rs ${Number(booking.amount).toLocaleString()}`} />
          </div>

          <div className={`rounded-lg border p-4 ${getQuoteTone(booking.cancellation_quote.refund_percentage)}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-black text-sportNavy">Cancellation outcome</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">{booking.cancellation_quote.message}</p>
              </div>
              <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-black text-sportNavy">
                {formatStatus(booking.cancellation_quote.tier)}
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Info label="Refund Percentage" value={`${booking.cancellation_quote.refund_percentage}%`} />
              <Info label="Calculated Amount" value={`Rs ${Number(booking.cancellation_quote.refund_amount).toLocaleString()}`} />
            </div>
            {booking.cancellation_quote.refund_required ? (
              <p className="mt-3 text-xs font-semibold leading-5 text-slate-600">
                The venue owner will be asked to process this refund. The refund amount is calculated from the policy saved with your booking.
              </p>
            ) : null}
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-black text-sportNavy">Policy saved with this booking</p>
              <span className="text-xs font-black text-slate-400">Version {booking.cancellation_policy_details.version}</span>
            </div>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
              {booking.cancellation_policy_details.summary.map((item) => (
                <li className="flex gap-2" key={item}>
                  <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sportGreen" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            {booking.cancellation_policy_details.additional_notes ? (
              <p className="mt-3 border-t border-slate-200 pt-3 whitespace-pre-line text-sm leading-6 text-slate-600">
                {booking.cancellation_policy_details.additional_notes}
              </p>
            ) : null}
          </div>

          {isOwner ? (
            <div className="space-y-4 rounded-lg border border-slate-200 p-4">
              <label className="block">
                <span className="text-sm font-black text-sportNavy">Cancellation reason</span>
                <textarea
                  className="mt-2 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sportGreen focus:ring-2 focus:ring-green-100"
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Example: Court maintenance, emergency closure, weather issue"
                  value={reason}
                />
              </label>

              <div>
                <p className="text-sm font-black text-sportNavy">What should happen to these slots?</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button
                    className={`rounded-md border px-4 py-3 text-left text-sm font-bold ${slotAction === "AVAILABLE" ? "border-sportGreen bg-green-50 text-green-800" : "border-slate-200 text-slate-700"}`}
                    onClick={() => setSlotAction("AVAILABLE")}
                    type="button"
                  >
                    Release as Available
                    <span className="mt-1 block text-xs font-semibold text-slate-500">Players can book this time again.</span>
                  </button>
                  <button
                    className={`rounded-md border px-4 py-3 text-left text-sm font-bold ${slotAction === "BLOCK" ? "border-sportGreen bg-green-50 text-green-800" : "border-slate-200 text-slate-700"}`}
                    onClick={() => setSlotAction("BLOCK")}
                    type="button"
                  >
                    Block Slot
                    <span className="mt-1 block text-xs font-semibold text-slate-500">Use for maintenance or venue closure.</span>
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 p-6 sm:flex-row sm:justify-end">
          <button className="rounded-md border border-slate-300 px-5 py-3 text-sm font-black text-slate-700 hover:bg-slate-50" disabled={isWorking} onClick={onClose} type="button">
            Keep Booking
          </button>
          <button
            className="rounded-md bg-red-600 px-5 py-3 text-sm font-black text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={isWorking || !canSubmit}
            onClick={() => onConfirm({ reason: reason.trim(), slot_action: slotAction })}
            type="button"
          >
            {isWorking ? "Cancelling..." : getConfirmLabel(booking)}
          </button>
        </div>
      </section>
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

function formatDuration(minutes: number) {
  if (!minutes) return "Not set";
  const hours = minutes / 60;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function formatStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getQuoteTone(refundPercentage: number) {
  if (refundPercentage >= 100) return "border-green-200 bg-green-50";
  if (refundPercentage > 0) return "border-amber-200 bg-amber-50";
  return "border-red-200 bg-red-50";
}

function getConfirmLabel(booking: Booking) {
  if (booking.cancellation_quote.refund_required) {
    return `Cancel and Request Rs ${Number(booking.cancellation_quote.refund_amount).toLocaleString()} Refund`;
  }
  return "Cancel Booking";
}
