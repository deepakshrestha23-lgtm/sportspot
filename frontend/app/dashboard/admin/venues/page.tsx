"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AdminPageHeader, AdminPanel, AdminPaginationControls, AdminStatusPill, formatAdminValue, formatDateTime, getAdminStatusTone } from "@/components/admin-dashboard/AdminUi";
import { AdminLoadingScreen } from "@/components/admin-dashboard/AdminDashboardLayout";
import FeedbackToast from "@/components/FeedbackToast";
import MediaImage from "@/components/MediaImage";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getMediaSrc } from "@/lib/media";
import type { AdminPagination } from "@/types/admin";
import type { Venue } from "@/types/venue";

const statuses = ["PENDING", "NEEDS_CHANGES", "APPROVED", "REJECTED", "SUSPENDED"] as const;
type ReviewAction = "APPROVE" | "NEEDS_CHANGES" | "REJECT" | "SUSPEND";

export default function AdminVenueApprovalsPage() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [statusFilter, setStatusFilter] = useState<(typeof statuses)[number]>("PENDING");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [pagination, setPagination] = useState<AdminPagination | null>(null);
  const [page, setPage] = useState(1);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadVenues = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ status: statusFilter, page: String(page), page_size: "25" });
      if (appliedSearch) params.set("q", appliedSearch);
      const response = await api.get<{ venues: Venue[]; pagination: AdminPagination }>(`/api/venues/admin/venues/?${params.toString()}`);
      setVenues(response.data.venues);
      setPagination(response.data.pagination);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load venue approvals."));
    } finally {
      setIsLoading(false);
    }
  }, [appliedSearch, page, statusFilter]);

  useEffect(() => { void loadVenues(); }, [loadVenues]);

  useEffect(() => {
    if (!isLoading && !error && page > 1 && !venues.length && (pagination?.total || 0) > 0) setPage((current) => Math.max(current - 1, 1));
  }, [error, isLoading, page, pagination?.total, venues.length]);

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
  }

  async function reviewVenue(venueId: number, action: ReviewAction) {
    setBusyId(venueId);
    setError("");
    setMessage("");
    try {
      await api.post(`/api/venues/admin/venues/${venueId}/review/`, { action, admin_review_note: notes[venueId] || "" });
      setMessage(action === "APPROVE" ? "Venue approved and can now appear publicly when its listing is active." : "Venue review saved and the owner has been notified.");
      await loadVenues();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not save the venue review."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <FeedbackToast message={error || message} onClose={() => { setError(""); setMessage(""); }} type={error ? "error" : "success"} />
      <AdminPageHeader
        actions={<Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-sportNavy transition hover:border-green-200 hover:text-sportGreen" href="/dashboard/admin">Back to overview</Link>}
        description="Verify the evidence behind every listing before it becomes discoverable to players. Existing bookings and owner data stay protected while you review."
        eyebrow="Trust & safety"
        title="Venue approvals"
      />

      <AdminPanel className="overflow-visible">
        <form className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5" onSubmit={applySearch}><label className="min-w-0"><span className="sr-only">Search venue submissions</span><input className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-sportNavy outline-none transition focus:border-sportGreen focus:ring-2 focus:ring-green-100" onChange={(event) => setSearch(event.target.value)} placeholder="Search venue, area, owner, or email" value={search} /></label><button className="min-h-11 rounded-lg bg-sportGreen px-4 text-sm font-black text-white transition hover:bg-green-700" type="submit">Search venues</button></form>
        <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div><p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Review queue</p><p className="mt-1 text-sm font-bold text-slate-700">{isLoading ? "Loading submissions..." : `${pagination?.total || venues.length} ${formatAdminValue(statusFilter).toLowerCase()} submission${(pagination?.total || venues.length) === 1 ? "" : "s"}`}</p></div>
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Venue status filter">{statuses.map((status) => <button aria-selected={statusFilter === status} className={`shrink-0 rounded-md px-3 py-2 text-xs font-black transition ${statusFilter === status ? "bg-white text-sportGreen shadow-sm" : "text-slate-500 hover:text-sportNavy"}`} key={status} onClick={() => { setPage(1); setStatusFilter(status); }} role="tab" type="button">{formatAdminValue(status)}</button>)}</div>
        </div>
      </AdminPanel>

      {isLoading ? <AdminLoadingScreen label="Loading venue submissions" /> : null}
      {!isLoading && error ? <AdminError onRetry={() => void loadVenues()} /> : null}
      {!isLoading && !error && !venues.length ? <AdminPanel><div className="admin-empty-state"><span className="admin-empty-icon" aria-hidden="true">✓</span><h2>Queue is clear</h2><p>No venues are currently in {formatAdminValue(statusFilter).toLowerCase()}.</p></div></AdminPanel> : null}

      {!isLoading && !error && venues.length ? <div className="space-y-5">{venues.map((venue) => <VenueReviewCard busy={busyId === venue.id} key={venue.id} note={notes[venue.id] || ""} onAction={(action) => void reviewVenue(venue.id, action)} onNoteChange={(note) => setNotes((current) => ({ ...current, [venue.id]: note }))} venue={venue} />)}<AdminPaginationControls hasMore={pagination?.has_more || false} isLoading={isLoading} onNext={() => setPage((current) => current + 1)} onPrevious={() => setPage((current) => Math.max(current - 1, 1))} page={page} pageSize={pagination?.page_size || 25} total={pagination?.total || 0} /></div> : null}
    </div>
  );
}

function VenueReviewCard({ venue, note, busy, onNoteChange, onAction }: { venue: Venue; note: string; busy: boolean; onNoteChange: (value: string) => void; onAction: (action: ReviewAction) => void }) {
  const requiresNote = ["NEEDS_CHANGES", "REJECTED", "SUSPENDED"].includes(venue.status);
  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="break-words text-xl font-black text-sportNavy">{venue.name || "Untitled venue"}</h2><AdminStatusPill value={venue.status} tone={getAdminStatusTone(venue.status)} /></div><p className="mt-2 text-sm font-semibold text-slate-600">{venue.address || "No address"} · {venue.area || "Area not added"}, {venue.city || "District not added"}</p><p className="mt-1 text-xs font-semibold text-slate-500">Owner: {venue.owner_name} · Submitted {venue.submitted_at ? formatDateTime(venue.submitted_at) : "date unavailable"}</p></div>
          <div className="flex shrink-0 flex-wrap gap-2 text-xs font-black text-slate-600"><span className="rounded-full bg-slate-100 px-3 py-1.5">{venue.courts?.length || 0} courts</span><span className="rounded-full bg-slate-100 px-3 py-1.5">{venue.location_confirmed ? "Location confirmed" : "Location pending"}</span></div>
        </div>
      </div>

      <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[1fr_21rem]">
        <div className="min-w-0 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><ReviewFact label="Contact" value={venue.contact_phone || "Not added"} /><ReviewFact label="Opening hours" value={`${venue.opening_time || "Not set"} - ${venue.closing_time || "Not set"}`} /><ReviewFact label="Document" value={venue.verification_document_type ? formatAdminValue(venue.verification_document_type) : "Not selected"} /><ReviewFact label="Bookable state" value={venue.is_active ? "Active listing" : "Inactive listing"} /></div>
          <div className="grid gap-4 md:grid-cols-2"><TextFact label="Description" value={venue.description || "No description added."} /><TextFact label="Venue rules" value={venue.rules || "No venue rules added."} /></div>
          <EvidenceSection venue={venue} />
        </div>

        <aside className="h-fit rounded-xl border border-slate-200 bg-slate-50 p-4 xl:sticky xl:top-24"><div><p className="text-xs font-black uppercase tracking-[0.12em] text-sportGreen">Decision</p><h3 className="mt-1 text-lg font-black text-sportNavy">Review this submission</h3><p className="mt-1 text-xs leading-5 text-slate-600">Approve only after checking location, photos, contact details, and legal evidence.</p></div><label className="mt-4 block"><span className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">Internal review note</span><textarea className="mt-2 min-h-28 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-sportNavy outline-none transition focus:border-sportGreen focus:ring-2 focus:ring-green-100" onChange={(event) => onNoteChange(event.target.value)} placeholder="Required for changes, rejection, or suspension" value={note} /></label><div className="mt-4 grid gap-2"><button className="min-h-11 rounded-lg bg-sportGreen px-4 text-sm font-black text-white transition hover:bg-green-700 disabled:cursor-wait disabled:opacity-60" disabled={busy} onClick={() => onAction("APPROVE")} type="button">{busy ? "Saving decision..." : "Approve venue"}</button><button className="min-h-11 rounded-lg border border-amber-200 bg-white px-4 text-sm font-black text-amber-800 transition hover:bg-amber-50 disabled:opacity-60" disabled={busy || !note.trim()} onClick={() => onAction("NEEDS_CHANGES")} type="button">Request changes</button><button className="min-h-11 rounded-lg border border-red-200 bg-white px-4 text-sm font-black text-red-700 transition hover:bg-red-50 disabled:opacity-60" disabled={busy || !note.trim()} onClick={() => onAction("REJECT")} type="button">Reject submission</button>{venue.status === "APPROVED" ? <button className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:opacity-60" disabled={busy || !note.trim()} onClick={() => onAction("SUSPEND")} type="button">Suspend listing</button> : null}</div>{requiresNote ? <p className="mt-3 text-xs font-semibold leading-5 text-amber-800">This status needs a clear note so the owner knows what to fix.</p> : null}</aside>
      </div>
    </article>
  );
}

function EvidenceSection({ venue }: { venue: Venue }) {
  const photos = [
    ...(venue.front_photo ? [{ label: "Front", source: venue.front_photo }] : []),
    ...(venue.court_area_photo ? [{ label: "Court area", source: venue.court_area_photo }] : []),
    ...(venue.additional_photo ? [{ label: "Additional", source: venue.additional_photo }] : []),
    ...(venue.photos || []).map((photo) => ({ label: formatAdminValue(photo.category), source: photo.image })),
  ];
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">Verification evidence</p><h3 className="mt-1 text-base font-black text-sportNavy">Photos and document</h3></div>{venue.map_location ? <a className="text-sm font-black text-sportGreen hover:text-green-700" href={venue.map_location} rel="noreferrer" target="_blank">Open map link -&gt;</a> : null}</div><div className="mt-4 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">{photos.length ? photos.map((photo, index) => <a className="group overflow-hidden rounded-lg border border-slate-200 bg-white" href={getMediaSrc(photo.source)} key={`${photo.source}-${index}`} rel="noreferrer" target="_blank"><MediaImage alt={`${photo.label} venue evidence`} className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.02]" fallback={<div className="flex aspect-[4/3] items-center justify-center p-3 text-center text-xs font-bold text-slate-500">Photo unavailable</div>} source={photo.source} /><span className="block truncate px-2 py-2 text-xs font-black text-slate-700">{photo.label}</span></a>) : <p className="col-span-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">No venue photos uploaded.</p>}</div><div className="mt-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-black text-sportNavy">Legal verification document</p><p className="mt-1 text-xs font-semibold text-slate-500">{venue.verification_document_type ? formatAdminValue(venue.verification_document_type) : "Type not selected"}</p></div>{venue.verification_document ? <a className="inline-flex min-h-10 items-center justify-center rounded-lg bg-sportNavy px-3 text-xs font-black text-white hover:bg-slate-800" href={getMediaSrc(venue.verification_document)} rel="noreferrer" target="_blank">Open document</a> : <span className="text-xs font-bold text-amber-700">Not uploaded</span>}</div></div>;
}

function ReviewFact({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-black leading-5 text-sportNavy">{value}</p></div>; }
function TextFact({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-slate-200 p-4"><p className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">{label}</p><p className="mt-2 whitespace-pre-line text-sm font-semibold leading-6 text-slate-700">{value}</p></div>; }
function AdminError({ onRetry }: { onRetry: () => void }) { return <AdminPanel><div className="px-5 py-10 text-center"><p className="text-sm font-black text-red-700">Venue queue unavailable</p><p className="mt-1 text-sm text-slate-600">The review data could not be loaded.</p><button className="mt-4 min-h-10 rounded-lg bg-sportGreen px-4 text-sm font-black text-white" onClick={onRetry} type="button">Try again</button></div></AdminPanel>; }
