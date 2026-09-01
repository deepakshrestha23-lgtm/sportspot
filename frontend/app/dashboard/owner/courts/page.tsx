"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import ConfirmActionModal from "@/components/ConfirmActionModal";
import FeedbackToast from "@/components/FeedbackToast";
import MediaImage from "@/components/MediaImage";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { Court, Venue } from "@/types/venue";

type CourtAction = {
  court: Court;
  type: "delete" | "deactivate";
};

export default function OwnerCourtsPage() {
  const [courts, setCourts] = useState<Court[]>([]);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [pendingAction, setPendingAction] = useState<CourtAction | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const feedbackMessage = error || message;
  const feedbackType = error ? "error" : message ? "success" : "info";

  useEffect(() => {
    loadCourts();
  }, []);

  async function loadCourts() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<{ courts: Court[] }>("/api/venues/owner/courts/");
      const venueResponse = await api.get<{ venue: Venue | null }>("/api/venues/owner/venue/");
      setCourts(response.data.courts);
      setVenue(venueResponse.data.venue);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load courts."));
    } finally {
      setIsLoading(false);
    }
  }

  async function confirmCourtAction() {
    if (!pendingAction) return;
    setIsWorking(true);
    setMessage("");
    setError("");
    try {
      if (pendingAction.type === "delete") {
        await api.delete(`/api/venues/owner/courts/${pendingAction.court.id}/`);
        setCourts((current) => current.filter((court) => court.id !== pendingAction.court.id));
        setMessage("Court deleted successfully. Any generated slots without bookings were removed.");
      } else {
        const response = await api.post<{ court: Court }>(`/api/venues/owner/courts/${pendingAction.court.id}/deactivate/`);
        setCourts((current) => current.map((court) => (court.id === response.data.court.id ? response.data.court : court)));
        setMessage("Court deactivated. It is now hidden from players and cannot receive new bookings.");
      }
      setPendingAction(null);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, pendingAction.type === "delete" ? "Could not delete court." : "Could not deactivate court."));
    } finally {
      setIsWorking(false);
    }
  }

  const activeCourts = courts.filter((court) => court.is_active);
  const totalBookings = courts.reduce((total, court) => total + court.bookings_count, 0);

  return (
    <div className="owner-courts-page space-y-6">
      <FeedbackToast message={feedbackMessage} onClose={() => { setMessage(""); setError(""); }} type={feedbackType} />

      <OwnerPageHeader
        actions={venue ? <Link className="owner-primary-button" href="/dashboard/owner/courts/create">Add court</Link> : null}
        description="Manage each physical Cricksal court, its public visibility, photos, and bookable availability."
        eyebrow="Venue Manager"
        title="Courts"
      />

      {!isLoading && venue ? (
        <section className="owner-court-context">
          <div className="min-w-0">
            <p className="owner-section-kicker">Venue inventory</p>
            <h2>{venue.name || "Your venue"}</h2>
            <p>{venue.area || "Area not set"}, {venue.city || "District not set"} · {venue.status === "APPROVED" && venue.is_active ? "Players can discover active courts" : "Courts stay hidden until the venue is approved"}</p>
          </div>
          <div className="owner-court-context-stats">
            <Stat label="Active courts" value={activeCourts.length} />
            <Stat label="Total courts" value={courts.length} />
            <Stat label="Booking records" value={totalBookings} />
          </div>
        </section>
      ) : null}

      {isLoading ? (
        <div className="owner-panel owner-courts-loading">Loading courts...</div>
      ) : !venue ? (
        <section className="sport-empty-state">
          <p className="owner-section-kicker">Venue setup required</p>
          <h2 className="mt-2 text-xl font-black text-sportNavy">Create your venue before adding courts</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">Courts belong to one venue and inherit its location, operating hours, and player visibility rules.</p>
          <Link className="owner-primary-button mt-5" href="/dashboard/owner/venue-setup">Complete venue setup</Link>
        </section>
      ) : courts.length === 0 ? (
        <div className="sport-empty-state">
          <p className="owner-section-kicker">Start your inventory</p>
          <h2 className="mt-2 text-xl font-black text-sportNavy">No courts added yet</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">Add each physical play area separately. You can then publish slots and prices for each court.</p>
          <Link className="owner-primary-button mt-5" href="/dashboard/owner/courts/create">
            Add your first court
          </Link>
        </div>
      ) : (
        <section className="owner-court-grid" aria-label="Courts at this venue">
          {courts.map((court) => (
            <article className="owner-court-card" key={court.id}>
              <div className="owner-court-card-media">
                <MediaImage alt={`${court.name} court`} className="h-full w-full object-cover" fallback={<div className="owner-court-placeholder"><span>{formatChoice(court.court_type)}</span><strong>{court.name}</strong></div>} source={court.court_photo} />
                <span className={`owner-status ${court.is_active ? "owner-status-success" : "owner-status-neutral"}`}>{court.is_active ? "Active" : "Inactive"}</span>
              </div>
              <div className="owner-court-card-body">
                <div className="owner-court-card-heading">
                  <div className="min-w-0"><h2>{court.name}</h2><p>{formatChoice(court.court_type)} · {formatChoice(court.surface_type)}</p></div>
                  {court.lowest_price ? <strong className="owner-court-price">From NPR {Number(court.lowest_price).toLocaleString()}</strong> : null}
                </div>
                <p className="owner-court-description">{court.description || "Add a short description to help players choose this court."}</p>
                <div className="owner-court-meta"><span>{court.bookings_count} booking record{court.bookings_count === 1 ? "" : "s"}</span><span>{venue.status === "APPROVED" && court.is_active && venue.is_active ? "Player visible" : "Not player visible"}</span></div>
                <div className="owner-court-visibility">
                  {venue.is_active && venue.status === "APPROVED" && court.is_active
                    ? court.future_published_slot_count > 0
                      ? `${court.future_published_slot_count} future slot${court.future_published_slot_count === 1 ? "" : "s"} published for players.`
                      : "Visible to players after future slots are published."
                    : "Hidden until both the venue and this court are active."}
                </div>
                {!court.can_delete ? <p className="owner-court-warning">{court.delete_block_reason}</p> : null}
                <div className="owner-court-card-actions">
                  <Link className="owner-primary-button" href={`/dashboard/owner/courts/${court.id}/slots`}>Manage slots</Link>
                  <Link className="owner-secondary-button" href={`/dashboard/owner/courts/${court.id}/edit`}>Edit court</Link>
                  {venue?.status === "APPROVED" && court.is_active && venue.is_active ? <Link className="owner-court-preview" href={`/courts/${venue.id}`}>Preview venue</Link> : null}
                  {court.can_delete ? <button className="owner-court-danger" onClick={() => setPendingAction({ court, type: "delete" })} type="button">Delete</button> : court.is_active ? <button className="owner-court-warning-action" onClick={() => setPendingAction({ court, type: "deactivate" })} type="button">Deactivate</button> : null}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {pendingAction ? (
        <ConfirmActionModal
          actionLabel={pendingAction.type === "delete" ? "Delete Court" : "Deactivate Court"}
          body={
            pendingAction.type === "delete"
              ? "Deleting this court will remove its generated slots because there is no booking history. This action cannot be undone."
              : "This court has booking history, so it cannot be permanently deleted. Deactivating it will hide it from players and stop new bookings, while existing booking history remains saved."
          }
          confirmTone={pendingAction.type === "delete" ? "danger" : "warning"}
          isWorking={isWorking}
          onCancel={() => setPendingAction(null)}
          onConfirm={confirmCourtAction}
          title={pendingAction.type === "delete" ? `Delete ${pendingAction.court.name}?` : `Deactivate ${pendingAction.court.name}?`}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="owner-court-stat">
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function formatChoice(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
