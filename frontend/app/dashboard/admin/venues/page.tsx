"use client";

import { useEffect, useState } from "react";

import FeedbackToast from "@/components/FeedbackToast";
import MediaImage from "@/components/MediaImage";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateTimeInNepal, formatTimeValue } from "@/lib/dates";
import { getMediaSrc } from "@/lib/media";
import type { Venue } from "@/types/venue";

export default function AdminVenueApprovalsPage() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const feedbackMessage = error || message;
  const feedbackType = error ? "error" : message ? "success" : "info";

  useEffect(() => {
    loadVenues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function loadVenues() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<{ venues: Venue[] }>(`/api/venues/admin/venues/?status=${statusFilter}`);
      setVenues(response.data.venues);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load venue approvals."));
    } finally {
      setIsLoading(false);
    }
  }

  async function reviewVenue(venueId: number, action: "APPROVE" | "NEEDS_CHANGES" | "REJECT" | "SUSPEND") {
    setMessage("");
    setError("");
    try {
      await api.post(`/api/venues/admin/venues/${venueId}/review/`, {
        action,
        admin_review_note: notes[venueId] || "",
      });
      setMessage("Venue review saved.");
      loadVenues();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not save venue review."));
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <FeedbackToast message={feedbackMessage} onClose={() => { setMessage(""); setError(""); }} type={feedbackType} />

      <section className="rounded-lg bg-sportNavy p-6 text-white shadow-sm">
        <p className="text-sm font-black uppercase tracking-wide text-green-300">Admin Approval</p>
        <h1 className="mt-2 text-3xl font-black">Venue Approvals</h1>
        <p className="mt-3 text-slate-300">Review Cricksal venue proof before courts become visible to players.</p>
      </section>

      <div className="mt-6 flex flex-wrap gap-2">
        {["PENDING", "NEEDS_CHANGES", "APPROVED", "REJECTED", "SUSPENDED"].map((status) => (
          <button className={`rounded-full px-4 py-2 text-sm font-black ${statusFilter === status ? "bg-sportGreen text-white" : "bg-white text-slate-700"}`} key={status} onClick={() => setStatusFilter(status)} type="button">
            {formatChoice(status)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">Loading venues...</div>
      ) : venues.length === 0 ? (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-black text-sportNavy">No venues in this status</h2>
          <p className="mt-2 text-sm text-slate-600">Submitted venues will appear here when owners send them for review.</p>
        </div>
      ) : (
        <section className="mt-6 grid gap-5">
          {venues.map((venue) => (
            <article className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm" key={venue.id}>
              <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-2xl font-black text-sportNavy">{venue.name || "Untitled Venue"}</h2>
                    <Badge label={formatChoice(venue.status)} />
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{venue.description || "No description added."}</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Info label="Owner" value={venue.owner_name} />
                    <Info label="Contact" value={venue.contact_phone || "Not added"} />
                    <Info label="Address" value={`${venue.address}, ${venue.area}, ${venue.city}`} />
                    <Info label="Hours" value={`${toTime(venue.opening_time)} - ${toTime(venue.closing_time)}`} />
                    <Info label="Courts" value={`${venue.courts?.length || 0} court(s)`} />
                    <Info label="Document Type" value={venue.verification_document_type ? formatChoice(venue.verification_document_type) : "Not selected"} />
                    <Info label="Submitted" value={venue.submitted_at ? formatDateTimeInNepal(venue.submitted_at, { dateStyle: "medium", timeStyle: "short" }) : "Not submitted"} />
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <LongInfo label="Venue Rules" value={venue.rules || "Not added"} />
                    <LongInfo
                      label={`Cancellation Policy v${venue.cancellation_policy_details.version}`}
                      value={[
                        ...venue.cancellation_policy_details.summary,
                        venue.cancellation_policy_details.additional_notes,
                      ].filter(Boolean).join("\n")}
                    />
                  </div>
                  {venue.map_location ? (
                    <a className="mt-4 inline-flex text-sm font-black text-sportGreen hover:text-green-700" href={venue.map_location} rel="noreferrer" target="_blank">
                      Open Map Location
                    </a>
                  ) : null}
                  <ReviewEvidence venue={venue} />
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <Checklist label="Venue photos checked" />
                    <Checklist label="Location checked" />
                    <Checklist label="Document checked" />
                    <Checklist label="Phone/contact checked" />
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="text-sm font-black text-sportNavy">Review Note</p>
                  <textarea
                    className="mt-2 min-h-28 w-full rounded-md border border-slate-300 px-3 py-3 text-sm outline-none focus:border-sportGreen"
                    onChange={(event) => setNotes({ ...notes, [venue.id]: event.target.value })}
                    placeholder="Required for changes, rejection, or suspension"
                    value={notes[venue.id] || ""}
                  />
                  <div className="mt-3 grid gap-2">
                    <button className="rounded-md bg-sportGreen px-4 py-2 text-sm font-black text-white hover:bg-green-700" onClick={() => reviewVenue(venue.id, "APPROVE")} type="button">
                      Approve
                    </button>
                    <button className="rounded-md border border-amber-200 px-4 py-2 text-sm font-black text-amber-700 hover:bg-amber-50" onClick={() => reviewVenue(venue.id, "NEEDS_CHANGES")} type="button">
                      Request Changes
                    </button>
                    <button className="rounded-md border border-red-200 px-4 py-2 text-sm font-black text-red-600 hover:bg-red-50" onClick={() => reviewVenue(venue.id, "REJECT")} type="button">
                      Reject
                    </button>
                    {venue.status === "APPROVED" ? (
                      <button className="rounded-md border border-slate-300 px-4 py-2 text-sm font-black text-slate-700 hover:bg-white" onClick={() => reviewVenue(venue.id, "SUSPEND")} type="button">
                        Suspend
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-black text-sportNavy">{value}</p>
    </div>
  );
}

function LongInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 whitespace-pre-line text-sm font-semibold leading-6 text-sportNavy">{value}</p>
    </div>
  );
}

function Checklist({ label }: { label: string }) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-slate-200 p-3 text-sm font-semibold text-slate-700">
      <input type="checkbox" />
      {label}
    </label>
  );
}

function Badge({ label }: { label: string }) {
  return <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-black text-green-800">{label}</span>;
}

function ReviewEvidence({ venue }: { venue: Venue }) {
  return (
    <div className="mt-5 space-y-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div>
        <h3 className="text-lg font-black text-sportNavy">Verification Evidence</h3>
        <p className="mt-1 text-sm text-slate-600">Open photos and documents before approving this venue.</p>
      </div>

      <VenuePhotoStrip venue={venue} />

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="font-black text-sportNavy">Legal Verification Document</h4>
            <p className="mt-1 text-sm text-slate-600">
              {venue.verification_document_type ? formatChoice(venue.verification_document_type) : "No document type selected"}
            </p>
          </div>
          {venue.verification_document ? (
            <a className="rounded-md bg-sportGreen px-4 py-2 text-sm font-black text-white hover:bg-green-700" href={getMediaSrc(venue.verification_document)} rel="noreferrer" target="_blank">
              Open Document
            </a>
          ) : null}
        </div>
        {venue.verification_document ? (
          isImageFile(venue.verification_document) ? (
            <a href={getMediaSrc(venue.verification_document)} rel="noreferrer" target="_blank">
              <MediaImage alt="Verification document" className="mt-4 max-h-80 w-full rounded-md border border-slate-200 object-contain" fallback={<div className="mt-4 flex h-32 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-sm font-semibold text-amber-800">Document preview unavailable</div>} source={venue.verification_document} />
            </a>
          ) : (
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-black text-sportNavy">Document uploaded</p>
              <p className="mt-1 text-sm text-slate-600">PDF or document preview is opened in a new tab.</p>
            </div>
          )
        ) : (
          <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm font-semibold text-amber-800">No legal verification document uploaded.</p>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h4 className="font-black text-sportNavy">Court Evidence</h4>
        <p className="mt-1 text-sm text-slate-600">Review every court added under this venue.</p>
        {venue.courts?.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {venue.courts.map((court) => (
              <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50" key={court.id}>
                {court.court_photo ? (
                  <a href={getMediaSrc(court.court_photo)} rel="noreferrer" target="_blank">
                    <MediaImage alt={court.name} className="aspect-[4/3] w-full object-cover" fallback={<div className="flex aspect-[4/3] items-center justify-center bg-slate-100 text-sm font-semibold text-slate-500">Photo unavailable</div>} source={court.court_photo} />
                  </a>
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center bg-slate-100 text-sm font-semibold text-slate-500">
                    No court photo
                  </div>
                )}
                <div className="p-3">
                  <h5 className="font-black text-sportNavy">{court.name}</h5>
                  <p className="mt-1 text-sm text-slate-600">{formatChoice(court.court_type)} · {formatChoice(court.surface_type)}</p>
                  {court.court_photo ? (
                    <a className="mt-3 inline-flex text-sm font-black text-sportGreen hover:text-green-700" href={getMediaSrc(court.court_photo)} rel="noreferrer" target="_blank">
                      Open Full Photo
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm font-semibold text-amber-800">No courts added.</p>
        )}
      </div>
    </div>
  );
}

function VenuePhotoStrip({ venue }: { venue: Venue }) {
  const photos = [
    ...(venue.front_photo ? [{ id: "front", image: venue.front_photo, label: "Outside / Front" }] : []),
    ...(venue.court_area_photo ? [{ id: "court", image: venue.court_area_photo, label: "Court Area" }] : []),
    ...(venue.additional_photo ? [{ id: "additional", image: venue.additional_photo, label: "Additional" }] : []),
    ...(venue.photos || []).map((photo) => ({ id: String(photo.id), image: photo.image, label: formatChoice(photo.category) })),
  ];

  if (photos.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h4 className="font-black text-sportNavy">Venue Photos</h4>
        <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm font-semibold text-amber-800">No venue photos uploaded yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="font-black text-sportNavy">Venue Photos</h4>
          <p className="mt-1 text-sm text-slate-600">{photos.length} uploaded photo{photos.length === 1 ? "" : "s"}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {photos.map((photo) => (
          <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50" key={photo.id}>
            <a href={getMediaSrc(photo.image)} rel="noreferrer" target="_blank">
              <MediaImage alt={photo.label} className="aspect-[4/3] w-full object-cover" fallback={<div className="flex aspect-[4/3] items-center justify-center bg-slate-100 text-sm font-semibold text-slate-500">Photo unavailable</div>} source={photo.image} />
            </a>
            <div className="flex items-center justify-between gap-2 p-2">
              <p className="text-xs font-black text-slate-600">{photo.label}</p>
              <a className="text-xs font-black text-sportGreen hover:text-green-700" href={getMediaSrc(photo.image)} rel="noreferrer" target="_blank">
                Open
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function isImageFile(path: string) {
  return /\.(jpg|jpeg|png)$/i.test(path.split("?")[0]);
}

const toTime = formatTimeValue;

function formatChoice(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
