"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import BackButton from "@/components/BackButton";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";

type BattingLine = { id: number; name: string; runs: number; balls: number; fours: number; sixes: number; strike_rate: number; dismissal: string };
type BowlingLine = { id: number; name: string; overs: string; runs: number; wickets: number; wides: number; economy: number };
type Innings = {
  id: number; number: number; batting_team_name: string; bowling_team_name: string; target_runs: number | null; total_runs: number;
  wickets: number; overs: string; closing_reason: string; extras: { wides: number; no_balls: number; byes: number; leg_byes: number; total: number };
  batting: BattingLine[]; bowling: BowlingLine[]; fall_of_wickets: Array<{ wicket: number; score: number; batter: string; overs: string }>;
};
type FinalScorecard = {
  id: number; fixture_id: number; status: "SETUP" | "INNINGS_ONE" | "INNINGS_BREAK" | "INNINGS_TWO" | "COMPLETED";
  completed_at: string | null; result: string; overs_per_innings: number; teams: Array<{ id: number; name: string }>; innings: Innings[];
};

export default function FinalScorecardPage() {
  const params = useParams<{ fixtureId: string }>();
  const [scorecard, setScorecard] = useState<FinalScorecard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { void loadScorecard(); }, [params.fixtureId]);

  async function loadScorecard() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<{ scorecard: FinalScorecard | null }>(`/api/scoring/fixtures/${params.fixtureId}/`);
      if (!response.data.scorecard || response.data.scorecard.status !== "COMPLETED") {
        setScorecard(null);
        setError("A finalized scorecard is not available for this match.");
        return;
      }
      setScorecard(response.data.scorecard);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load this scorecard right now."));
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) return <ScorecardSkeleton />;
  if (!scorecard) return <div className="space-y-5"><BackButton href="/dashboard/player/performance" label="Back to My Performance" /><section className="sport-error-state"><p className="sport-eyebrow text-red-700">Scorecard unavailable</p><h1 className="mt-2 text-2xl font-black text-sportNavy">We could not open this final scorecard.</h1><p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">{error || "Please try again in a moment."}</p><button className="sport-primary-button mt-5" onClick={() => void loadScorecard()} type="button">Retry</button></section></div>;

  return <div className="space-y-5"><BackButton href="/dashboard/player/performance" label="Back to My Performance" /><section className="sport-surface overflow-hidden"><div className="border-l-4 border-sportGreen px-5 py-5 sm:px-6 sm:py-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="sport-eyebrow">Final scorecard</p><h1 className="mt-1 text-2xl font-black text-sportNavy sm:text-3xl">{scorecard.teams.map((team) => team.name).join(" vs ")}</h1><p className="mt-2 text-sm leading-6 text-slate-600">{formatDate(scorecard.completed_at)} · {scorecard.overs_per_innings} overs per innings</p></div><span className="sport-status shrink-0 border-green-200 bg-green-50 text-sportGreen">Completed</span></div><div className="mt-5 border-t border-slate-200 pt-4"><p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Result</p><p className="mt-1 text-lg font-black text-sportGreen">{scorecard.result || "Match completed"}</p></div></div></section><section className="sport-surface overflow-hidden" aria-labelledby="innings-summary-heading"><div className="border-b border-slate-200 px-5 py-4 sm:px-6"><p className="sport-eyebrow">Match summary</p><h2 className="mt-1 text-xl font-black text-sportNavy" id="innings-summary-heading">Innings totals</h2></div><div className="grid divide-y divide-slate-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0">{scorecard.innings.map((innings) => <InningsTotal innings={innings} key={innings.id} />)}</div></section><section className="space-y-5" aria-label="Full innings scorecard">{scorecard.innings.map((innings) => <InningsCard innings={innings} key={innings.id} />)}</section><section className="rounded-lg border border-slate-200 bg-slate-50 px-5 py-4 text-sm leading-6 text-slate-600">This final scorecard is generated from the recorded ball-by-ball log. It is separate from player ratings and reliability.</section></div>;
}

function InningsTotal({ innings }: { innings: Innings }) {
  return <div className="px-5 py-4 sm:px-6"><p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{innings.batting_team_name}</p><p className="mt-2 text-2xl font-black text-sportNavy">{innings.total_runs}/{innings.wickets} <span className="text-base font-bold text-slate-500">({innings.overs})</span></p><p className="mt-2 text-sm text-slate-600">{closingLabel(innings.closing_reason)}{innings.target_runs ? ` · Target ${innings.target_runs}` : ""}</p></div>;
}

function InningsCard({ innings }: { innings: Innings }) {
  return <section className="sport-surface overflow-hidden"><div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><p className="sport-eyebrow">Innings {innings.number}</p><h2 className="mt-1 text-xl font-black text-sportNavy">{innings.batting_team_name}</h2></div><p className="text-xl font-black text-sportGreen">{innings.total_runs}/{innings.wickets} <span className="text-sm font-bold text-slate-500">{innings.overs} overs</span></p></div><div className="overflow-x-auto"><table className="min-w-[680px] w-full text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-xs font-black uppercase tracking-[0.1em] text-slate-500"><tr><th className="px-5 py-3 sm:px-6">Batting</th><th className="px-3 py-3 text-right">R</th><th className="px-3 py-3 text-right">B</th><th className="px-3 py-3 text-right">4s</th><th className="px-3 py-3 text-right">6s</th><th className="px-5 py-3 text-right sm:px-6">SR</th></tr></thead><tbody className="divide-y divide-slate-100">{innings.batting.map((batter) => <tr key={batter.id}><td className="px-5 py-3 sm:px-6"><p className="font-bold text-sportNavy">{batter.name}</p><p className="mt-0.5 text-xs text-slate-500">{batter.dismissal}</p></td><td className="px-3 py-3 text-right font-black text-sportNavy">{batter.runs}</td><td className="px-3 py-3 text-right text-slate-700">{batter.balls}</td><td className="px-3 py-3 text-right text-slate-700">{batter.fours}</td><td className="px-3 py-3 text-right text-slate-700">{batter.sixes}</td><td className="px-5 py-3 text-right text-slate-700 sm:px-6">{formatRate(batter.strike_rate)}</td></tr>)}</tbody></table></div><div className="border-y border-slate-200 bg-slate-50 px-5 py-3 text-sm sm:px-6"><span className="font-black text-sportNavy">Extras {innings.extras.total}</span><span className="ml-2 text-slate-600">(wd {innings.extras.wides}, nb {innings.extras.no_balls}, b {innings.extras.byes}, lb {innings.extras.leg_byes})</span></div><div className="overflow-x-auto"><table className="min-w-[620px] w-full text-left text-sm"><thead className="border-b border-slate-200 bg-white text-xs font-black uppercase tracking-[0.1em] text-slate-500"><tr><th className="px-5 py-3 sm:px-6">Bowling</th><th className="px-3 py-3 text-right">O</th><th className="px-3 py-3 text-right">R</th><th className="px-3 py-3 text-right">W</th><th className="px-3 py-3 text-right">Wd</th><th className="px-5 py-3 text-right sm:px-6">Econ</th></tr></thead><tbody className="divide-y divide-slate-100">{innings.bowling.map((bowler) => <tr key={bowler.id}><td className="px-5 py-3 font-bold text-sportNavy sm:px-6">{bowler.name}</td><td className="px-3 py-3 text-right text-slate-700">{bowler.overs}</td><td className="px-3 py-3 text-right text-slate-700">{bowler.runs}</td><td className="px-3 py-3 text-right font-black text-sportNavy">{bowler.wickets}</td><td className="px-3 py-3 text-right text-slate-700">{bowler.wides}</td><td className="px-5 py-3 text-right text-slate-700 sm:px-6">{formatRate(bowler.economy)}</td></tr>)}</tbody></table></div>{innings.fall_of_wickets.length ? <div className="border-t border-slate-200 px-5 py-4 sm:px-6"><p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Fall of wickets</p><p className="mt-2 text-sm leading-6 text-slate-700">{innings.fall_of_wickets.map((wicket) => `${wicket.wicket}-${wicket.score} (${wicket.batter}, ${wicket.overs})`).join(" · ")}</p></div> : null}</section>;
}

function ScorecardSkeleton() { return <div className="space-y-5"><div className="h-8 w-48 animate-pulse rounded bg-slate-200" /><div className="h-44 animate-pulse rounded-lg bg-slate-200" /><div className="h-36 animate-pulse rounded-lg bg-slate-200" /><div className="h-[520px] animate-pulse rounded-lg bg-slate-200" /></div>; }
function closingLabel(value: string) { return value ? value.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase()) : "Innings complete"; }
function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat("en-NP", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "Completed date unavailable"; }
function formatRate(value: number) { return Number.isFinite(value) ? value.toFixed(2) : "-"; }
