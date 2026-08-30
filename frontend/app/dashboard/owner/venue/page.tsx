"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import ConfirmActionModal from "@/components/ConfirmActionModal";
import FeedbackToast from "@/components/FeedbackToast";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import VenueMap from "@/components/venue/VenueMap";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { buildVenueDirectionsHref } from "@/lib/maps";
import { formatTimeValue } from "@/lib/dates";
import type { Court, Venue, VenuePhoto, VenuePhotoCategory } from "@/types/venue";

type VenueAction = "delete" | "deactivate";

export default function OwnerVenuePage() {
  const [venue, setVenue] = useState<Venue | null>(null);
  const [courts, setCourts] = useState<Court[]>([]);
  const [venuePhotos, setVenuePhotos] = useState<VenuePhoto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [pendingAction, setPendingAction] = useState<VenueAction | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const feedbackMessage = error || message;
  const feedbackType = error ? "error" : message ? "success" : "info";

  useEffect(() => {
    loadVenue();
  }, []);

  async function loadVenue() {
    setIsLoading(true);
    setError("");
    try {
      const [venueResponse, courtsResponse] = await Promise.all([
        api.get<{ venue: Venue | null }>("/api/venues/owner/venue/"),
        api.get<{ courts: Court[] }>("/api/venues/owner/courts/").catch(() => ({ data: { courts: [] } })),
      ]);
      setVenue(venueResponse.data.venue);
      setCourts(courtsResponse.data.courts);
      if (venueResponse.data.venue) {
        const photosResponse = await api.get<{ photos: VenuePhoto[] }>("/api/venues/owner/venue/photos/");
        setVenuePhotos(photosResponse.data.photos);
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load venue profile."));
    } finally {
      setIsLoading(false);
    }
  }

  async function confirmVenueAction() {
    if (!pendingAction) return;
    setIsWorking(true);
    setMessage("");
    setError("");
    try {
      if (pendingAction === "delete") {
        await api.delete("/api/venues/owner/venue/");
        setVenue(null);
        setCourts([]);
        setVenuePhotos([]);
        setMessage("Venue deleted successfully.");
      } else {
        const response = await api.post<{ venue: Venue }>("/api/venues/owner/venue/deactivate/");
        setVenue(response.data.venue);
        setMessage("Venue deactivated. It is hidden from players, but courts, bookings, payments, and history remain saved.");
      }
      setPendingAction(null);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, pendingAction === "delete" ? "Could not delete venue." : "Could not deactivate venue."));
    } finally {
      setIsWorking(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <FeedbackToast message={feedbackMessage} onClose={() => { setMessage(""); setError(""); }} type={feedbackType} />
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">Loading venue profile...</div>
      </div>
    );
  }

  if (!venue) {
    return (
      <div className="space-y-6">
        <FeedbackToast message={feedbackMessage} onClose={() => { setMessage(""); setError(""); }} type={feedbackType} />
        <section className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-black text-sportNavy">No venue registered yet</h1>
          <p className="mt-2 text-sm text-slate-600">Create your venue profile first. Courts and slots belong under that venue.</p>
          <Link className="mt-5 inline-flex rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" href="/dashboard/owner/venue-setup">
            Complete Venue Setup
          </Link>
        </section>
      </div>
    );
  }

  const visibleCourts = courts.filter((court) => court.is_active);
  const canPlayersSeeVenue = venue.status === "APPROVED" && venue.is_active;
  const directionsHref = buildVenueDirectionsHref(venue.latitude, venue.longitude, venue.map_location);

  return (
    <div className="owner-venue-page space-y-6">
      <FeedbackToast message={feedbackMessage} onClose={() => { setMessage(""); setError(""); }} type={feedbackType} />

      <OwnerPageHeader
        actions={
          <>
            {canPlayersSeeVenue ? <Link className="owner-secondary-button" href={`/courts/${venue.id}`}>Preview venue</Link> : null}
            <Link className="owner-primary-button" href="/dashboard/owner/venue-setup">Edit venue</Link>
          </>
        }
        description="Keep the public venue profile accurate, publish trustworthy photos, and manage the courts players can book."
        eyebrow="Venue Manager"
        title={venue.name || "Venue profile"}
      />

      <section className="owner-venue-status-row" aria-label="Venue status">
        <div className="owner-venue-status-context">
          <StatusBadge status={venue.status} />
          {!venue.is_active ? <span className="owner-status owner-status-danger">Deactivated</span> : null}
          <span className="owner-venue-status-copy">{canPlayersSeeVenue ? "Visible to players" : "Not visible to players yet"}</span>
        </div>
        <div className="owner-venue-status-actions">
          <span>{visibleCourts.length} active court{visibleCourts.length === 1 ? "" : "s"}</span>
          <span>{venue.bookings_count} booking record{venue.bookings_count === 1 ? "" : "s"}</span>
          {venue.can_delete ? (
            <button className="owner-text-danger" onClick={() => setPendingAction("delete")} type="button">Delete venue</button>
          ) : venue.is_active ? (
            <button className="owner-text-warning" onClick={() => setPendingAction("deactivate")} type="button">Deactivate venue</button>
          ) : null}
        </div>
      </section>

      <section className="owner-venue-grid">
        <div className="owner-venue-main-column">
          <section className="owner-venue-section">
            <div className="owner-venue-section-header">
              <div>
                <p className="owner-section-kicker">Profile</p>
                <h2>Venue information</h2>
                <p>Players see these details after admin approval.</p>
              </div>
              <Link className="owner-secondary-button" href="/dashboard/owner/venue-setup">Edit details</Link>
            </div>
            <div className="owner-venue-info-grid">
              <Info label="Address" value={`${venue.address || "Not added"}, ${venue.area || "Area"}, ${venue.city || "District"}`} />
              <Info label="Contact" value={venue.contact_phone || "Not added"} />
              <Info label="Opening hours" value={`${toTime(venue.opening_time)} - ${toTime(venue.closing_time)}`} />
              <Info label="Sport" value="Cricksal" />
              <Info label="Player visibility" value={canPlayersSeeVenue ? "Visible on Courts" : "Hidden until approved"} />
              <Info label="Verification" value={venue.verification_document_type ? formatChoice(venue.verification_document_type) : "Not selected"} />
            </div>
            {!venue.can_delete ? <p className="owner-venue-notice">{venue.delete_block_reason}</p> : null}
            {venue.description ? <p className="owner-venue-copy-block">{venue.description}</p> : null}
            {venue.rules ? (
              <div className="owner-venue-copy-block">
                <p className="owner-section-kicker">Venue rules</p>
                <p className="mt-2 whitespace-pre-line">{venue.rules}</p>
              </div>
            ) : null}
          </section>

          <section className="owner-venue-section">
            <div className="owner-venue-section-header">
              <div>
                <p className="owner-section-kicker">Trust & presentation</p>
                <h2>Venue photos and proof</h2>
                <p>Keep the entrance and playable area current so players know what they are booking.</p>
              </div>
              <Link className="owner-secondary-button" href="/dashboard/owner/venue-setup?step=4">Manage photos</Link>
            </div>
            <div className="owner-venue-photo-list">
              <PhotoGallery label="Outside / Front Photos" category="OUTSIDE" legacyPhotoUrl={venue.front_photo} photos={venuePhotos} />
              <PhotoGallery label="Court / Play Area Photos" category="COURT_AREA" legacyPhotoUrl={venue.court_area_photo} photos={venuePhotos} />
              <PhotoGallery label="Additional Photos" category="ADDITIONAL" legacyPhotoUrl={venue.additional_photo} photos={venuePhotos} />
            </div>
            <div className="owner-venue-proof-row"><ProofCard label="Legal document" value={venue.verification_document} /></div>
          </section>

          <section className="owner-venue-section">
            <div className="owner-venue-section-header">
              <div>
                <p className="owner-section-kicker">Policy</p>
                <h2>Cancellation policy</h2>
                <p>Future bookings use the current version. Existing bookings keep their accepted terms.</p>
              </div>
              <span className="owner-status owner-status-neutral">Version {venue.cancellation_policy_details.version}</span>
            </div>
            <ul className="owner-venue-policy-list">
              {venue.cancellation_policy_details.summary.map((rule) => <li key={rule}>{rule}</li>)}
            </ul>
            {venue.cancellation_policy_details.additional_notes ? <p className="owner-venue-copy-block">{venue.cancellation_policy_details.additional_notes}</p> : null}
          </section>
        </div>

        <aside className="owner-venue-side-column">
          <section className="owner-venue-section owner-venue-readiness">
            <div className="owner-venue-section-header">
              <div>
                <p className="owner-section-kicker">Publishing checklist</p>
                <h2>Booking readiness</h2>
              </div>
            </div>
            <div className="owner-venue-checklist">
              <ReadinessItem label="Admin approval" done={venue.status === "APPROVED"} />
              <ReadinessItem label="At least one active court" done={visibleCourts.length > 0} />
              <ReadinessItem label="Future availability published" done={courts.some((court) => court.lowest_price)} />
              <ReadinessItem label="Required venue photos" done={Boolean(venue.front_photo || venuePhotos.some((photo) => photo.category === "OUTSIDE")) && Boolean(venue.court_area_photo || venuePhotos.some((photo) => photo.category === "COURT_AREA"))} />
            </div>
          </section>

          <section className="owner-venue-section">
            <div className="owner-venue-section-header">
              <div>
                <p className="owner-section-kicker">Player directions</p>
                <h2>Venue location</h2>
                <p>Review the confirmed map pin used for directions.</p>
              </div>
              {directionsHref ? <a className="owner-secondary-button" href={directionsHref} rel="noreferrer" target="_blank">Directions</a> : null}
            </div>
            <div className="owner-venue-map"><VenueMap latitude={venue.latitude} longitude={venue.longitude} mapLocation={venue.map_location} /></div>
          </section>

          <section className="owner-venue-section">
            <div className="owner-venue-section-header">
              <div>
                <p className="owner-section-kicker">Inventory</p>
                <h2>Courts at this venue</h2>
                <p>{courts.length} registered court{courts.length === 1 ? "" : "s"}.</p>
              </div>
              <Link className="owner-secondary-button" href="/dashboard/owner/courts">Manage</Link>
            </div>
            <div className="owner-venue-court-list">
              {courts.length === 0 ? <p className="owner-venue-empty">No courts added yet.</p> : courts.map((court) => (
                <div className="owner-venue-court-row" key={court.id}>
                  <div className="min-w-0"><h3>{court.name}</h3><p>{formatChoice(court.court_type)} · {formatChoice(court.surface_type)}</p></div>
                  <Link href={`/dashboard/owner/courts/${court.id}/slots`}>Slots</Link>
                </div>
              ))}
            </div>
            <Link className="owner-primary-button owner-venue-full-button" href="/dashboard/owner/courts">Manage courts</Link>
          </section>
        </aside>
      </section>

      {pendingAction ? (
        <ConfirmActionModal
          actionLabel={pendingAction === "delete" ? "Delete Venue" : "Deactivate Venue"}
          body={
            pendingAction === "delete"
              ? "Deleting this venue will remove its courts and generated slots because there is no booking history. This action cannot be undone."
              : "Deactivating this venue will hide it from players, but existing courts, bookings, payments, and booking pass history will remain saved."
          }
          confirmTone={pendingAction === "delete" ? "danger" : "warning"}
          isWorking={isWorking}
          onCancel={() => setPendingAction(null)}
          onConfirm={confirmVenueAction}
          title={pendingAction === "delete" ? `Delete ${venue.name || "this venue"}?` : `Deactivate ${venue.name || "this venue"}?`}
        />
      ) : null}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="owner-venue-info-item">
      <p className="owner-section-kicker">{label}</p>
      <p className="mt-2 font-black text-sportNavy">{value}</p>
    </div>
  );
}

function PhotoGallery({
  label,
  category,
  legacyPhotoUrl,
  photos,
}: {
  label: string;
  category: VenuePhotoCategory;
  legacyPhotoUrl: string;
  photos: VenuePhoto[];
}) {
  const categoryPhotos = photos.filter((photo) => photo.category === category);
  const count = categoryPhotos.length + (legacyPhotoUrl ? 1 : 0);

  return (
    <div className="owner-venue-photo-gallery">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-black text-sportNavy">{label}</h3>
          <p className="mt-1 text-sm text-slate-600">{count > 0 ? `${count} photo${count === 1 ? "" : "s"} uploaded` : "No photos uploaded yet"}</p>
        </div>
        <Link className="owner-secondary-button" href="/dashboard/owner/venue-setup?step=4">
          Edit photos
        </Link>
      </div>
      {count > 0 ? (
        <div className="owner-venue-photo-strip">
          {legacyPhotoUrl ? <img alt={label} className="owner-venue-photo-thumb" src={getMediaUrl(legacyPhotoUrl)} /> : null}
          {categoryPhotos.map((photo) => (
            <img alt={label} className="owner-venue-photo-thumb" key={photo.id} src={getMediaUrl(photo.image)} />
          ))}
        </div>
      ) : <p className="owner-venue-empty">Add a clear photo to complete this category.</p>}
    </div>
  );
}

function ProofCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50">
      <div className="p-4">
        <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
        <p className={`mt-3 text-sm font-black ${value ? "text-green-700" : "text-slate-500"}`}>{value ? "Uploaded" : "Missing"}</p>
      </div>
    </div>
  );
}

function ReadinessItem({ label, done }: { label: string; done: boolean }) {
  return (
    <div className={`owner-venue-checklist-item ${done ? "is-done" : ""}`}>
      <span aria-hidden="true">{done ? "✓" : ""}</span>
      <p>{label}</p>
      <strong>{done ? "Ready" : "Action needed"}</strong>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "APPROVED" ? "bg-green-100 text-green-800" : status === "PENDING" ? "bg-blue-100 text-blue-800" : status === "REJECTED" || status === "SUSPENDED" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800";
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${tone}`}>{formatChoice(status)}</span>;
}

const toTime = formatTimeValue;

function formatChoice(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getMediaUrl(path: string) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
  return `${baseUrl}${path}`;
}
