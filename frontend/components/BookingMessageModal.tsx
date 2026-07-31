"use client";

import { useEffect, useRef, useState } from "react";

import type { Booking } from "@/types/venue";

export type BookingMessagePayload = {
  message_type: "ENTRY_INSTRUCTIONS" | "MAINTENANCE_NOTICE" | "ACCESS_UPDATE" | "VENUE_CLOSURE" | "GENERAL";
  message: string;
};

export default function BookingMessageModal({
  booking,
  isWorking,
  onClose,
  onSend,
}: {
  booking: Booking;
  isWorking: boolean;
  onClose: () => void;
  onSend: (payload: BookingMessagePayload) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [messageType, setMessageType] = useState<BookingMessagePayload["message_type"]>("ENTRY_INSTRUCTIONS");
  const [message, setMessage] = useState("");
  const isValid = message.trim().length >= 5;

  useEffect(() => {
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isWorking) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isWorking, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div
        aria-labelledby="booking-message-title"
        aria-modal="true"
        className="w-full max-w-lg rounded-lg bg-white shadow-2xl outline-none"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="border-b border-slate-200 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-sportGreen">Booking message</p>
              <h2 className="mt-1 text-xl font-black text-sportNavy" id="booking-message-title">Message {booking.player_name}</h2>
              <p className="mt-1 text-sm text-slate-500">{booking.booking_code} · {booking.court_name}</p>
            </div>
            <button aria-label="Close message form" className="rounded-md p-2 text-slate-500 hover:bg-slate-100" disabled={isWorking} onClick={onClose} type="button">
              <CloseIcon />
            </button>
          </div>
        </div>
        <div className="space-y-4 p-5">
          <label className="block">
            <span className="text-sm font-black text-sportNavy">Message type</span>
            <select
              className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-sportGreen focus:ring-2 focus:ring-green-100"
              onChange={(event) => setMessageType(event.target.value as BookingMessagePayload["message_type"])}
              value={messageType}
            >
              <option value="ENTRY_INSTRUCTIONS">Entry instructions</option>
              <option value="ACCESS_UPDATE">Access instructions update</option>
              <option value="MAINTENANCE_NOTICE">Maintenance notice</option>
              <option value="VENUE_CLOSURE">Venue closure</option>
              <option value="GENERAL">Important booking message</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-black text-sportNavy">Message</span>
            <textarea
              className="mt-2 min-h-32 w-full resize-y rounded-md border border-slate-300 px-3 py-3 text-sm leading-6 outline-none focus:border-sportGreen focus:ring-2 focus:ring-green-100"
              maxLength={500}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Share only information the player needs for this booking."
              value={message}
            />
            <span className="mt-1 block text-right text-xs text-slate-400">{message.length}/500</span>
          </label>
          <p className="rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            This sends an in-app notification only to the player connected to this booking.
          </p>
        </div>
        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 p-5 sm:flex-row sm:justify-end">
          <button className="rounded-md border border-slate-300 px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50" disabled={isWorking} onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700 disabled:bg-slate-400"
            disabled={isWorking || !isValid}
            onClick={() => onSend({ message_type: messageType, message: message.trim() })}
            type="button"
          >
            {isWorking ? "Sending..." : "Send Important Message"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}
