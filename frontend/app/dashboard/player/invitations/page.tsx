"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import FeedbackToast from "@/components/FeedbackToast";
import { DashboardPageHeader } from "@/components/player-dashboard/DashboardPageHeader";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateTimeInNepal } from "@/lib/dates";
import type { TeamInvitation, TeamInvitationsResponse } from "@/types/team";

export default function PlayerInvitationsPage() {
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionId, setActionId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const feedbackMessage = error || success;
  const feedbackType = error ? "error" : success ? "success" : "info";

  useEffect(() => {
    loadInvitations();
  }, []);

  async function loadInvitations() {
    setIsLoading(true);
    setError("");

    try {
      const response = await api.get<TeamInvitationsResponse>("/api/teams/invitations/");
      setInvitations(response.data.invitations);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load team invitations."));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDecision(invitationId: number, decision: "accept" | "reject") {
    setActionId(invitationId);
    setError("");
    setSuccess("");

    try {
      await api.post(`/api/teams/invitations/${invitationId}/${decision}/`);
      setSuccess(decision === "accept" ? "Invitation accepted. Team added to My Teams." : "Invitation rejected.");
      await loadInvitations();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, `Could not ${decision} invitation.`));
    } finally {
      setActionId(null);
    }
  }

  return (
    <div className="space-y-6">
      <FeedbackToast message={feedbackMessage} onClose={() => { setError(""); setSuccess(""); }} type={feedbackType} />

      <DashboardPageHeader description="Review team invitations from captains and decide whether to join their Cricksal roster." eyebrow="Team recruitment" title="My Invitations" />

      {isLoading ? (
        <div className="sport-surface p-6">
          <p className="text-slate-500">Loading invitations...</p>
        </div>
      ) : invitations.length === 0 ? (
        <section className="rounded-lg border border-dashed border-green-300 bg-green-50 p-8 text-center">
          <h2 className="text-2xl font-black text-sportNavy">No pending invitations.</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-slate-600">
            When a captain invites you by SportSpot ID, the request will appear here.
          </p>
          <Link className="mt-6 inline-flex rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" href="/dashboard/player/teams">
            View My Teams
          </Link>
        </section>
      ) : (
        <section className="grid gap-5">
          {invitations.map((invitation) => (
            <article className="sport-surface overflow-hidden" key={invitation.id}>
              <div className="bg-sportNavy p-5 text-white">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex gap-4">
                    <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/10 text-xl font-black text-white">
                      {invitation.team_photo ? (
                        <Image alt={`${invitation.team_name} team photo`} className="object-cover" fill sizes="80px" src={getMediaSrc(invitation.team_photo)} unoptimized />
                      ) : (
                        getInitials(invitation.team_name)
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-black uppercase tracking-wide text-green-300">Cricksal Team Invite</p>
                      <h2 className="mt-1 text-2xl font-black">{invitation.team_name}</h2>
                      <p className="mt-2 text-sm text-slate-300">Captain: {invitation.captain_name}</p>
                    </div>
                  </div>
                  <div className="rounded-md bg-white/10 px-4 py-3">
                    <p className="text-xs font-black uppercase tracking-wide text-green-300">Invited Role</p>
                    <p className="mt-1 font-black">{formatChoice(invitation.cricksal_role)}</p>
                  </div>
                </div>
                <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300">
                  {invitation.team_description || "This captain has not added a team description yet."}
                </p>
              </div>

              <div className="p-5">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Info label="Location" value={invitation.team_location} />
                  <Info label="Preferred Area" value={invitation.team_preferred_playing_area} />
                  <Info label="Preferred Time" value={invitation.team_preferred_playing_time} />
                  <Info label="Team Skill" value={formatChoice(invitation.team_skill_level)} />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <Info label="Members" value={String(invitation.team_members_count)} />
                  <Info label="Reliability" value={`${invitation.team_reliability_score}/100`} />
                  <Info label="Average Rating" value={formatRating(invitation.team_average_rating)} />
                  <Info label="Matches Played" value={String(invitation.team_matches_played_count)} />
                  <Info label="Team Since" value={formatDate(invitation.team_created_at)} />
                </div>

                <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-4">
                  <p className="text-sm font-black text-sportNavy">Why this invitation matters</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    You are being invited to join as <span className="font-black text-sportGreen">{formatChoice(invitation.cricksal_role)}</span>. Review the team location, timing, skill level, and trust summary before accepting.
                  </p>
                  <p className="mt-2 text-xs font-semibold text-slate-500">Invited on {formatDate(invitation.invited_at)}</p>
                </div>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <button className="sport-primary-button" disabled={actionId === invitation.id} onClick={() => handleDecision(invitation.id, "accept")} type="button">
                    {actionId === invitation.id ? "Working..." : "Accept Invitation"}
                  </button>
                  <button className="sport-secondary-button border-red-200 text-red-700 hover:bg-red-50" disabled={actionId === invitation.id} onClick={() => handleDecision(invitation.id, "reject")} type="button">
                    Reject
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
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

function formatChoice(value?: string) {
  if (!value) return "Not set";
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value?: string) {
  if (!value) return "Not set";
  return formatDateTimeInNepal(value, { month: "short", day: "numeric", year: "numeric" });
}

function formatRating(value?: string) {
  if (!value) return "Not rated yet";
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue.toFixed(1) : "Not rated yet";
}

function getMediaSrc(value: string) {
  if (!value) return "";
  if (value.startsWith("http")) return value;
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
  return `${apiBaseUrl}${value}`;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}
