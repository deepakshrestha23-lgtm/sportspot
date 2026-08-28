"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getCurrentUser } from "@/lib/auth";
import type {
  ChallengeTeamListResponse,
  ChallengeTeamSummary,
  TeamChallenge,
  TeamChallengeListResponse,
} from "@/types/teamChallenge";

type ChallengeTab = "teams" | "open" | "mine";

const tabs: Array<{ key: ChallengeTab; label: string }> = [
  { key: "teams", label: "Find Teams" },
  { key: "open", label: "Open Challenges" },
  { key: "mine", label: "My Challenges" },
];

function normalizeTab(value: string | null): ChallengeTab {
  return tabs.some((tab) => tab.key === value) ? (value as ChallengeTab) : "teams";
}

export default function ChallengeTeamsPage() {
  return <Suspense fallback={<ChallengeSkeleton />}><ChallengeTeamsContent /></Suspense>;
}

function ChallengeTeamsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = getCurrentUser();
  const userId = user?.id ?? null;
  const requestedTab = normalizeTab(searchParams.get("tab"));
  const requestedSearch = searchParams.get("search") || "";
  const [activeTab, setActiveTab] = useState<ChallengeTab>(requestedTab);
  const [search, setSearch] = useState(requestedSearch);
  const [teams, setTeams] = useState<ChallengeTeamSummary[]>([]);
  const [openChallenges, setOpenChallenges] = useState<TeamChallenge[]>([]);
  const [myChallenges, setMyChallenges] = useState<TeamChallenge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [loadedTabs, setLoadedTabs] = useState<Record<ChallengeTab, boolean>>({ teams: false, open: false, mine: false });
  const loadedTabsRef = useRef(loadedTabs);
  const requestVersion = useRef(0);

  useEffect(() => {
    if (activeTab === requestedTab) return;
    setActiveTab(requestedTab);
    setError("");
    setIsLoading(!loadedTabsRef.current[requestedTab]);
    setIsRefreshing(false);
  }, [activeTab, requestedTab]);

  useEffect(() => {
    setSearch(requestedSearch);
  }, [requestedSearch]);

  const loadActiveTab = useCallback(async (tab: ChallengeTab, term = "") => {
    if (tab === "mine" && !user) {
      setIsLoading(false);
      setIsRefreshing(false);
      setError("");
      return;
    }

    const version = ++requestVersion.current;
    const hasExistingData = loadedTabsRef.current[tab];
    setIsLoading(!hasExistingData);
    setIsRefreshing(true);
    setError("");

    try {
      if (tab === "teams") {
        const response = await api.get<ChallengeTeamListResponse>("/api/team-challenges/teams/", { params: { search: term } });
        if (version !== requestVersion.current) return;
        setTeams(response.data.teams);
      } else if (tab === "open") {
        const response = await api.get<TeamChallengeListResponse>("/api/team-challenges/challenges/public/", { params: { search: term } });
        if (version !== requestVersion.current) return;
        setOpenChallenges(response.data.challenges);
      } else {
        const response = await api.get<TeamChallengeListResponse>("/api/team-challenges/challenges/", { params: { scope: "all", search: term } });
        if (version !== requestVersion.current) return;
        setMyChallenges(response.data.challenges);
      }

      if (version !== requestVersion.current) return;
      loadedTabsRef.current = { ...loadedTabsRef.current, [tab]: true };
      setLoadedTabs(loadedTabsRef.current);
    } catch (requestError) {
      if (version !== requestVersion.current) return;
      setError(getApiErrorMessage(requestError, "We could not load team challenges right now.", { notify: false }));
    } finally {
      if (version === requestVersion.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadActiveTab(activeTab, search), 220);
    return () => {
      window.clearTimeout(timer);
      requestVersion.current += 1;
    };
  }, [activeTab, loadActiveTab, search]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadActiveTab(activeTab, search);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [activeTab, loadActiveTab, search]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  function changeTab(tab: ChallengeTab) {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setError("");
    setIsLoading(!loadedTabsRef.current[tab]);
    setIsRefreshing(false);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    router.replace(`/challenge-teams?${params.toString()}`, { scroll: false });
  }

  function changeSearch(value: string) {
    setSearch(value);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", activeTab);
    if (value.trim()) params.set("search", value);
    else params.delete("search");
    router.replace(`/challenge-teams?${params.toString()}`, { scroll: false });
  }

  function retry() {
    void loadActiveTab(activeTab, search);
  }

  const activeTabLoaded = loadedTabs[activeTab];
  const activeItems = activeTab === "open" ? openChallenges : myChallenges;

  return (
    <main className="min-h-[calc(100vh-68px)] bg-[var(--sport-canvas)] px-4 py-7 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-5 border-b border-slate-200/80 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="sport-eyebrow">Challenge Teams</p>
            <h1 className="sport-page-title">Find your next Cricksal match</h1>
            <p className="sport-page-description">Challenge an available team or respond to a match proposal from your team captain.</p>
          </div>
          {user ? <Link className="sport-primary-button shrink-0" href="/challenge-teams/create">Create Challenge</Link> : <Link className="sport-secondary-button shrink-0" href="/login">Log in to challenge</Link>}
        </header>

        <section className="sport-surface p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <label className="relative block w-full lg:max-w-xl">
              <span className="sr-only">Search teams and challenges</span>
              <SearchIcon />
              <input className="min-h-11 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm outline-none focus:border-sportGreen focus:ring-2 focus:ring-green-100" onChange={(event) => changeSearch(event.target.value)} placeholder="Search teams, areas or venues" value={search} />
            </label>
            <div aria-label="Challenge sections" className="sport-tab-list overflow-x-auto" role="tablist">
              {tabs.map((tab) => <button aria-controls={`${tab.key}-challenge-panel`} aria-selected={activeTab === tab.key} className="sport-tab" id={`${tab.key}-challenge-tab`} key={tab.key} onClick={() => changeTab(tab.key)} role="tab" tabIndex={activeTab === tab.key ? 0 : -1} type="button">{tab.label}{tab.key === "open" && openChallenges.length > 0 ? <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-[11px] text-sportGreen">{openChallenges.length}</span> : null}</button>)}
            </div>
          </div>
        </section>

        {activeTab === "mine" && !user ? <section className="sport-surface p-10 text-center"><h2 className="text-xl font-bold text-sportNavy">Log in to manage team challenges</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-600">You can browse public teams without an account. Log in as a Player to send, accept and manage challenges.</p><Link className="sport-primary-button mt-5" href="/login">Log in</Link></section> : null}
        <section aria-busy={isRefreshing} aria-labelledby={`${activeTab}-challenge-tab`} className="space-y-4" id={`${activeTab}-challenge-panel`} role="tabpanel" tabIndex={0}>
          {isRefreshing && activeTabLoaded ? <p aria-live="polite" className="text-right text-xs font-semibold text-slate-500">Updating results...</p> : null}
          {isLoading ? <ChallengeSkeleton variant={activeTab} /> : error && !activeTabLoaded ? <ErrorState message={error} onRetry={retry} /> : activeTab === "mine" && !user ? null : error ? <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><div className="flex flex-wrap items-center justify-between gap-3"><p>We could not refresh these results. Showing the last available update.</p><button className="font-bold underline underline-offset-2" onClick={retry} type="button">Try again</button></div></section> : activeTab === "teams" ? teams.length === 0 ? <EmptyState tab={activeTab} user={Boolean(user)} /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{teams.map((team) => <TeamCard key={team.id} team={team} onChallenge={() => router.push(`/challenge-teams/create?team=${team.id}`)} />)}</div> : activeItems.length === 0 ? <EmptyState tab={activeTab} user={Boolean(user)} /> : <div className="grid gap-4 lg:grid-cols-2">{activeItems.map((challenge) => <ChallengeCard challenge={challenge} key={challenge.id} now={clock} />)}</div>}
        </section>
      </div>
    </main>
  );
}

function TeamCard({ onChallenge, team }: { team: ChallengeTeamSummary; onChallenge: () => void }) {
  return <article className="sport-surface flex min-h-[220px] flex-col p-5 transition hover:-translate-y-0.5 hover:border-green-200 hover:shadow-md">
    <div className="flex items-start justify-between gap-3"><Avatar image={team.team_photo} label={team.name} /><span className="sport-status border-green-200 bg-green-50 text-sportGreen">Open to challenges</span></div>
    <h2 className="mt-4 text-lg font-bold text-sportNavy">{team.name}</h2>
    <p className="mt-1 text-sm text-slate-600">{team.location || "Location not added"}</p>
    <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-600"><span className="rounded-full bg-slate-100 px-2.5 py-1">{formatLabel(team.skill_level)}</span><span className="rounded-full bg-slate-100 px-2.5 py-1">{team.members_count} active {team.members_count === 1 ? "player" : "players"}</span></div>
    <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="truncate text-xs text-slate-500">Captain: {team.captain_name || "Team captain"}</p><button className="sport-primary-button shrink-0" onClick={onChallenge} type="button">Challenge Team</button></div>
  </article>;
}

function ChallengeCard({ challenge, now }: { challenge: TeamChallenge; now: number }) {
  const proposal = challenge.current_proposal;
  const schedule = proposal.booking_summary ? `${proposal.booking_summary.venue_name} · ${proposal.booking_summary.court_name}` : [proposal.preferred_venue_name, proposal.preferred_area, proposal.preferred_district].filter(Boolean).join(" · ") || "Court details to be agreed";
  const date = proposal.booking_summary?.start_at || (proposal.proposed_date ? `${proposal.proposed_date}T${proposal.proposed_start_time || "00:00:00"}` : null);
  return <article className="sport-surface flex min-h-[245px] flex-col p-5">
    <div className="flex items-start justify-between gap-3"><div className="flex flex-wrap gap-2"><span className="sport-status border-green-200 bg-green-50 text-sportGreen">{challenge.challenge_type === "OPEN" ? "Open challenge" : "Direct challenge"}</span><span className={`sport-status ${challenge.court_mode === "BOOKING_FIRST" ? "border-green-200 bg-green-50 text-sportGreen" : "border-blue-200 bg-blue-50 text-blue-700"}`}>{challenge.court_mode === "BOOKING_FIRST" ? "Verified booking" : "Planning"}</span></div><span className="sport-status border-slate-200 bg-slate-50 text-slate-600">{challenge.status_label}</span></div>
    <div className="mt-5 flex items-center gap-3"><div className="min-w-0 flex-1"><p className="truncate text-base font-bold text-sportNavy">{challenge.challenger_team.name}</p><p className="mt-0.5 text-xs text-slate-500">Challenger</p></div><span className="text-sm font-bold text-slate-400">vs</span><div className="min-w-0 flex-1 text-right"><p className="truncate text-base font-bold text-sportNavy">{challenge.challenged_team?.name || "Opponent wanted"}</p><p className="mt-0.5 text-xs text-slate-500">{challenge.challenged_team ? "Challenged team" : "Open to teams"}</p></div></div>
    <div className="mt-5 grid gap-2 text-sm text-slate-600 sm:grid-cols-2"><p><span className="font-semibold text-slate-800">When:</span> {formatDate(date)}</p><p><span className="font-semibold text-slate-800">Where:</span> {schedule}</p><p><span className="font-semibold text-slate-800">Format:</span> {proposal.players_per_side} a side · {formatLabel(proposal.intensity)}</p><p><span className="font-semibold text-slate-800">Response by:</span> {formatDate(challenge.response_deadline)}</p></div>
    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="text-xs font-semibold text-slate-500">{((challenge.challenge_type === "OPEN" ? challenge.is_open_for_opponent_response : challenge.is_open_for_response) && new Date(challenge.response_deadline).getTime() > now) ? `Closes ${relativeDeadline(challenge.response_deadline, now)}` : "No longer accepting responses"}</p><Link className="sport-primary-button" href={`/challenge-teams/${challenge.id}`}>View Details</Link></div>
  </article>;
}

function EmptyState({ tab, user }: { tab: ChallengeTab; user: boolean }) {
  const copy = tab === "teams" ? ["No teams are accepting challenges right now.", "Try a different search or check back later."] : tab === "open" ? ["No open challenges match your search.", "Open challenges appear here when a team is looking for an opponent."] : ["You have no team challenges yet.", user ? "Challenge a team to arrange a Cricksal match." : "Log in to manage your team challenges."];
  return <section className="sport-surface p-10 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-50 text-sportGreen"><SearchIcon className="h-5 w-5" /></div><h2 className="mt-4 text-xl font-bold text-sportNavy">{copy[0]}</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-600">{copy[1]}</p>{tab === "teams" ? <Link className="sport-secondary-button mt-5" href="/challenge-teams">Clear search</Link> : user ? <Link className="sport-primary-button mt-5" href="/challenge-teams/create">Create Challenge</Link> : null}</section>;
}

function SearchIcon({ className = "pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" }: { className?: string }) {
  return <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="m21 21-4.35-4.35m1.35-5.15a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <section className="rounded-xl border border-red-200 bg-red-50 p-7 text-center"><h2 className="text-lg font-bold text-red-950">We could not load team challenges.</h2><p className="mt-2 text-sm text-red-800">{message}</p><button className="mt-5 inline-flex min-h-10 rounded-md bg-red-600 px-4 py-2.5 text-sm font-bold text-white" onClick={onRetry} type="button">Try again</button></section>; }
function ChallengeSkeleton({ variant = "teams" }: { variant?: ChallengeTab }) { const count = variant === "teams" ? 6 : 4; return <div className={`grid gap-4 ${variant === "teams" ? "md:grid-cols-2 xl:grid-cols-3" : "lg:grid-cols-2"}`}>{Array.from({ length: count }, (_, index) => <div className={`animate-pulse rounded-xl bg-white ${variant === "teams" ? "h-60" : "h-64"}`} key={index} />)}</div>; }
function Avatar({ image, label }: { image: string; label: string }) { return image ? <img alt={`${label} logo`} className="h-14 w-14 rounded-xl border border-slate-200 object-cover" src={image} /> : <div aria-label={`${label} logo placeholder`} className="flex h-14 w-14 items-center justify-center rounded-xl bg-green-50 text-lg font-bold text-sportGreen">{label.charAt(0).toUpperCase()}</div>; }
function formatLabel(value: string) { return value ? value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Not specified"; }
function formatDate(value: string | null) { if (!value) return "To be agreed"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-NP", { dateStyle: "medium", timeStyle: "short" }).format(date); }
function relativeDeadline(value: string, referenceNow = Date.now()) { const delta = new Date(value).getTime() - referenceNow; if (delta <= 0) return "now"; const hours = Math.floor(delta / 3600000); if (hours > 24) return `in ${Math.floor(hours / 24)}d`; if (hours > 0) return `in ${hours}h`; return `in ${Math.max(1, Math.floor(delta / 60000))}m`; }
