"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import ConfirmActionModal from "@/components/ConfirmActionModal";
import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
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
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <FeedbackToast message={feedbackMessage} onClose={() => { setMessage(""); setError(""); }} type={feedbackType} />
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">Loading venue profile...</div>
      </main>
    );
  }

  if (!venue) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <FeedbackToast message={feedbackMessage} onClose={() => { setMessage(""); setError(""); }} type={feedbackType} />
        <section className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-black text-sportNavy">No venue registered yet</h1>
          <p className="mt-2 text-sm text-slate-600">Create your venue profile first. Courts and slots belong under that venue.</p>
          <Link className="mt-5 inline-flex rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" href="/dashboard/owner/venue-setup">
            Complete Venue Setup
          </Link>
        </section>
      </main>
    );
  }

  const visibleCourts = courts.filter((court) => court.is_active);
  const canPlayersSeeVenue = venue.status === "APPROVED" && venue.is_active;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <FeedbackToast message={feedbackMessage} onClose={() => { setMessage(""); setError(""); }} type={feedbackType} />

      <section className="rounded-lg bg-sportNavy p-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-wide text-green-300">Manage Venue</p>
            <h1 className="mt-2 text-3xl font-black">{venue.name || "Untitled Venue"}</h1>
            <p className="mt-3 max-w-3xl text-slate-300">
              This is your venue profile. Edit venue details, update photos/proof, manage physical courts, and understand what players can see.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <StatusBadge status={venue.status} />
              {!venue.is_active ? <span className="inline-flex rounded-full bg-red-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-red-800">Deactivated</span> : null}
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              {venue.can_delete ? (
                <button className="rounded-md border border-red-300 px-4 py-2 text-sm font-black text-red-100 hover:bg-red-900/30" onClick={() => setPendingAction("delete")} type="button">
                  Delete Venue
                </button>
              ) : venue.is_active ? (
                <button className="rounded-md border border-amber-300 px-4 py-2 text-sm font-black text-amber-100 hover:bg-amber-900/30" onClick={() => setPendingAction("deactivate")} type="button">
                  Deactivate Venue
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>


      <section className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-black text-sportNavy">Venue Information</h2>
                <p className="mt-1 text-sm text-slate-600">Players see this information after admin approval.</p>
              </div>
              <Link className="rounded-md border border-green-200 px-4 py-2 text-sm font-black text-sportGreen hover:bg-green-50" href="/dashboard/owner/venue-setup">
                Edit Venue
              </Link>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Info label="Address" value={`${venue.address || "Not added"}, ${venue.area || "Area"}, ${venue.city || "City"}`} />
              <Info label="Contact" value={venue.contact_phone || "Not added"} />
              <Info label="Hours" value={`${toTime(venue.opening_time)} - ${toTime(venue.closing_time)}`} />
              <Info label="Sport" value="Cricksal" />
              <Info label="Document Type" value={venue.verification_document_type ? formatChoice(venue.verification_document_type) : "Not selected"} />
              <Info label="Player Visibility" value={canPlayersSeeVenue ? "Visible on Courts page" : "Hidden from players"} />
              <Info label="Booking History" value={`${venue.bookings_count} booking record${venue.bookings_count === 1 ? "" : "s"}`} />
            </div>
            {!venue.can_delete ? (
              <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900">
                {venue.delete_block_reason}
              </div>
            ) : null}
            {venue.description ? <p className="mt-5 rounded-md bg-slate-50 p-4 text-sm leading-6 text-slate-600">{venue.description}</p> : null}
            {venue.rules ? (
              <div className="mt-3 rounded-md bg-slate-50 p-4">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">Venue Rules</p>
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{venue.rules}</p>
              </div>
            ) : null}
            <div className="mt-3 rounded-md bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">Cancellation Policy</p>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-slate-500">
                  Version {venue.cancellation_policy_details.version}
                </span>
              </div>
              <ul className="mt-3 space-y-2">
                {venue.cancellation_policy_details.summary.map((rule) => (
                  <li className="flex gap-2 text-sm font-semibold leading-6 text-slate-700" key={rule}>
                    <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-sportGreen" />
                    {rule}
                  </li>
                ))}
              </ul>
              {venue.cancellation_policy_details.additional_notes ? (
                <p className="mt-3 border-t border-slate-200 pt-3 text-sm leading-6 text-slate-600">
                  {venue.cancellation_policy_details.additional_notes}
                </p>
              ) : null}
              <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">
                Policy edits apply to future bookings. Existing bookings keep the policy accepted when they were reserved.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black text-sportNavy">Venue Photos and Proof</h2>
            <p className="mt-1 text-sm text-slate-600">Use the setup page to replace or add photos and legal verification proof.</p>
            <div className="mt-5 space-y-5">
              <PhotoGallery label="Outside / Front Photos" category="OUTSIDE" legacyPhotoUrl={venue.front_photo} photos={venuePhotos} />
              <PhotoGallery label="Court / Play Area Photos" category="COURT_AREA" legacyPhotoUrl={venue.court_area_photo} photos={venuePhotos} />
              <PhotoGallery label="Additional Photos" category="ADDITIONAL" legacyPhotoUrl={venue.additional_photo} photos={venuePhotos} />
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <ProofCard label="Legal Document" value={venue.verification_document} />
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black text-sportNavy">How Player Booking Works</h2>
            <div className="mt-4 space-y-3">
              <FlowStep number="1" text="Admin approves your venue." done={venue.status === "APPROVED"} />
              <FlowStep number="2" text="Active courts appear on /courts." done={visibleCourts.length > 0 && canPlayersSeeVenue} />
              <FlowStep number="3" text="Available slots appear on each court detail page." done={courts.some((court) => court.lowest_price)} />
              <FlowStep number="4" text="Player reserves a slot, completes payment, and the slot becomes booked." />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black text-sportNavy">Courts Under This Venue</h2>
            <p className="mt-1 text-sm text-slate-600">{courts.length} court(s) registered. Active approved courts are shown to players.</p>
            <div className="mt-4 space-y-3">
              {courts.length === 0 ? (
                <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">No courts added yet.</p>
              ) : (
                courts.map((court) => (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-4" key={court.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-black text-sportNavy">{court.name}</h3>
                        <p className="mt-1 text-sm text-slate-600">{formatChoice(court.court_type)} · {formatChoice(court.surface_type)}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${court.is_active ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"}`}>
                        {court.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link className="text-sm font-black text-sportGreen hover:text-green-700" href={`/dashboard/owner/courts/${court.id}/slots`}>
                        Manage Slots
                      </Link>
                      {canPlayersSeeVenue && court.is_active ? (
                        <Link className="text-sm font-black text-slate-600 hover:text-sportGreen" href={`/courts/${venue.id}`}>
                          View Venue Page
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
            <Link className="mt-5 inline-flex rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" href="/dashboard/owner/courts">
              Manage Courts
            </Link>
          </div>
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
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-4">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
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
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-black text-sportNavy">{label}</h3>
          <p className="mt-1 text-sm text-slate-600">{count > 0 ? `${count} photo${count === 1 ? "" : "s"} uploaded` : "No photos uploaded yet"}</p>
        </div>
        <Link className="inline-flex rounded-md border border-green-200 px-4 py-2 text-sm font-black text-sportGreen hover:bg-green-50" href="/dashboard/owner/venue-setup">
          Edit Photos
        </Link>
      </div>
      {count > 0 ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {legacyPhotoUrl ? <img alt={label} className="aspect-[4/3] rounded-md object-cover" src={getMediaUrl(legacyPhotoUrl)} /> : null}
          {categoryPhotos.map((photo) => (
            <img alt={label} className="aspect-[4/3] rounded-md object-cover" key={photo.id} src={getMediaUrl(photo.image)} />
          ))}
        </div>
      ) : null}
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

function FlowStep({ number, text, done = false }: { number: string; text: string; done?: boolean }) {
  return (
    <div className="flex gap-3 rounded-md bg-slate-50 p-3">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${done ? "bg-sportGreen text-white" : "bg-slate-200 text-slate-600"}`}>{number}</span>
      <p className="text-sm font-semibold text-slate-700">{text}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "APPROVED" ? "bg-green-100 text-green-800" : status === "PENDING" ? "bg-blue-100 text-blue-800" : status === "REJECTED" || status === "SUSPENDED" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800";
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${tone}`}>{formatChoice(status)}</span>;
}

function toTime(value: string | null) {
  return value ? value.slice(0, 5) : "Not set";
}

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
