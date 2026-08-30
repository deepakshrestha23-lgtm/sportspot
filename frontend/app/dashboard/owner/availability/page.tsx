"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import LoadingIndicator from "@/components/LoadingIndicator";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { Court, Venue } from "@/types/venue";

export default function OwnerAvailabilityPage() {
  const [courts, setCourts] = useState<Court[]>([]);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadAvailability() {
      setIsLoading(true);
      setError("");
      try {
        const [courtsResponse, venueResponse] = await Promise.all([
          api.get<{ courts: Court[] }>("/api/venues/owner/courts/"),
          api.get<{ venue: Venue | null }>("/api/venues/owner/venue/"),
        ]);
        if (!mounted) return;
        setCourts(courtsResponse.data.courts);
        setVenue(venueResponse.data.venue);
      } catch (requestError) {
        if (mounted) setError(getApiErrorMessage(requestError, "Could not load availability."));
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    void loadAvailability();
    return () => {
      mounted = false;
    };
  }, []);

  const activeCourts = courts.filter((court) => court.is_active);
  const courtsNeedingSetup = activeCourts.filter((court) => !court.lowest_price);
  const isPlayerVisible = Boolean(venue?.status === "APPROVED" && venue.is_active);
  const totalBookings = courts.reduce((total, court) => total + court.bookings_count, 0);

  return (
    <div className="owner-availability-page space-y-6">
      <OwnerPageHeader
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link className="owner-secondary-button" href="/dashboard/owner/courts">Manage courts</Link>
            <Link className="owner-primary-button" href="/dashboard/owner/calendar">Open calendar</Link>
          </div>
        }
        description="Publish bookable time, review court capacity, and protect unavailable periods from one operational workflow."
        eyebrow="Venue Manager"
        title="Availability & Pricing"
      />

      {isLoading ? <AvailabilityLoading /> : null}

      {!isLoading && error ? (
        <section className="owner-availability-message" role="alert">
          <div>
            <p className="owner-section-kicker">Could not load inventory</p>
            <h2>Availability is temporarily unavailable.</h2>
            <p>{error}</p>
          </div>
          <button className="owner-secondary-button" onClick={() => window.location.reload()} type="button">Try again</button>
        </section>
      ) : null}

      {!isLoading && !error && !venue ? (
        <section className="sport-empty-state">
          <p className="owner-section-kicker">Venue setup required</p>
          <h2 className="mt-2 text-xl font-black text-sportNavy">Create your venue before publishing time</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">Availability belongs to a real venue and its physical courts. Complete the venue profile first, then add courts and publish their slots.</p>
          <Link className="owner-primary-button mt-5" href="/dashboard/owner/venue-setup">Complete venue setup</Link>
        </section>
      ) : null}

      {!isLoading && !error && venue ? (
        <>
          <section className="owner-availability-context">
            <div className="min-w-0">
              <p className="owner-section-kicker">Venue schedule</p>
              <div className="owner-availability-context-heading">
                <h2>{venue.name || "Your venue"}</h2>
                <span className={`owner-status ${isPlayerVisible ? "owner-status-success" : "owner-status-neutral"}`}>
                  {isPlayerVisible ? "Visible to players" : formatVenueStatus(venue.status)}
                </span>
              </div>
              <p>{venue.area || "Area not set"}, {venue.city || "District not set"} · {formatHours(venue)}</p>
            </div>
            <Link className="owner-availability-context-link" href="/dashboard/owner/venue">View venue details <span aria-hidden="true">-&gt;</span></Link>
          </section>

          <section aria-label="Availability summary" className="owner-availability-stats">
            <AvailabilityStat label="Active courts" value={String(activeCourts.length)} />
            <AvailabilityStat label="Needs publishing" tone={courtsNeedingSetup.length ? "warning" : "default"} value={String(courtsNeedingSetup.length)} />
            <AvailabilityStat label="Booking records" value={String(totalBookings)} />
            <AvailabilityStat label="Player visibility" tone={isPlayerVisible ? "success" : "warning"} value={isPlayerVisible ? "Live" : "Hidden"} />
          </section>

          {courts.length === 0 ? (
            <section className="sport-empty-state">
              <p className="owner-section-kicker">Start your inventory</p>
              <h2 className="mt-2 text-xl font-black text-sportNavy">No courts added yet</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">Add each physical play area separately. Its slots, pricing, bookings, and blocks are managed independently.</p>
              <Link className="owner-primary-button mt-5" href="/dashboard/owner/courts/create">Add your first court</Link>
            </section>
          ) : (
            <section className="owner-availability-panel" aria-labelledby="availability-courts-heading">
              <div className="owner-availability-panel-header">
                <div>
                  <p className="owner-section-kicker">Court inventory</p>
                  <h2 id="availability-courts-heading">Publish and protect each court</h2>
                  <p>Every court has its own slot duration, price, published time, and blocked periods.</p>
                </div>
                <Link className="owner-secondary-button" href="/dashboard/owner/courts/create">Add court</Link>
              </div>

              <div className="owner-availability-court-list">
                {courts.map((court) => <AvailabilityCourtRow court={court} key={court.id} />)}
              </div>

              <div className="owner-availability-help">
                <div>
                  <p className="owner-section-kicker">How this works</p>
                  <p>Generate future slots from a court, then use the calendar to review bookings or block a specific period. Existing bookings stay protected.</p>
                </div>
                <Link className="owner-availability-help-link" href="/dashboard/owner/calendar">Review live calendar <span aria-hidden="true">-&gt;</span></Link>
              </div>
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}

function AvailabilityCourtRow({ court }: { court: Court }) {
  const isPublished = Boolean(court.lowest_price);
  return (
    <article className="owner-availability-court-row">
      <div className="owner-availability-court-identity">
        <div className="owner-availability-court-mark">
          {court.court_photo ? <img alt="" src={getMediaUrl(court.court_photo)} /> : <span>{formatChoice(court.court_type).slice(0, 1)}</span>}
        </div>
        <div className="min-w-0">
          <div className="owner-availability-court-title">
            <h3>{court.name}</h3>
            <span className={`owner-status ${court.is_active ? "owner-status-success" : "owner-status-neutral"}`}>{court.is_active ? "Active" : "Inactive"}</span>
          </div>
          <p>{formatChoice(court.court_type)} · {formatChoice(court.surface_type)}</p>
        </div>
      </div>

      <div className="owner-availability-court-details">
        <div>
          <span>Publishing</span>
          <strong className={isPublished ? "is-ready" : "is-pending"}>{court.is_active ? (isPublished ? "Slots published" : "Needs slots") : "Not bookable"}</strong>
        </div>
        <div>
          <span>Rate</span>
          <strong>{court.lowest_price ? `From NPR ${Number(court.lowest_price).toLocaleString()}` : "Not set"}</strong>
        </div>
        <div>
          <span>History</span>
          <strong>{court.bookings_count} booking{court.bookings_count === 1 ? "" : "s"}</strong>
        </div>
      </div>

      <div className="owner-availability-court-actions">
        <Link className="owner-primary-button" href={`/dashboard/owner/courts/${court.id}/slots`}>Manage slots</Link>
        <Link className="owner-availability-edit" href={`/dashboard/owner/courts/${court.id}/edit`}>Edit court</Link>
      </div>
    </article>
  );
}

function AvailabilityStat({ label, tone = "default", value }: { label: string; tone?: "default" | "success" | "warning"; value: string }) {
  return (
    <div className={`owner-availability-stat owner-availability-stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AvailabilityLoading() {
  return (
    <section className="sport-loading-inline-panel min-h-[18rem]" aria-label="Loading availability"><LoadingIndicator label="Loading availability" /></section>
  );
}

function formatChoice(value: string) {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatHours(venue: Venue) {
  if (!venue.opening_time || !venue.closing_time) return "Opening hours not set";
  return `${formatTime(venue.opening_time)} - ${formatTime(venue.closing_time)}`;
}

function formatTime(value: string) {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function formatVenueStatus(status: Venue["status"]) {
  return status === "NEEDS_CHANGES" ? "Needs changes" : formatChoice(status);
}

function getMediaUrl(path: string) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
  return `${baseUrl}${path}`;
}
