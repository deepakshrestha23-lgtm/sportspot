"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { Venue, VenueStatus } from "@/types/venue";

const trackedStatuses: VenueStatus[] = ["PENDING", "APPROVED", "NEEDS_CHANGES", "REJECTED", "SUSPENDED"];

export default function AdminDashboardPage() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadVenues();
  }, []);

  async function loadVenues() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<{ venues: Venue[] }>("/api/venues/admin/venues/");
      setVenues(response.data.venues);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load admin dashboard."));
    } finally {
      setIsLoading(false);
    }
  }

  const counts = getVenueCounts(venues);
  const attentionCount = counts.PENDING + counts.NEEDS_CHANGES;

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-sportNavy p-6 text-white shadow-sm">
        <p className="text-sm font-black uppercase tracking-wide text-green-300">Admin Dashboard</p>
        <h1 className="mt-2 text-3xl font-black">SportSpot trust control</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Review Cricksal venues, keep fake listings out, and monitor venue verification health.
        </p>
      </section>


      {isLoading ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">Loading admin overview...</section>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {trackedStatuses.map((status) => (
              <Stat key={status} label={formatChoice(status)} value={counts[status]} tone={getStatusTone(status)} />
            ))}
          </section>

          <section className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-black uppercase tracking-wide text-sportGreen">Review Queue</p>
              <h2 className="mt-2 text-2xl font-black text-sportNavy">{attentionCount} venue submission{attentionCount === 1 ? "" : "s"} need attention</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Pending venues need first review. Needs Changes venues are owner revisions that may come back after edits.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link className="rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" href="/dashboard/admin/venues">
                  Open Venue Approvals
                </Link>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-black uppercase tracking-wide text-sportGreen">Admin Rules</p>
              <ul className="mt-4 space-y-3 text-sm font-semibold leading-6 text-slate-600">
                <li>Approve only when location, photos, and legal proof are believable.</li>
                <li>Request changes when evidence is incomplete but fixable.</li>
                <li>Reject fake or unsuitable submissions with a clear reason.</li>
                <li>Suspend approved venues that should no longer appear to players.</li>
              </ul>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, tone, value }: { label: string; tone: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-3 text-3xl font-black ${tone}`}>{value}</p>
    </div>
  );
}

function getVenueCounts(venues: Venue[]) {
  return trackedStatuses.reduce<Record<VenueStatus, number>>(
    (counts, status) => {
      counts[status] = venues.filter((venue) => venue.status === status).length;
      return counts;
    },
    {
      DRAFT: 0,
      PENDING: 0,
      NEEDS_CHANGES: 0,
      APPROVED: 0,
      REJECTED: 0,
      SUSPENDED: 0,
    },
  );
}

function getStatusTone(status: VenueStatus) {
  if (status === "PENDING" || status === "NEEDS_CHANGES") return "text-amber-600";
  if (status === "APPROVED") return "text-sportGreen";
  if (status === "REJECTED" || status === "SUSPENDED") return "text-red-600";
  return "text-sportNavy";
}

function formatChoice(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
