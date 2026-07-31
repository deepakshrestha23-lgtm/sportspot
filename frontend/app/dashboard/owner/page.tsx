"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getCurrentUser } from "@/lib/auth";
import { getLocalDateString } from "@/lib/dates";
import type { User } from "@/types/auth";
import type { Booking, CourtSlot, Venue } from "@/types/venue";

const setupChecklist = [
  "Add venue details",
  "Add court information",
  "Add hours, slots and pricing",
  "Submit proof for admin approval",
];

export default function OwnerDashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [refunds, setRefunds] = useState<Booking[]>([]);
  const [slots, setSlots] = useState<CourtSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setUser(getCurrentUser());
    loadVenue();
  }, []);

  async function loadVenue() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<{ venue: Venue | null }>("/api/venues/owner/venue/");
      setVenue(response.data.venue);
      if (response.data.venue?.status === "APPROVED") {
        const [bookingsResponse, refundsResponse, slotsResponse] = await Promise.all([
          api.get<{ bookings: Booking[] }>("/api/venues/owner/bookings/"),
          api.get<{ refunds: Booking[] }>("/api/venues/owner/refunds/?status=PENDING_OWNER_ACTION"),
          api.get<{ slots: CourtSlot[] }>("/api/venues/owner/slots/"),
        ]);
        setBookings(bookingsResponse.data.bookings);
        setRefunds(refundsResponse.data.refunds);
        setSlots(slotsResponse.data.slots);
      } else {
        setBookings([]);
        setRefunds([]);
        setSlots([]);
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load owner dashboard."));
    } finally {
      setIsLoading(false);
    }
  }

  const state = getOwnerState(venue);
  const operations = getOwnerOperations(bookings, refunds, slots);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="rounded-lg bg-sportNavy p-6 text-white shadow-sm">
        <p className="text-sm font-black uppercase tracking-wide text-green-300">Court Owner Dashboard</p>
        <h1 className="mt-2 text-3xl font-black">Welcome{user?.full_name ? `, ${user.full_name}` : ""}</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Set up your Cricksal venue, get it verified, then manage court slots and player bookings from one place.
        </p>
      </section>


      {isLoading ? (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-slate-500">Loading venue status...</p>
        </section>
      ) : (
        <section className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <StatusBadge status={state.statusLabel} tone={state.tone} />
            <h2 className="mt-4 text-2xl font-black text-sportNavy">{state.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{state.description}</p>

            {venue?.admin_review_note ? (
              <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-black">Admin note</p>
                <p className="mt-1">{venue.admin_review_note}</p>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              {state.primaryHref ? (
                <Link className="rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" href={state.primaryHref}>
                  {state.primaryLabel}
                </Link>
              ) : null}
              {venue?.status === "APPROVED" ? (
                <>
                  <Link className="rounded-md border border-slate-200 px-5 py-3 text-sm font-black text-sportNavy hover:bg-slate-50" href="/dashboard/owner/venue">
                    Manage Venue
                  </Link>
                  <Link className="rounded-md border border-slate-200 px-5 py-3 text-sm font-black text-sportNavy hover:bg-slate-50" href="/dashboard/owner/bookings">
                    View Bookings
                  </Link>
                  <Link className="rounded-md border border-slate-200 px-5 py-3 text-sm font-black text-sportNavy hover:bg-slate-50" href="/dashboard/owner/calendar">
                    Slot Calendar
                  </Link>
                </>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-black uppercase tracking-wide text-sportGreen">Setup Checklist</p>
            <div className="mt-4 space-y-3">
              {setupChecklist.map((item, index) => (
                <div className="flex items-center gap-3 rounded-md bg-slate-50 p-3" key={item}>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sportGreen text-xs font-black text-white">{index + 1}</span>
                  <span className="text-sm font-semibold text-slate-700">{item}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Stat label="Venue Status" value={venue ? formatChoice(venue.status) : "Not Set Up"} />
              <Stat label="Court Status" value={venue?.courts?.length ? `${venue.courts.length} court added` : "No Courts Added"} />
              <Stat label="Approval Status" value={venue ? formatChoice(venue.status) : "Not Submitted"} />
              <Stat label="Bookings" value={venue?.status === "APPROVED" ? "Available" : "Not Available Yet"} />
            </div>
          </div>
        </section>
      )}

      {!isLoading && venue?.status === "APPROVED" ? (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-wide text-sportGreen">Operations Snapshot</p>
              <h2 className="mt-2 text-2xl font-black text-sportNavy">Today and attention items</h2>
              <p className="mt-2 text-sm text-slate-600">Use this overview to decide whether to check bookings, calendar, or refunds first.</p>
            </div>
            <Link className="rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" href="/dashboard/owner/calendar">
              Open Calendar
            </Link>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Today's Bookings" value={operations.todayBookings} />
            <Stat label="Unpaid Holds" value={operations.unpaidReservations} />
            <Stat label="Upcoming Confirmed" value={operations.upcomingConfirmed} />
            <Stat label="Pending Refunds" value={operations.pendingRefunds} />
            <Stat label="Booked Slots" value={operations.bookedSlots} />
            <Stat label="Blocked Slots" value={operations.blockedSlots} />
            <Stat label="Completed Bookings" value={operations.completedBookings} />
            <Stat label="Paid Revenue" value={`Rs ${operations.paidRevenue.toLocaleString()}`} />
          </div>
        </section>
      ) : null}
    </main>
  );
}

function getOwnerState(venue: Venue | null) {
  if (!venue) {
    return {
      statusLabel: "Not Set Up",
      tone: "slate",
      title: "Your venue is not set up yet.",
      description: "Complete your Cricksal venue profile, add courts, generate slots, and submit proof for admin approval.",
      primaryLabel: "Complete Venue Setup",
      primaryHref: "/dashboard/owner/venue-setup",
    };
  }
  if (!venue.is_active) {
    return {
      statusLabel: "Deactivated",
      tone: "red",
      title: "Your venue is deactivated.",
      description: "This venue is hidden from players and cannot receive new bookings. Booking history remains saved for owner and admin reference.",
      primaryLabel: "Manage Venue",
      primaryHref: "/dashboard/owner/venue",
    };
  }
  if (venue.status === "DRAFT") {
    return {
      statusLabel: "Draft",
      tone: "amber",
      title: "Venue setup is in progress.",
      description: "Continue your setup and submit it when venue details, courts, slots, and verification proof are ready.",
      primaryLabel: "Continue Setup",
      primaryHref: "/dashboard/owner/venue-setup",
    };
  }
  if (venue.status === "PENDING") {
    return {
      statusLabel: "Pending Verification",
      tone: "blue",
      title: "Your venue is under admin review.",
      description: "Players cannot book this venue until an admin approves it. You can still view or update submitted details.",
      primaryLabel: "View Venue Details",
      primaryHref: "/dashboard/owner/venue-setup",
    };
  }
  if (venue.status === "NEEDS_CHANGES") {
    return {
      statusLabel: "Needs Changes",
      tone: "amber",
      title: "Admin requested changes.",
      description: "Review the admin note, update your venue details, and resubmit for verification.",
      primaryLabel: "Fix Venue Submission",
      primaryHref: "/dashboard/owner/venue-setup",
    };
  }
  if (venue.status === "REJECTED") {
    return {
      statusLabel: "Rejected",
      tone: "red",
      title: "Your venue submission was rejected.",
      description: "You can edit the venue information and submit again if the issue can be resolved.",
      primaryLabel: "Edit and Resubmit",
      primaryHref: "/dashboard/owner/venue-setup",
    };
  }
  if (venue.status === "SUSPENDED") {
    return {
      statusLabel: "Suspended",
      tone: "red",
      title: "This venue is currently suspended.",
      description: "Suspended venues are hidden from players and cannot receive bookings.",
      primaryLabel: "View Venue Details",
      primaryHref: "/dashboard/owner/venue-setup",
    };
  }
  return {
    statusLabel: "Approved",
    tone: "green",
    title: "Your Cricksal venue is live.",
    description: "Players can now discover your approved courts, reserve slots, and complete payment bookings.",
    primaryLabel: "Manage Venue",
    primaryHref: "/dashboard/owner/venue",
  };
}

function StatusBadge({ status, tone }: { status: string; tone: string }) {
  const classes: Record<string, string> = {
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
    blue: "bg-blue-100 text-blue-800",
    slate: "bg-slate-100 text-slate-700",
  };
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${classes[tone]}`}>{status}</span>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 font-black text-sportNavy">{value}</p>
    </div>
  );
}

function getOwnerOperations(bookings: Booking[], refunds: Booking[], slots: CourtSlot[]) {
  const today = getLocalDateString();
  const activeBookingStatuses = ["RESERVED", "CONFIRMED"];
  return {
    todayBookings: bookings.filter((booking) => booking.slot_date === today && activeBookingStatuses.includes(booking.status)).length,
    unpaidReservations: bookings.filter((booking) => booking.status === "RESERVED" && booking.payment_status === "PENDING").length,
    upcomingConfirmed: bookings.filter((booking) => booking.status === "CONFIRMED" && booking.slot_date >= today).length,
    pendingRefunds: refunds.length,
    bookedSlots: slots.filter((slot) => slot.status === "BOOKED").length,
    blockedSlots: slots.filter((slot) => slot.status === "BLOCKED").length,
    completedBookings: bookings.filter((booking) => booking.status === "COMPLETED").length,
    paidRevenue: bookings
      .filter((booking) => ["CONFIRMED", "COMPLETED"].includes(booking.status) && booking.payment_status === "PAID")
      .reduce((total, booking) => total + Number(booking.amount), 0),
  };
}

function formatChoice(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
