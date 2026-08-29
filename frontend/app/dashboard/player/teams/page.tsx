"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DashboardPageHeader } from "@/components/player-dashboard/DashboardPageHeader";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { emitToast } from "@/lib/toast";
import { formatDateTimeInNepal } from "@/lib/dates";
import type { MyTeamsResponse, Team, TeamInvitation, TeamInvitationsResponse } from "@/types/team";

type Tab = "teams" | "invitations";
type RoleFilter = "ALL" | "CAPTAIN" | "MEMBER";

export default function PlayerTeamsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("teams");
  const [teams, setTeams] = useState<Team[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("ALL");
  const [search, setSearch] = useState("");
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [declineTarget, setDeclineTarget] = useState<TeamInvitation | null>(null);
  const [processingInvitationId, setProcessingInvitationId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    setError("");
    try {
      const [teamsResponse, invitationsResponse] = await Promise.all([
        api.get<MyTeamsResponse>("/api/teams/my-teams/"),
        api.get<TeamInvitationsResponse>("/api/teams/invitations/"),
      ]);
      setTeams(teamsResponse.data.teams);
      setInvitations(invitationsResponse.data.invitations);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load your teams right now. Please try again."));
    } finally {
      setIsLoading(false);
    }
  }

  async function decideInvitation(invitation: TeamInvitation, decision: "accept" | "reject") {
    if (processingInvitationId) return;
    setProcessingInvitationId(invitation.id);
    try {
      await api.post(`/api/teams/invitations/${invitation.id}/${decision}/`);
      setInvitations((current) => current.filter((item) => item.id !== invitation.id));
      if (decision === "accept") {
        const teamsResponse = await api.get<MyTeamsResponse>("/api/teams/my-teams/");
        setTeams(teamsResponse.data.teams);
        emitToast({ message: "You have joined the team.", type: "success", dedupeKey: `team-invitation-accepted-${invitation.id}` });
      } else {
        emitToast({ message: "The team invitation has been declined.", type: "success", dedupeKey: `team-invitation-declined-${invitation.id}` });
      }
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not update this invitation. Please try again."), type: "error", dedupeKey: `team-invitation-${invitation.id}-error` });
    } finally {
      setProcessingInvitationId(null);
      setDeclineTarget(null);
    }
  }

  const showSearch = teams.length >= 4;
  const visibleTeams = useMemo(() => {
    return teams.filter((team) => {
      const roleMatches = roleFilter === "ALL" || (roleFilter === "CAPTAIN" ? team.is_captain : !team.is_captain);
      const searchText = `${team.name} ${team.location} ${team.description}`.toLowerCase();
      const searchMatches = !search.trim() || searchText.includes(search.trim().toLowerCase());
      return roleMatches && searchMatches;
    });
  }, [roleFilter, search, teams]);

  return (
    <div className="space-y-5">
      <DashboardPageHeader
        actions={
          <Link className="sport-primary-button" href="/dashboard/player/teams/create">
            Create Team
          </Link>
        }
        eyebrow="Cricksal squads"
        title="My Teams"
        description="View your teams, manage captain responsibilities, and respond to invitations from one place."
      />

      <section className="sport-surface overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-4 pt-4 sm:px-5 sm:pt-5">
          <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Team sections">
            <TabButton active={activeTab === "teams"} count={teams.length} label="My Teams" onClick={() => setActiveTab("teams")} />
            <TabButton active={activeTab === "invitations"} count={invitations.length} label="Invitations" onClick={() => setActiveTab("invitations")} />
          </div>
        </div>

        {isLoading ? (
          <TeamsSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={loadData} />
        ) : activeTab === "teams" ? (
          <div className="space-y-5 p-4 sm:p-5">
            <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              {showSearch ? (
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Search teams</span>
                  <input className="sport-input" onChange={(event) => setSearch(event.target.value)} placeholder="Search your teams" value={search} />
                </label>
              ) : (
                <p className="text-sm font-semibold text-slate-600">Filter by your role in each team.</p>
              )}
              <div className="flex rounded-md border border-slate-200 bg-white p-1">
                <RoleButton active={roleFilter === "ALL"} label="All" onClick={() => setRoleFilter("ALL")} />
                <RoleButton active={roleFilter === "CAPTAIN"} label="Captain" onClick={() => setRoleFilter("CAPTAIN")} />
                <RoleButton active={roleFilter === "MEMBER"} label="Member" onClick={() => setRoleFilter("MEMBER")} />
              </div>
            </div>

            {teams.length === 0 ? (
              <EmptyState title="You are not part of a team yet." description="Create your first Cricksal team or explore teams looking for players." primaryHref="/dashboard/player/teams/create" primaryLabel="Create a Team" secondaryHref="/challenge-teams" secondaryLabel="Explore Teams" />
            ) : visibleTeams.length === 0 ? (
              <EmptyState title="No teams match this filter." description="Try a different role filter or clear your search." primaryLabel="Show All Teams" onPrimary={() => { setRoleFilter("ALL"); setSearch(""); }} />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {visibleTeams.map((team) => (
                  <TeamCard key={team.id} openMenuId={openMenuId} setOpenMenuId={setOpenMenuId} team={team} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 sm:p-5">
            {invitations.length === 0 ? (
              <EmptyState title="You have no pending team invitations." description="When captains invite you by SportSpot ID, the invitation will appear here." primaryHref="/dashboard/player/teams" primaryLabel="View My Teams" />
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {invitations.map((invitation) => (
                  <InvitationCard key={invitation.id} invitation={invitation} isProcessing={processingInvitationId === invitation.id} onAccept={() => decideInvitation(invitation, "accept")} onDecline={() => setDeclineTarget(invitation)} />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {declineTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button aria-label="Close decline confirmation" className="absolute inset-0 bg-sportNavy/45" onClick={() => setDeclineTarget(null)} type="button" />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-xl font-black text-sportNavy">Decline invitation?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">You will decline the invitation from {declineTarget.team_name}. You can still be invited again later.</p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-black text-slate-700 hover:bg-slate-50" onClick={() => setDeclineTarget(null)} type="button">Keep Invitation</button>
              <button className="min-h-11 rounded-xl bg-red-600 px-4 text-sm font-black text-white hover:bg-red-700 disabled:bg-slate-400" disabled={processingInvitationId === declineTarget.id} onClick={() => decideInvitation(declineTarget, "reject")} type="button">Decline</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TeamCard({ openMenuId, setOpenMenuId, team }: { openMenuId: number | null; setOpenMenuId: (id: number | null) => void; team: Team }) {
  const menuOpen = openMenuId === team.id;
  return (
    <article className="sport-card group transition hover:border-green-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <TeamAvatar image={team.team_photo} name={team.name} size="md" />
          <div className="min-w-0">
            <h2 className="truncate text-lg font-black text-sportNavy">{team.name}</h2>
            <p className="mt-1 truncate text-sm font-semibold text-slate-600">{team.location}</p>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black ${team.is_captain ? "bg-green-50 text-sportGreen" : "bg-slate-100 text-slate-600"}`}>{team.is_captain ? "Captain" : "Member"}</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <SmallBadge label={formatChoice(team.skill_level)} />
        <SmallBadge label="Active" />
        <SmallBadge label={`${team.members_count} ${team.members_count === 1 ? "member" : "members"}`} />
      </div>

      <p className="mt-4 min-h-[2.75rem] text-sm leading-6 text-slate-600 line-clamp-2">
        {team.description || "No team description has been added yet."}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 border-y border-slate-100 py-3">
        <MiniMetric label="Reliability" value={team.matches_played_count >= 3 ? `${team.team_reliability_score}/100` : "New Team"} />
        <MiniMetric label="Rating" value={formatRating(team.average_rating)} />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Link className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-sportGreen px-4 text-sm font-black text-white transition hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-200" href={`/dashboard/player/teams/${team.id}`}>View Team</Link>
        <div className="relative">
          <button aria-expanded={menuOpen} aria-label={`More actions for ${team.name}`} className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-lg font-black text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-green-200" onClick={() => setOpenMenuId(menuOpen ? null : team.id)} type="button">...</button>
          {menuOpen ? <TeamActionMenu isCaptain={team.is_captain} teamId={team.id} /> : null}
        </div>
      </div>
    </article>
  );
}

function TeamActionMenu({ isCaptain, teamId }: { isCaptain: boolean; teamId: number }) {
  return (
    <div className="absolute right-0 top-12 z-10 w-52 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
      <MenuLink href={`/dashboard/player/teams/${teamId}`} label={isCaptain ? "Manage Team" : "Team Details"} />
      {isCaptain ? (
        <>
          <MenuLink href={`/dashboard/player/teams/${teamId}`} label="Invite Player" />
          <MenuLink href={`/dashboard/player/teams/${teamId}`} label="Manage Members" />
          <MenuLink href={`/dashboard/player/teams/${teamId}`} label="Add Guest Player" />
        </>
      ) : null}
    </div>
  );
}

function InvitationCard({ invitation, isProcessing, onAccept, onDecline }: { invitation: TeamInvitation; isProcessing: boolean; onAccept: () => void; onDecline: () => void }) {
  return (
    <article className="sport-card transition hover:border-green-200 hover:shadow-md">
      <div className="flex items-start gap-3">
        <TeamAvatar image={invitation.team_photo} name={invitation.team_name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-black text-sportNavy">{invitation.team_name}</h2>
              <p className="mt-1 text-sm font-semibold text-slate-600">{invitation.team_location}</p>
            </div>
            <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-black text-sportGreen">Invitation</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600 line-clamp-2">{invitation.team_description || `${invitation.captain_name} invited you to join their Cricksal squad.`}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <InfoRow label="Captain" value={invitation.captain_name} />
        <InfoRow label="Skill level" value={formatChoice(invitation.team_skill_level)} />
        <InfoRow label="Members" value={`${invitation.team_members_count} active`} />
        <InfoRow label="Invited" value={formatDate(invitation.invited_at)} />
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Link className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-green-200 px-4 text-sm font-black text-sportGreen hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-green-200" href={`/dashboard/player/teams/${invitation.team}`}>View Team</Link>
        <button className="min-h-11 flex-1 rounded-xl bg-sportGreen px-4 text-sm font-black text-white hover:bg-green-700 disabled:bg-slate-400" disabled={isProcessing} onClick={onAccept} type="button">{isProcessing ? "Updating..." : "Accept"}</button>
        <button className="min-h-11 rounded-xl border border-red-200 px-4 text-sm font-black text-red-700 hover:bg-red-50 disabled:opacity-60" disabled={isProcessing} onClick={onDecline} type="button">Decline</button>
      </div>
    </article>
  );
}

function TabButton({ active, count, label, onClick }: { active: boolean; count: number; label: string; onClick: () => void }) {
  return (
    <button aria-selected={active} className={`relative min-h-12 shrink-0 px-3 text-sm font-black transition focus:outline-none focus:ring-2 focus:ring-green-200 ${active ? "text-sportGreen" : "text-slate-600 hover:text-sportNavy"}`} onClick={onClick} role="tab" type="button">
      {label}
      {count > 0 ? <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${active ? "bg-green-50 text-sportGreen" : "bg-slate-100 text-slate-600"}`}>{count}</span> : null}
      {active ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-sportGreen" /> : null}
    </button>
  );
}

function RoleButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button className={`min-h-10 rounded-lg px-3 text-sm font-black transition ${active ? "bg-sportGreen text-white" : "text-slate-600 hover:bg-slate-50"}`} onClick={onClick} type="button">{label}</button>;
}

function TeamAvatar({ image, name, size }: { image: string; name: string; size: "md" }) {
  const photoSrc = getTeamPhotoSrc(image);
  return <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-sportNavy text-sm font-black text-white">{photoSrc ? <Image alt={`${name} team logo`} className="object-cover" fill sizes="56px" src={photoSrc} unoptimized /> : getTeamInitials(name)}</div>;
}

function EmptyState({ description, onPrimary, primaryHref, primaryLabel, secondaryHref, secondaryLabel, title }: { description: string; onPrimary?: () => void; primaryHref?: string; primaryLabel: string; secondaryHref?: string; secondaryLabel?: string; title: string }) {
  const primaryClass = "sport-primary-button";
  return (
    <section className="sport-empty-state border-green-200 bg-green-50">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-xl font-black text-sportGreen shadow-sm">SS</div>
      <h2 className="mt-4 text-xl font-black text-sportNavy">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">{description}</p>
      <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
        {primaryHref ? <Link className={primaryClass} href={primaryHref}>{primaryLabel}</Link> : <button className={primaryClass} onClick={onPrimary} type="button">{primaryLabel}</button>}
        {secondaryHref && secondaryLabel ? <Link className="sport-secondary-button border-green-200 text-sportGreen hover:bg-green-50" href={secondaryHref}>{secondaryLabel}</Link> : null}
      </div>
    </section>
  );
}

function TeamsSkeleton() {
  return (
    <div className="space-y-5 p-4 sm:p-5">
      <div className="h-20 animate-pulse rounded-2xl bg-slate-100" />
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {[0, 1, 2].map((item) => <div className="h-72 animate-pulse rounded-2xl bg-slate-100" key={item} />)}
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="sport-error-state m-4 sm:m-5">
      <h2 className="text-lg font-black text-red-950">Teams could not be loaded</h2>
      <p className="mt-2 text-sm font-semibold leading-6 text-red-700">{message}</p>
      <button className="sport-primary-button mt-4 bg-red-600 hover:bg-red-700" onClick={onRetry} type="button">Retry</button>
    </section>
  );
}

function SmallBadge({ label }: { label: string }) {
  return <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{label}</span>;
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return <div><p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="mt-1 text-sm font-black text-sportNavy">{value}</p></div>;
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="mt-1 truncate text-sm font-black text-sportNavy">{value}</p></div>;
}

function MenuLink({ href, label }: { href: string; label: string }) {
  return <Link className="block rounded-lg px-3 py-2 text-sm font-black text-slate-700 hover:bg-green-50 hover:text-sportGreen focus:outline-none focus:ring-2 focus:ring-green-200" href={href}>{label}</Link>;
}

function formatChoice(value?: string) {
  if (!value) return "Not set";
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatRating(value?: string) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? numberValue.toFixed(1) : "0.0";
}

function formatDate(value?: string) {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return formatDateTimeInNepal(value, { day: "numeric", month: "short", year: "numeric" });
}

function getTeamPhotoSrc(value: string) {
  if (!value) return "";
  if (value.startsWith("http")) return value;
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
  return `${apiBaseUrl}${value}`;
}

function getTeamInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "SS";
}
