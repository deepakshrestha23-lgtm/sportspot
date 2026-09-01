"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import MediaImage from "@/components/MediaImage";
import { DashboardPageHeader } from "@/components/player-dashboard/DashboardPageHeader";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getMediaSrc } from "@/lib/media";
import type { CricketPerformancePeriod, CricketPerformanceMatch, CricketPerformanceResponse } from "@/types/cricketPerformance";

const PAGE_SIZE = 10;

export default function PlayerPerformancePage() {
  const [performance, setPerformance] = useState<CricketPerformanceResponse | null>(null);
  const [period, setPeriod] = useState<CricketPerformancePeriod>("ALL");
  const [teamId, setTeamId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);

  useEffect(() => {
    void loadPerformance(1);
  }, [period, teamId]);

  async function loadPerformance(page: number) {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ period, page: String(page), page_size: String(PAGE_SIZE) });
      if (teamId) params.set("team_id", teamId);
      const response = await api.get<CricketPerformanceResponse>(`/api/scoring/my-performance/?${params.toString()}`);
      if (requestId !== requestIdRef.current) return;
      setPerformance(response.data);
    } catch (requestError) {
      if (requestId !== requestIdRef.current) return;
      setError(getApiErrorMessage(requestError, "We could not load your cricket performance right now."));
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }

  if (isLoading && !performance) return <PerformanceSkeleton />;

  if (error && !performance) {
    return (
      <div className="space-y-5">
        <DashboardPageHeader eyebrow="Scorer-backed record" title="My Performance" description="Review the finalized cricket scorecards you have taken part in." />
        <section className="sport-error-state">
          <p className="text-sm font-semibold text-red-700">{error}</p>
          <button className="sport-primary-button mt-4" onClick={() => void loadPerformance(1)} type="button">Retry</button>
        </section>
      </div>
    );
  }

  if (!performance) return null;

  const hasFielding = Boolean(performance.fielding.catches || performance.fielding.run_outs || performance.fielding.stumpings);
  const photoSource = getMediaSrc(performance.player.profile_photo);

  return (
    <div className="space-y-5">
      <DashboardPageHeader
        actions={<Link className="sport-secondary-button min-h-11" href="/scorer">Open Cricket Scorer</Link>}
        description="A private cricket record calculated only from finalized SportSpot scorecards. Ratings and reliability stay separate."
        eyebrow="Scorer-backed record"
        title="My Performance"
      />

      <section className="sport-surface overflow-hidden">
        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-green-50 text-lg font-black text-sportGreen">
              <MediaImage alt={`${performance.player.name} profile photo`} className="h-full w-full object-cover" fallback={<span>{initials(performance.player.name)}</span>} source={photoSource} />
            </div>
            <div className="min-w-0">
              <p className="sport-eyebrow">Cricket career</p>
              <h2 className="mt-1 truncate text-xl font-black text-sportNavy">{performance.player.name}</h2>
              <p className="mt-1 text-sm text-slate-600">{performance.player.preferred_role || "Cricksal player"}{performance.player.sportspot_id ? ` · ${performance.player.sportspot_id}` : ""}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <HeaderMetric label="Matches" value={String(performance.summary.matches)} />
            <HeaderMetric label="Batting inns" value={String(performance.summary.batting_innings)} />
            <HeaderMetric label="Bowling inns" value={String(performance.summary.bowling_innings)} />
            <HeaderMetric label="Not outs" value={String(performance.summary.not_outs)} />
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <p className="text-xs font-semibold leading-5 text-slate-600">Only completed scorecards count here. Changing a completed scorecard removes its record until it is finalized again.</p>
          <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2">
            <label className="block min-w-0"><span className="mb-1 block text-xs font-black uppercase tracking-[0.12em] text-slate-500">Period</span><select aria-label="Performance period" className="sport-field h-10 w-full min-w-0 bg-white text-sm font-bold" onChange={(event) => setPeriod(event.target.value as CricketPerformancePeriod)} value={period}><option value="ALL">All time</option><option value="RECENT">Recent {performance.filters.recent_days} days</option></select></label>
            <label className="block min-w-0"><span className="mb-1 block text-xs font-black uppercase tracking-[0.12em] text-slate-500">Team</span><select aria-label="Performance team" className="sport-field h-10 w-full min-w-0 bg-white text-sm font-bold" onChange={(event) => setTeamId(event.target.value)} value={teamId}><option value="">All teams</option>{performance.filters.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
          </div>
        </div>
      </section>

      {error ? <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">{error}</section> : null}

      {performance.summary.matches === 0 ? (
        <EmptyPerformanceState period={period} teamSelected={Boolean(teamId)} />
      ) : (
        <>
          <section className="sport-surface overflow-hidden" aria-labelledby="career-overview-heading">
            <div className="border-b border-slate-200 px-5 py-4 sm:px-6"><p className="sport-eyebrow">Career overview</p><h2 className="mt-1 text-xl font-black text-sportNavy" id="career-overview-heading">Performance at a glance</h2></div>
            <dl className="grid divide-y divide-slate-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
              <CareerMetric detail="From your finalized scorecards" label="Runs" value={String(performance.batting.runs)} />
              <CareerMetric detail={`${performance.batting.fours} fours · ${performance.batting.sixes} sixes`} label="Boundaries" value={String(performance.batting.fours + performance.batting.sixes)} />
              <CareerMetric detail={`${formatOvers(performance.bowling.legal_balls)} overs bowled`} label="Wickets" value={String(performance.bowling.wickets)} />
              <CareerMetric detail={`${performance.fielding.catches} catches · ${performance.fielding.run_outs} run outs`} label="Fielding acts" value={String(performance.fielding.catches + performance.fielding.run_outs + performance.fielding.stumpings)} />
            </dl>
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <section className="sport-surface" aria-labelledby="batting-heading">
              <div className="border-b border-slate-200 px-5 py-4 sm:px-6"><p className="sport-eyebrow">Batting</p><h2 className="mt-1 text-xl font-black text-sportNavy" id="batting-heading">At the crease</h2></div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 sm:grid-cols-4 sm:px-6">
                <DetailMetric label="Runs" value={String(performance.batting.runs)} />
                <DetailMetric label="Average" value={formatDecimal(performance.batting.average)} />
                <DetailMetric label="Strike rate" value={formatDecimal(performance.batting.strike_rate)} />
                <DetailMetric label="High score" value={performance.personal_bests.highest_score ? `${performance.personal_bests.highest_score.runs}${performance.personal_bests.highest_score.not_out ? "*" : ""}` : "-"} />
                <DetailMetric label="Innings" value={String(performance.batting.innings)} />
                <DetailMetric label="Not outs" value={String(performance.batting.not_outs)} />
                <DetailMetric label="Balls faced" value={String(performance.batting.balls)} />
                <DetailMetric label="4s / 6s" value={`${performance.batting.fours} / ${performance.batting.sixes}`} />
              </dl>
            </section>

            <section className="sport-surface" aria-labelledby="bowling-heading">
              <div className="border-b border-slate-200 px-5 py-4 sm:px-6"><p className="sport-eyebrow">Bowling</p><h2 className="mt-1 text-xl font-black text-sportNavy" id="bowling-heading">With the ball</h2></div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 sm:grid-cols-4 sm:px-6">
                <DetailMetric label="Wickets" value={String(performance.bowling.wickets)} />
                <DetailMetric label="Economy" value={formatDecimal(performance.bowling.economy)} />
                <DetailMetric label="Average" value={formatDecimal(performance.bowling.average)} />
                <DetailMetric label="Best" value={performance.personal_bests.best_bowling ? `${performance.personal_bests.best_bowling.wickets}/${performance.personal_bests.best_bowling.runs_conceded}` : "-"} />
                <DetailMetric label="Overs" value={formatOvers(performance.bowling.legal_balls)} />
                <DetailMetric label="Runs conceded" value={String(performance.bowling.runs_conceded)} />
                <DetailMetric label="3 wicket hauls" value={String(performance.bowling.three_wicket_hauls)} />
                <DetailMetric label="5 wicket hauls" value={String(performance.bowling.five_wicket_hauls)} />
              </dl>
            </section>
          </div>

          {hasFielding ? <section className="sport-surface p-5 sm:p-6" aria-labelledby="fielding-heading"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="sport-eyebrow">Fielding</p><h2 className="mt-1 text-xl font-black text-sportNavy" id="fielding-heading">Recorded contributions</h2></div><dl className="grid grid-cols-3 gap-6 border-t border-slate-100 pt-4 text-right sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0"><HeaderMetric label="Catches" value={String(performance.fielding.catches)} /><HeaderMetric label="Run outs" value={String(performance.fielding.run_outs)} /><HeaderMetric label="Stumpings" value={String(performance.fielding.stumpings)} /></dl></div></section> : null}

          <section className="sport-surface" aria-labelledby="form-heading">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><p className="sport-eyebrow">Last five</p><h2 className="mt-1 text-xl font-black text-sportNavy" id="form-heading">Recent form</h2></div><p className="text-sm text-slate-600">Runs, wickets, and the final result from your latest scorecards.</p></div>
            <div className="grid divide-y divide-slate-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-5">
              {performance.recent_form.map((match) => <FormEntry key={match.match_id} match={match} />)}
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="sport-surface" aria-labelledby="match-history-heading">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><p className="sport-eyebrow">Scorecard history</p><h2 className="mt-1 text-xl font-black text-sportNavy" id="match-history-heading">Recent matches</h2></div><p className="text-sm font-semibold text-slate-600">{performance.history.total} finalized {performance.history.total === 1 ? "match" : "matches"}</p></div>
              <div className="divide-y divide-slate-200">{performance.history.matches.map((match) => <MatchHistoryRow key={match.match_id} match={match} />)}</div>
              {performance.history.has_next ? <div className="border-t border-slate-200 px-5 py-4 sm:px-6"><button className="sport-secondary-button min-h-10" disabled={isLoading} onClick={() => void loadPerformance(performance.history.page + 1)} type="button">{isLoading ? "Loading..." : "Show older matches"}</button></div> : null}
            </section>

            <section className="sport-surface" aria-labelledby="personal-bests-heading">
              <div className="border-b border-slate-200 px-5 py-4 sm:px-6"><p className="sport-eyebrow">Personal bests</p><h2 className="mt-1 text-xl font-black text-sportNavy" id="personal-bests-heading">Best scorecard moments</h2></div>
              <div className="divide-y divide-slate-200">
                <BestRow label="Highest score" value={performance.personal_bests.highest_score ? `${performance.personal_bests.highest_score.runs}${performance.personal_bests.highest_score.not_out ? "*" : ""}` : "-"} detail={performance.personal_bests.highest_score ? `${performance.personal_bests.highest_score.balls} balls vs ${performance.personal_bests.highest_score.opponent}` : "No batting innings recorded yet."} href={performance.personal_bests.highest_score ? scorecardHref(performance.personal_bests.highest_score.fixture_id) : undefined} />
                <BestRow label="Best bowling" value={performance.personal_bests.best_bowling ? `${performance.personal_bests.best_bowling.wickets}/${performance.personal_bests.best_bowling.runs_conceded}` : "-"} detail={performance.personal_bests.best_bowling ? `${formatOvers(performance.personal_bests.best_bowling.legal_balls)} overs vs ${performance.personal_bests.best_bowling.opponent}` : "No bowling spell recorded yet."} href={performance.personal_bests.best_bowling ? scorecardHref(performance.personal_bests.best_bowling.fixture_id) : undefined} />
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function HeaderMetric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">{label}</dt><dd className="mt-1 truncate text-lg font-black text-sportNavy">{value}</dd></div>;
}

function CareerMetric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return <div className="px-5 py-4 sm:px-6"><dt className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">{label}</dt><dd className="mt-2 text-2xl font-black text-sportNavy">{value}</dd><p className="mt-1 text-xs leading-5 text-slate-600">{detail}</p></div>;
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">{label}</dt><dd className="mt-1 truncate text-lg font-black text-sportNavy">{value}</dd></div>;
}

function FormEntry({ match }: { match: CricketPerformanceMatch }) {
  const batting = match.batting.played ? `${match.batting.runs}${match.batting.not_out ? "*" : ""}` : "DNB";
  const bowling = match.bowling.bowled ? `${match.bowling.wickets}/${match.bowling.runs_conceded}` : "-";
  return <Link className="block px-5 py-4 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sportGreen" href={scorecardHref(match.fixture_id)}><p className="truncate text-sm font-black text-sportNavy">vs {match.opponent.name}</p><p className="mt-1 text-xs font-semibold text-slate-500">{formatDate(match.completed_at)}</p><div className="mt-3 flex items-baseline justify-between gap-3"><span className="text-lg font-black text-sportGreen">{batting}</span><span className="text-sm font-black text-sportNavy">{bowling}</span></div><p className="mt-2 truncate text-xs text-slate-600">{match.result || "Final scorecard"}</p></Link>;
}

function MatchHistoryRow({ match }: { match: CricketPerformanceMatch }) {
  const batting = match.batting.played ? `${match.batting.runs}${match.batting.not_out ? "*" : ""} (${match.batting.balls})` : "Did not bat";
  const bowling = match.bowling.bowled ? `${match.bowling.wickets}/${match.bowling.runs_conceded} · ${formatOvers(match.bowling.legal_balls)} ov` : "Did not bowl";
  return <article className="flex flex-col gap-4 px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-sportNavy">{match.team.name} <span className="font-semibold text-slate-400">vs</span> {match.opponent.name}</h3><span className="sport-status border-slate-200 bg-slate-50 text-slate-600">{match.source === "INSTANT_SCORER" ? "Instant scorer" : "Team challenge"}</span></div><p className="mt-1 truncate text-sm text-slate-600">{match.result || "Final scorecard"} · {formatDate(match.completed_at)}</p></div><dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3"><div><dt className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">Batting</dt><dd className="mt-1 font-black text-sportNavy">{batting}</dd></div><div><dt className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">Bowling</dt><dd className="mt-1 font-black text-sportNavy">{bowling}</dd></div><div className="col-span-2 sm:col-span-1"><Link className="text-sm font-black text-sportGreen hover:text-green-700" href={scorecardHref(match.fixture_id)}>View scorecard</Link></div></dl></article>;
}

function BestRow({ detail, href, label, value }: { detail: string; href?: string; label: string; value: string }) {
  const content = <><p className="text-sm font-black text-sportNavy">{label}</p><p className="mt-1 text-sm leading-5 text-slate-600">{detail}</p></>;
  return <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6"><div className="min-w-0">{href ? <Link className="block hover:text-sportGreen" href={href}>{content}</Link> : content}</div><p className="shrink-0 text-2xl font-black text-sportGreen">{value}</p></div>;
}

function EmptyPerformanceState({ period, teamSelected }: { period: CricketPerformancePeriod; teamSelected: boolean }) {
  const filtered = period === "RECENT" || teamSelected;
  return <section className="sport-surface p-6 sm:p-8"><p className="sport-eyebrow">No scorecard record yet</p><h2 className="mt-2 text-2xl font-black text-sportNavy">{filtered ? "No finalized matches match these filters" : "Your cricket record will start here"}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{filtered ? "Choose a different period or team to see completed scorecards." : "After a captain finalizes a scorecard for a match squad you played in, SportSpot will calculate your performance here automatically."}</p>{!filtered ? <Link className="sport-primary-button mt-5" href="/scorer">Open Cricket Scorer</Link> : null}</section>;
}

function PerformanceSkeleton() {
  return <div className="space-y-5"><div className="h-28 animate-pulse rounded-lg bg-slate-200" /><div className="h-48 animate-pulse rounded-lg bg-slate-200" /><div className="grid gap-5 xl:grid-cols-2"><div className="h-64 animate-pulse rounded-lg bg-slate-200" /><div className="h-64 animate-pulse rounded-lg bg-slate-200" /></div></div>;
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "P";
}

function formatOvers(legalBalls: number) {
  return `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
}

function formatDecimal(value: number | null) {
  return value === null ? "-" : value.toFixed(2);
}

function formatDate(value: string | null) {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat("en-NP", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function scorecardHref(fixtureId: number) {
  return `/dashboard/player/performance/scorecards/${fixtureId}`;
}
