"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import ConfirmActionModal from "@/components/ConfirmActionModal";
import FeedbackToast from "@/components/FeedbackToast";
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

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <FeedbackToast message={feedbackMessage} onClose={() => { setMessage(""); setError(""); }} type={feedbackType} />

      <div className="flex flex-col gap-4 rounded-lg bg-sportNavy p-6 text-white shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-wide text-green-300">Court Management</p>
          <h1 className="mt-2 text-3xl font-black">Your Cricksal Courts</h1>
          <p className="mt-3 max-w-3xl text-slate-300">
            Courts are the physical play areas inside your venue. Players see active courts only after your venue is approved.
          </p>
        </div>
        <Link className="rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" href="/dashboard/owner/courts/create">
          Add Court
        </Link>
      </div>


      {!isLoading ? (
        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <InfoCard label="Venue Status" value={venue ? formatChoice(venue.status) : "No Venue"} />
          <InfoCard label="Player Visibility" value={venue?.status === "APPROVED" ? "Approved active courts appear on /courts" : "Hidden until admin approval"} />
          <InfoCard label="How Slots Work" value="Slots are the exact times players select and pay for." />
        </section>
      ) : null}

      {isLoading ? (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">Loading courts...</div>
      ) : courts.length === 0 ? (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-black text-sportNavy">No courts added yet</h2>
          <p className="mt-2 text-sm text-slate-600">Add your first Cricksal court to generate bookable slots.</p>
          <Link className="mt-5 inline-flex rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" href="/dashboard/owner/courts/create">
            Add Court
          </Link>
        </div>
      ) : (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {courts.map((court) => (
            <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" key={court.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black text-sportNavy">{court.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">{formatChoice(court.court_type)} · {formatChoice(court.surface_type)}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-black ${court.is_active ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"}`}>
                  {court.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              <p className="mt-3 line-clamp-3 text-sm text-slate-600">{court.description || "No description added."}</p>
              <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                {venue?.status === "APPROVED" && court.is_active
                  ? "Visible to players. Generate available slots so players can book it."
                  : "Not visible to players yet. Venue must be approved and court must be active."}
              </div>
              {!court.can_delete ? (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-900">
                  {court.delete_block_reason}
                </div>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-2">
                <Link className="inline-flex rounded-md border border-green-200 px-4 py-2 text-sm font-black text-sportGreen hover:bg-green-50" href={`/dashboard/owner/courts/${court.id}/slots`}>
                  Manage Slots
                </Link>
                {venue?.status === "APPROVED" && court.is_active ? (
                  <Link className="inline-flex rounded-md border border-slate-200 px-4 py-2 text-sm font-black text-sportNavy hover:bg-slate-50" href={`/courts/${venue.id}`}>
                    View Venue Page
                  </Link>
                ) : null}
                {court.can_delete ? (
                  <button className="rounded-md border border-red-200 px-4 py-2 text-sm font-black text-red-600 hover:bg-red-50" onClick={() => setPendingAction({ court, type: "delete" })} type="button">
                    Delete Court
                  </button>
                ) : court.is_active ? (
                  <button className="rounded-md border border-amber-200 px-4 py-2 text-sm font-black text-amber-700 hover:bg-amber-50" onClick={() => setPendingAction({ court, type: "deactivate" })} type="button">
                    Deactivate Court
                  </button>
                ) : null}
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
    </main>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-black text-sportNavy">{value}</p>
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
