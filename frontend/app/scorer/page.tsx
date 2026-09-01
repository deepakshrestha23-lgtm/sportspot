"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import BackButton from "@/components/BackButton";
import LoadingIndicator from "@/components/LoadingIndicator";
import RoleGate from "@/components/RoleGate";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateTimeInNepal } from "@/lib/dates";
import type {
  ScorerTeamSummary,
  ScoringFixtureSummary,
  ScoringFixturesResponse,
  ScoringMatchRequest,
  ScoringMatchRequestsResponse,
  ScoringTeamsResponse,
} from "@/types/teamChallenge";

type ScorerTab = "new" | "ready" | "live" | "completed";

export default function ScorerHubPage() {
  return <RoleGate allowedRoles={["PLAYER"]}><ScorerHubContent /></RoleGate>;
}

function ScorerHubContent() {
  const [fixtures, setFixtures] = useState<ScoringFixtureSummary[]>([]);
  const [requests, setRequests] = useState<ScoringMatchRequestsResponse>({ incoming: [], outgoing: [] });
  const [myTeams, setMyTeams] = useState<ScorerTeamSummary[]>([]);
  const [opponents, setOpponents] = useState<ScorerTeamSummary[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedOpponentId, setSelectedOpponentId] = useState("");
  const [opponentSearch, setOpponentSearch] = useState("");
  const [tab, setTab] = useState<ScorerTab>("new");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [requestActionId, setRequestActionId] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => { void loadWorkspace(); }, []);

  useEffect(() => {
    if (opponentSearch.trim().length < 2) {
      setOpponents([]);
      return;
    }
    const timer = window.setTimeout(() => { void loadTeams(opponentSearch); }, 220);
    return () => window.clearTimeout(timer);
  }, [opponentSearch]);

  async function loadWorkspace() {
    setIsLoading(true);
    setError("");
    try {
      const [fixtureResponse, requestResponse, teamResponse] = await Promise.all([
        api.get<ScoringFixturesResponse>("/api/scoring/fixtures/available/"),
        api.get<ScoringMatchRequestsResponse>("/api/scoring/match-requests/"),
        api.get<ScoringTeamsResponse>("/api/scoring/teams/"),
      ]);
      setFixtures(fixtureResponse.data.fixtures);
      setRequests(requestResponse.data);
      setMyTeams(teamResponse.data.my_teams);
      setSelectedTeamId((current) => current || String(teamResponse.data.my_teams[0]?.id || ""));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load Cricket Scorer right now. Please try again."));
    } finally {
      setIsLoading(false);
    }
  }

  async function loadTeams(search: string) {
    try {
      const response = await api.get<ScoringTeamsResponse>("/api/scoring/teams/", { params: { search } });
      setOpponents(response.data.opponents);
    } catch {
      setOpponents([]);
    }
  }

  async function sendRequest() {
    if (!selectedTeamId || !selectedOpponentId) {
      setError("Choose your team and an opponent before sending the match request.");
      return;
    }
    setIsSending(true);
    setError("");
    try {
      await api.post("/api/scoring/match-requests/", {
        challenger_team_id: Number(selectedTeamId),
        challenged_team_id: Number(selectedOpponentId),
        client_request_id: `scorer-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      });
      setSelectedOpponentId("");
      setOpponentSearch("");
      setOpponents([]);
      await loadWorkspace();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not send that scoring request."));
    } finally {
      setIsSending(false);
    }
  }

  async function decideRequest(request: ScoringMatchRequest, decision: "accept" | "decline" | "cancel") {
    setRequestActionId(request.id);
    setError("");
    try {
      await api.post(`/api/scoring/match-requests/${request.id}/${decision}/`);
      await loadWorkspace();
      if (decision === "accept") setTab("ready");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not update that match request."));
    } finally {
      setRequestActionId(null);
    }
  }

  const readyFixtures = useMemo(() => fixtures.filter((fixture) => fixture.status === "SCHEDULED"), [fixtures]);
  const liveFixtures = useMemo(() => fixtures.filter((fixture) => fixture.status === "IN_PROGRESS"), [fixtures]);
  const completedFixtures = useMemo(() => fixtures.filter((fixture) => fixture.status === "COMPLETED"), [fixtures]);
  const selectedOpponent = opponents.find((team) => String(team.id) === selectedOpponentId) || null;

  return (
    <main className="min-h-screen bg-[var(--sport-canvas)] px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
      <div className="mx-auto max-w-6xl">
        <BackButton href="/challenge-teams" label="Back to challenge teams" />
        <header className="mt-5 flex flex-col gap-5 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <p className="sport-eyebrow">Match-day tools</p>
            <h1 className="sport-page-title mt-1">Cricket Scorer</h1>
            <p className="sport-page-description">Start a scorecard with another registered team, follow a live match, and keep every completed cricket result in one place.</p>
          </div>
          <Link className="sport-secondary-button shrink-0" href="/challenge-teams">Team challenges</Link>
        </header>

        {isLoading ? <div className="sport-surface mt-6 flex min-h-52 items-center justify-center"><LoadingIndicator label="Loading Cricket Scorer" size="lg" /></div> : null}

        {!isLoading && error ? (
          <section className="sport-error-state mt-6" role="alert">
            <h2 className="text-xl font-black text-red-950">Cricket Scorer needs a moment.</h2>
            <p className="mt-2 text-sm leading-6 text-red-800">{error}</p>
            <button className="sport-primary-button mt-5" onClick={() => void loadWorkspace()} type="button">Try again</button>
          </section>
        ) : null}

        {!isLoading ? (
          <>
            <nav aria-label="Cricket Scorer views" className="mt-6 flex overflow-x-auto border-b border-slate-200" role="tablist">
              <TabButton active={tab === "new"} label="New Match" onClick={() => setTab("new")} />
              <TabButton active={tab === "ready"} count={readyFixtures.length} label="Ready to Score" onClick={() => setTab("ready")} />
              <TabButton active={tab === "live"} count={liveFixtures.length} label="Live" onClick={() => setTab("live")} />
              <TabButton active={tab === "completed"} count={completedFixtures.length} label="Completed" onClick={() => setTab("completed")} />
            </nav>

            {tab === "new" ? (
              <section className="sport-surface mt-6 overflow-hidden" aria-labelledby="new-scored-match-title">
                <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
                  <p className="sport-eyebrow">Instant scorecard</p>
                  <h2 className="mt-1 text-xl font-black text-sportNavy" id="new-scored-match-title">Start a scored match</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">The other team captain confirms the request before either team can score.</p>
                </div>
                <div className="grid gap-6 px-5 py-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] sm:px-6">
                  <label className="block text-sm font-bold text-sportNavy">
                    My team
                    <select className="sport-field mt-2 w-full" value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
                      <option value="">Choose a team</option>
                      {myTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                    </select>
                    {!myTeams.length ? <p className="mt-2 text-xs leading-5 text-slate-500">Create a team or become its captain before starting a scored match.</p> : null}
                  </label>

                  <div>
                    <label className="block text-sm font-bold text-sportNavy">
                      Find opponent
                      <input className="sport-field mt-2 w-full" maxLength={80} onChange={(event) => { setOpponentSearch(event.target.value); setSelectedOpponentId(""); }} placeholder="Search registered teams" value={opponentSearch} />
                    </label>
                    <div className="mt-3 min-h-16 border-t border-slate-100 pt-3">
                      {opponentSearch.trim().length < 2 ? <p className="text-sm text-slate-500">Search by team name, area, or city.</p> : null}
                      {opponentSearch.trim().length >= 2 && !opponents.length ? <p className="text-sm text-slate-500">No teams match that search.</p> : null}
                      <div className="space-y-2">
                        {opponents.map((team) => <OpponentRow active={String(team.id) === selectedOpponentId} key={team.id} onSelect={() => setSelectedOpponentId(String(team.id))} team={team} />)}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <p className="text-sm text-slate-600">{selectedOpponent ? `${selectedOpponent.name} will be asked to accept this scored match.` : "Choose an opponent to continue."}</p>
                  <button className="sport-primary-button w-full justify-center sm:w-auto" disabled={isSending || !selectedTeamId || !selectedOpponentId} onClick={() => void sendRequest()} type="button">{isSending ? "Sending request..." : "Send match request"}</button>
                </div>
              </section>
            ) : null}

            {tab === "new" && requests.incoming.filter((item) => item.status === "PENDING").length ? (
              <section className="mt-6" aria-labelledby="incoming-request-title">
                <div className="mb-3 flex items-end justify-between gap-4"><div><p className="sport-eyebrow">Captain decisions</p><h2 className="mt-1 text-xl font-black text-sportNavy" id="incoming-request-title">Match requests for your teams</h2></div><span className="text-sm font-bold text-slate-500">{requests.incoming.filter((item) => item.status === "PENDING").length} pending</span></div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {requests.incoming.filter((item) => item.status === "PENDING").map((request) => <IncomingRequestCard busy={requestActionId === request.id} key={request.id} onDecision={(decision) => void decideRequest(request, decision)} request={request} />)}
                </div>
              </section>
            ) : null}

            {tab === "new" && requests.outgoing.some((item) => item.status === "PENDING") ? (
              <section className="mt-6 border-t border-slate-200 pt-5" aria-labelledby="outgoing-request-title">
                <p className="sport-eyebrow">Awaiting response</p>
                <h2 className="mt-1 text-lg font-black text-sportNavy" id="outgoing-request-title">Sent match requests</h2>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {requests.outgoing.filter((item) => item.status === "PENDING").map((request) => <PendingRequestRow busy={requestActionId === request.id} key={request.id} onCancel={() => void decideRequest(request, "cancel")} request={request} />)}
                </div>
              </section>
            ) : null}

            {tab === "ready" ? <FixtureCollection emptyText="Accepted instant matches and confirmed booked matches will appear here when they are ready to set up." fixtures={readyFixtures} title="Ready to score" /> : null}
            {tab === "live" ? <FixtureCollection emptyText="A live scorecard will appear here once its first innings begins." fixtures={liveFixtures} title="Live matches" /> : null}
            {tab === "completed" ? <FixtureCollection emptyText="Completed scorecards stay here as your team's cricket record." fixtures={completedFixtures} title="Completed scorecards" /> : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

function TabButton({ active, count, label, onClick }: { active: boolean; count?: number; label: string; onClick: () => void }) {
  return <button aria-selected={active} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-bold transition ${active ? "border-sportGreen text-sportGreen" : "border-transparent text-slate-500 hover:text-sportNavy"}`} onClick={onClick} role="tab" type="button">{label}{typeof count === "number" && count > 0 ? <span className="ml-2 text-xs">{count}</span> : null}</button>;
}

function OpponentRow({ active, onSelect, team }: { active: boolean; onSelect: () => void; team: ScorerTeamSummary }) {
  return <button className={`flex w-full items-center gap-3 border px-3 py-3 text-left transition ${active ? "border-sportGreen bg-green-50" : "border-slate-200 bg-white hover:border-green-300"}`} onClick={onSelect} type="button"><TeamMark name={team.name} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-black text-sportNavy">{team.name}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{team.location} / {team.active_players} active players</span></span>{active ? <span className="text-xs font-black text-sportGreen">Selected</span> : null}</button>;
}

function IncomingRequestCard({ busy, onDecision, request }: { busy: boolean; onDecision: (decision: "accept" | "decline") => void; request: ScoringMatchRequest }) {
  return <article className="sport-surface p-5"><div className="flex items-start gap-3"><TeamMark name={request.challenger_team.name} /><div className="min-w-0"><p className="sport-eyebrow">Scored match request</p><h3 className="mt-1 text-lg font-black text-sportNavy">{request.challenger_team.name}</h3><p className="mt-1 text-sm leading-6 text-slate-600">wants to start a scored match against {request.challenged_team.name}.</p></div></div><div className="mt-5 flex gap-3"><button className="sport-primary-button flex-1 justify-center" disabled={busy} onClick={() => onDecision("accept")} type="button">Accept</button><button className="sport-secondary-button flex-1 justify-center" disabled={busy} onClick={() => onDecision("decline")} type="button">Decline</button></div></article>;
}

function PendingRequestRow({ busy, onCancel, request }: { busy: boolean; onCancel: () => void; request: ScoringMatchRequest }) {
  return <div className="flex items-center gap-3 border border-slate-200 bg-white px-4 py-3"><TeamMark name={request.challenged_team.name} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-black text-sportNavy">{request.challenged_team.name}</p><p className="mt-0.5 text-xs text-slate-500">Awaiting their captain's decision</p></div>{request.can_cancel ? <button className="text-sm font-black text-slate-600 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={onCancel} type="button">Withdraw</button> : null}</div>;
}

function FixtureCollection({ emptyText, fixtures, title }: { emptyText: string; fixtures: ScoringFixtureSummary[]; title: string }) {
  return <section className="mt-6" aria-labelledby={`fixture-${title.replaceAll(" ", "-")}`}><div className="flex items-end justify-between gap-4"><div><p className="sport-eyebrow">Cricket matches</p><h2 className="mt-1 text-xl font-black text-sportNavy" id={`fixture-${title.replaceAll(" ", "-")}`}>{title}</h2></div><span className="text-sm font-bold text-slate-500">{fixtures.length} match{fixtures.length === 1 ? "" : "es"}</span></div>{fixtures.length ? <div className="mt-4 grid gap-4 lg:grid-cols-2">{fixtures.map((fixture) => <ScoringFixtureCard fixture={fixture} key={fixture.fixture_id} />)}</div> : <div className="sport-surface mt-4 px-5 py-8 text-center"><p className="text-sm leading-6 text-slate-600">{emptyText}</p></div>}</section>;
}

function ScoringFixtureCard({ fixture }: { fixture: ScoringFixtureSummary }) {
  const completed = fixture.status === "COMPLETED" || fixture.scorecard_status === "COMPLETED";
  const canOpenScorer = fixture.scorecard_available && fixture.can_view;
  const canSetUp = !fixture.scorecard_available && fixture.can_set_up;
  const href = completed
    ? `/dashboard/player/performance/scorecards/${fixture.fixture_id}`
    : fixture.match_source === "INSTANT_SCORER" || canOpenScorer || canSetUp
      ? `/challenge-teams/${fixture.challenge_id}/scorer`
      : `/challenge-teams/${fixture.challenge_id}/room`;
  const actionLabel = completed ? "View scorecard" : canSetUp ? "Set up scorer" : canOpenScorer ? "Open scorer" : "Open match";
  const sourceLabel = fixture.match_source === "INSTANT_SCORER" ? "Instant scored match" : "Booked team match";
  const timing = fixture.booking ? formatBookingWindow(fixture.booking.start_at, fixture.booking.end_at) : "Ready when both teams are set";
  const location = fixture.booking ? `${fixture.booking.venue_name} / ${fixture.booking.court_name}` : "No venue booking attached";
  return <article className="sport-surface overflow-hidden"><div className="border-l-4 border-sportGreen p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.1em] text-sportGreen">{sourceLabel}</p><h3 className="mt-2 text-lg font-black text-sportNavy">{fixture.challenger_team.name} <span className="font-semibold text-slate-400">vs</span> {fixture.challenged_team.name}</h3></div><span className={`sport-status ${completed ? "border-slate-200 bg-slate-100 text-slate-700" : fixture.status === "IN_PROGRESS" ? "border-green-200 bg-green-50 text-sportGreen" : "border-blue-200 bg-blue-50 text-blue-800"}`}>{fixture.status_label}</span></div><dl className="mt-5 grid gap-3 border-y border-slate-100 py-4 sm:grid-cols-2"><MatchDetail label="Match" value={timing} /><MatchDetail label="Venue" value={location} /></dl><div className="flex flex-wrap items-center gap-2 pt-4">{fixture.is_captain ? <span className="sport-status border-green-200 bg-green-50 text-sportGreen">Captain access</span> : null}{fixture.is_assigned_scorer ? <span className="sport-status border-blue-200 bg-blue-50 text-blue-800">Scorer</span> : null}{fixture.scorecard_result ? <p className="w-full text-sm font-bold text-sportNavy">{fixture.scorecard_result}</p> : null}</div><div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs font-semibold leading-5 text-slate-500">{completed ? "Final scorecard" : fixture.can_score ? "You control the active scorecard" : fixture.can_set_up ? "Confirm playing squads to begin" : "Available to follow"}</p><Link className="sport-primary-button w-full justify-center sm:w-auto" href={href}>{actionLabel}</Link></div></div></article>;
}

function MatchDetail({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">{label}</dt><dd className="mt-1 text-sm font-bold text-sportNavy">{value}</dd></div>; }
function TeamMark({ name }: { name: string }) { return <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-50 text-sm font-black text-sportGreen">{name.slice(0, 2).toUpperCase()}</span>; }
function formatBookingWindow(start: string | null, end: string | null) { if (!start) return "Time to be confirmed"; const date = formatDateTimeInNepal(start, { weekday: "short", month: "short", day: "numeric" }); const startTime = formatDateTimeInNepal(start, { timeStyle: "short" }); const endTime = end ? formatDateTimeInNepal(end, { timeStyle: "short" }) : ""; return `${date} / ${startTime}${endTime ? ` to ${endTime}` : ""}`; }
