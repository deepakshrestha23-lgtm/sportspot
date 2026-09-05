"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import BackButton from "@/components/BackButton";
import MediaImage from "@/components/MediaImage";
import GameRoomChat from "@/components/player-dashboard/GameRoomChat";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { emitToast } from "@/lib/toast";
import type { FixtureEligiblePlayer, TeamChallenge, TeamFixture, TeamFixtureParticipant } from "@/types/teamChallenge";

type RoomResponse = { challenge: TeamChallenge; fixture: TeamFixture };
type MatchStatus = "SETUP" | "INNINGS_ONE" | "INNINGS_BREAK" | "INNINGS_TWO" | "COMPLETED";
type ExtraType = "NONE" | "WIDE" | "NO_BALL" | "BYE" | "LEG_BYE";
type WicketKind = "BOWLED" | "CAUGHT" | "LBW" | "RUN_OUT" | "STUMPED" | "HIT_WICKET";

type SquadPlayer = { id: number; player_id: number; name: string; batting_order: number };
type ScorecardTeam = { id: number; name: string; team_photo: string; squad_confirmed: boolean; squad_confirmed_at: string | null; players: SquadPlayer[] };
type Delivery = {
  id: number;
  sequence: number;
  token: string;
  runs_off_bat: number;
  extra_type: ExtraType;
  extra_runs: number;
  wicket_kind: string;
  dismissed_player_id: number | null;
  fielder_id: number | null;
  incoming_batsman_id: number | null;
};
type BattingLine = { id: number; name: string; runs: number; balls: number; fours: number; sixes: number; strike_rate: number; dismissal: string; is_current: boolean };
type BowlingLine = { id: number; name: string; overs: string; runs: number; wickets: number; wides: number; no_balls: number; economy: number };
type Innings = {
  id: number;
  number: number;
  status: "IN_PROGRESS" | "COMPLETED";
  closing_reason: string;
  batting_team_id: number;
  batting_team_name: string;
  bowling_team_id: number;
  bowling_team_name: string;
  target_runs: number | null;
  total_runs: number;
  wickets: number;
  legal_balls: number;
  overs: string;
  run_rate: number;
  extras: { wides: number; no_balls: number; byes: number; leg_byes: number; total: number };
  current_striker_id: number | null;
  current_non_striker_id: number | null;
  current_bowler_id: number | null;
  current_striker_name: string;
  current_non_striker_name: string;
  current_bowler_name: string;
  partnership: { runs: number; balls: number };
  last_over: string[];
  deliveries: Delivery[];
  batting: BattingLine[];
  bowling: BowlingLine[];
  fall_of_wickets: { wicket: number; score: number; batter: string; overs: string }[];
};
type Scorecard = {
  id: number;
  fixture_id: number;
  status: MatchStatus;
  overs_per_innings: number;
  toss: { winner_team_id: number | null; winner_team_name: string; decision: "BAT" | "BOWL" | ""; first_batting_team_id: number | null; second_batting_team_id: number | null };
  scorer: { id: number | null; name: string };
  teams: ScorecardTeam[];
  innings: Innings[];
  active_innings_id: number | null;
  chase: { target: number; runs_needed: number; balls_remaining: number; required_run_rate: number } | null;
  result: string;
  permissions: { can_view: boolean; is_captain: boolean; team_id: number | null; is_assigned_scorer: boolean; can_score: boolean; can_confirm_squad: boolean; can_assign_scorer: boolean };
  can_start_innings: boolean;
};

const WICKET_OPTIONS: { value: WicketKind; label: string }[] = [
  { value: "BOWLED", label: "Bowled" },
  { value: "CAUGHT", label: "Caught" },
  { value: "LBW", label: "LBW" },
  { value: "RUN_OUT", label: "Run out" },
  { value: "STUMPED", label: "Stumped" },
  { value: "HIT_WICKET", label: "Hit wicket" },
];

const EMPTY_WICKET = { kind: "BOWLED" as WicketKind, dismissedPlayerId: "", fielderId: "", incomingPlayerId: "" };

export default function CricketScorerPage() {
  const params = useParams<{ challengeId: string }>();
  const router = useRouter();
  const [room, setRoom] = useState<RoomResponse | null>(null);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [eligiblePlayers, setEligiblePlayers] = useState<FixtureEligiblePlayer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [overs, setOvers] = useState(6);
  const [squads, setSquads] = useState<Record<number, number[]>>({});
  const [scorerId, setScorerId] = useState("");
  const [tossWinnerId, setTossWinnerId] = useState("");
  const [tossDecision, setTossDecision] = useState<"BAT" | "BOWL">("BAT");
  const [opening, setOpening] = useState({ strikerId: "", nonStrikerId: "", bowlerId: "" });
  const [nextBowlerId, setNextBowlerId] = useState("");
  const [panel, setPanel] = useState<"extras" | "wicket" | "correct" | "correct-extra" | "correct-wicket" | null>(null);
  const [extraType, setExtraType] = useState<Exclude<ExtraType, "NONE">>("WIDE");
  const [extraRuns, setExtraRuns] = useState(1);
  const [noBallBatRuns, setNoBallBatRuns] = useState(0);
  const [wicket, setWicket] = useState({ ...EMPTY_WICKET });
  const [isMatchChatOpen, setIsMatchChatOpen] = useState(false);
  const completedScorecardFixtureId = scorecard?.status === "COMPLETED" ? scorecard.fixture_id : null;

  useEffect(() => {
    void loadScorer();
  }, [params.challengeId]);

  useEffect(() => {
    if (!scorecard) return;
    setTossWinnerId((current) => current || String(scorecard.toss.winner_team_id || scorecard.teams[0]?.id || ""));
    setScorerId((current) => current || String(scorecard.scorer.id || ""));
    setSquads((current) => {
      const next = { ...current };
      for (const team of scorecard.teams) {
        if (!next[team.id]?.length && team.players.length) next[team.id] = team.players.map((player) => player.player_id);
      }
      return next;
    });
  }, [scorecard]);

  useEffect(() => {
    if (!room || !scorecard || scorecard.status !== "SETUP") return;
    setSquads((current) => {
      const next = { ...current };
      for (const team of scorecard.teams) {
        if (team.squad_confirmed || next[team.id]?.length) continue;
        const selectedPlayerIds = room.fixture.participants
          .filter((participant) => participant.team === team.id && participant.status === "SELECTED")
          .map((participant) => participant.player);
        if (selectedPlayerIds.length) next[team.id] = selectedPlayerIds;
      }
      return next;
    });
  }, [room, scorecard]);

  useEffect(() => {
    if (!isMatchChatOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMatchChatOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMatchChatOpen]);

  useEffect(() => {
    if (!completedScorecardFixtureId) return;
    router.replace(`/dashboard/player/performance/scorecards/${completedScorecardFixtureId}`);
  }, [completedScorecardFixtureId, router]);

  const activeInnings = useMemo(
    () => scorecard?.innings.find((innings) => innings.id === scorecard.active_innings_id) || null,
    [scorecard],
  );
  const startTeams = useMemo(() => {
    if (!scorecard || !scorecard.can_start_innings) return null;
    const isFirst = scorecard.innings.length === 0;
    const battingTeamId = isFirst ? scorecard.toss.first_batting_team_id : scorecard.toss.second_batting_team_id;
    const bowlingTeamId = isFirst ? scorecard.toss.second_batting_team_id : scorecard.toss.first_batting_team_id;
    return {
      batting: scorecard.teams.find((team) => team.id === battingTeamId) || null,
      bowling: scorecard.teams.find((team) => team.id === bowlingTeamId) || null,
    };
  }, [scorecard]);

  const canOperate = Boolean(scorecard?.permissions.can_score);
  const isCaptain = Boolean(scorecard?.permissions.is_captain);
  const visibleParticipants = room?.fixture.participants.filter((participant) => participant.status === "SELECTED") || [];

  async function loadScorer() {
    setIsLoading(true);
    setError("");
    setRoom(null);
    setScorecard(null);
    setEligiblePlayers([]);
    try {
      const roomResponse = await api.get<RoomResponse>(`/api/team-challenges/challenges/${params.challengeId}/room/`);
      setRoom(roomResponse.data);
      const [scoreResponse, eligibilityResponse] = await Promise.all([
        api.get<{ scorecard: Scorecard | null }>(`/api/scoring/fixtures/${roomResponse.data.fixture.id}/`),
        roomResponse.data.challenge.source === "INSTANT_SCORER"
          && roomResponse.data.fixture.status === "SCHEDULED"
          && roomResponse.data.fixture.scorecard?.status === "SETUP"
          && roomResponse.data.fixture.permissions.is_captain
          ? api.get<{ players: FixtureEligiblePlayer[] }>(`/api/team-challenges/fixtures/${roomResponse.data.fixture.id}/eligible-players/`)
          : Promise.resolve(null),
      ]);
      if (!scoreResponse.data.scorecard && roomResponse.data.fixture.scorecard?.available) {
        setError("This match already has a scorecard, but its live state could not be loaded. Try again to reconnect to the match.");
        return;
      }
      setScorecard(scoreResponse.data.scorecard);
      setEligiblePlayers(eligibilityResponse?.data.players || []);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not open SportSpot Scorer."));
    } finally {
      setIsLoading(false);
    }
  }

  async function mutate(path: string, payload?: Record<string, unknown>, successMessage?: string) {
    if (!room || isSaving) return false;
    setIsSaving(true);
    try {
      const response = await api.post<{ scorecard: Scorecard }>(path, payload);
      setScorecard(response.data.scorecard);
      setPanel(null);
      if (successMessage) emitToast({ message: successMessage, type: "success", dedupeKey: `cricket-scorer-${room.fixture.id}-${path}` });
      return true;
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not save that scoring update."), type: "error", dedupeKey: `cricket-scorer-error-${path}` });
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function setUpScorecard() {
    if (!room || overs < 1 || overs > 50) return;
    await mutate(`/api/scoring/fixtures/${room.fixture.id}/setup/`, { overs_per_innings: overs }, "Scorer setup is ready for both captains.");
  }

  async function confirmSquad(teamId: number) {
    if (!room || !squads[teamId]?.length) return;
    await mutate(`/api/scoring/fixtures/${room.fixture.id}/squad/`, { player_ids: squads[teamId] }, "Your match squad is confirmed.");
  }

  function toggleSquadPlayer(teamId: number, playerId: number) {
    setSquads((current) => {
      const selected = current[teamId] || [];
      return {
        ...current,
        [teamId]: selected.includes(playerId) ? selected.filter((id) => id !== playerId) : [...selected, playerId],
      };
    });
  }

  function prepareStart() {
    if (!startTeams?.batting || !startTeams.bowling) return;
    setOpening({
      strikerId: String(startTeams.batting.players[0]?.id || ""),
      nonStrikerId: String(startTeams.batting.players[1]?.id || ""),
      bowlerId: String(startTeams.bowling.players[0]?.id || ""),
    });
  }

  async function startSelectedInnings() {
    if (!room || !opening.strikerId || !opening.nonStrikerId || !opening.bowlerId) return;
    await mutate(`/api/scoring/fixtures/${room.fixture.id}/innings/start/`, {
      striker_id: Number(opening.strikerId),
      non_striker_id: Number(opening.nonStrikerId),
      bowler_id: Number(opening.bowlerId),
    }, "Innings started.");
  }

  async function scoreRuns(runs: number, correction = false) {
    if (!room) return;
    await mutate(
      `/api/scoring/fixtures/${room.fixture.id}/deliveries/${correction ? "edit/" : ""}`,
      { runs_off_bat: runs },
    );
  }

  async function saveExtra() {
    if (!room) return;
    await mutate(`/api/scoring/fixtures/${room.fixture.id}/deliveries/${panel === "correct-extra" ? "edit/" : ""}`, {
      runs_off_bat: extraType === "NO_BALL" ? noBallBatRuns : 0,
      extra_type: extraType,
      extra_runs: extraRuns,
    });
  }

  async function saveWicket() {
    if (!room || !activeInnings || !wicket.dismissedPlayerId) return;
    const battingPlayers = scorecard?.teams.find((team) => team.id === activeInnings.batting_team_id)?.players || [];
    const needsIncoming = activeInnings.wickets + 1 < battingPlayers.length - 1;
    await mutate(`/api/scoring/fixtures/${room.fixture.id}/deliveries/${panel === "correct-wicket" ? "edit/" : ""}`, {
      wicket_kind: wicket.kind,
      dismissed_player_id: Number(wicket.dismissedPlayerId),
      fielder_id: wicket.fielderId ? Number(wicket.fielderId) : null,
      // A stale hidden selection must never be sent after the final wicket.
      incoming_batsman_id: needsIncoming && wicket.incomingPlayerId ? Number(wicket.incomingPlayerId) : null,
    });
  }

  if (isLoading) return <ScorerSkeleton />;
  if (!room) return <ScorerError error={error} onRetry={() => void loadScorer()} />;
  if (!scorecard && error) return <ScorerError error={error} onRetry={() => void loadScorer()} />;
  if (completedScorecardFixtureId) return <ScorerSkeleton />;

  const { challenge, fixture } = room;
  const isInstantScorerMatch = challenge.source === "INSTANT_SCORER";
  const scorerHomeHref = "/scorer";
  const needsLineups = scorecard && scorecard.status === "SETUP" && scorecard.teams.some((team) => !team.squad_confirmed);
  const needsScorer = scorecard && scorecard.status === "SETUP" && scorecard.teams.every((team) => team.squad_confirmed) && !scorecard.scorer.id;
  const needsToss = scorecard && scorecard.status === "SETUP" && scorecard.teams.every((team) => team.squad_confirmed) && !scorecard.toss.winner_team_id;
  const showStart = Boolean(scorecard?.can_start_innings);
  const lastDelivery = activeInnings?.deliveries.at(-1) || null;
  const currentStage = !scorecard ? 1 : needsLineups ? 2 : needsScorer || needsToss ? 3 : 4;

  return (
    <main className="min-h-screen bg-[var(--sport-canvas)] px-3 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl space-y-5 sm:space-y-6">
        <div className="flex items-center justify-between gap-4">
          <BackButton href={isInstantScorerMatch ? scorerHomeHref : `/challenge-teams/${challenge.id}/room`} label={isInstantScorerMatch ? "Back to Cricket Scorer" : "Back to game room"} />
          <span className="hidden text-xs font-bold uppercase tracking-[0.14em] text-slate-400 sm:block">Match centre</span>
        </div>

        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            {scorecard ? <><p className="sport-eyebrow">Match centre</p><p className="mt-1 truncate text-sm font-semibold text-slate-600">Ball-by-ball match control</p></> : <><p className="sport-eyebrow">{isInstantScorerMatch ? "Instant scored match" : "Team match"}</p><h1 className="sport-page-title mt-1">Set up match</h1><p className="sport-page-description truncate">{challenge.challenger_team.name} <span className="text-slate-400">vs</span> {challenge.challenged_team?.name || "Opposing team"}{isInstantScorerMatch ? " / no booking attached" : ""}</p></>}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {scorecard?.status === "COMPLETED" ? <span className="sport-status border-green-200 bg-green-50 text-sportGreen">Final scorecard</span> : scorecard ? <span className="sport-status border-blue-200 bg-blue-50 text-blue-800">{statusLabel(scorecard.status)}</span> : <span className="sport-status border-slate-200 bg-white text-slate-700">Not started</span>}
            {isInstantScorerMatch ? <button className="sport-secondary-button" onClick={() => setIsMatchChatOpen(true)} type="button">Match chat</button> : <Link className="sport-secondary-button" href={`/challenge-teams/${challenge.id}/room`}>Game room</Link>}
          </div>
        </header>

        {!scorecard ? fixture.scorecard?.can_set_up ? <SetupCard overs={overs} setOvers={setOvers} canSetUp isSaving={isSaving} onSetUp={() => void setUpScorecard()} /> : <ScorerWaitingCard onRetry={() => void loadScorer()} /> : null}

        {scorecard ? <>
          <LiveScoreHeader scorecard={scorecard} activeInnings={activeInnings} />
          {scorecard.status !== "COMPLETED" ? <ScorerProgress currentStage={currentStage} /> : null}

          <div className="space-y-4">
          {needsLineups ? <LineupStep eligiblePlayers={eligiblePlayers} isInstantScorerMatch={isInstantScorerMatch} scorecard={scorecard} visibleParticipants={visibleParticipants} isSaving={isSaving} squads={squads} onToggle={toggleSquadPlayer} onConfirm={(teamId) => void confirmSquad(teamId)} /> : null}

          {needsScorer ? <section className="sport-surface overflow-hidden"><div className="border-b border-slate-200 bg-slate-50/70 p-5 sm:p-6"><StepHeading index="2" title="Choose the match scorer" text="Both squads are ready. Select one confirmed player to keep the scorecard." /></div><div className="p-5 sm:p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="block min-w-0 flex-1 text-sm font-bold text-sportNavy">Scorer<select className="sport-field mt-1 w-full" onChange={(event) => setScorerId(event.target.value)} value={scorerId}><option value="">Choose a confirmed player</option>{scorecard.teams.flatMap((team) => team.players).map((player) => <option key={player.id} value={player.player_id}>{player.name}</option>)}</select></label><button className="sport-primary-button w-full sm:w-auto" disabled={!isCaptain || !scorerId || isSaving} onClick={() => void mutate(`/api/scoring/fixtures/${fixture.id}/scorer/`, { scorer_id: Number(scorerId) }, "Scorer assigned.")} type="button">Assign scorer</button></div>{!isCaptain ? <ReadOnlyNote text="A team captain appoints a scorer from the confirmed squads." /> : null}</div></section> : null}

          {needsToss ? <section className="sport-surface overflow-hidden"><div className="border-b border-slate-200 bg-slate-50/70 p-5 sm:p-6"><StepHeading index="3" title="Record toss" text="Capture the match-day decision before the first ball." /></div><div className="grid gap-5 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"><label className="block text-sm font-bold text-sportNavy">Toss winner<select className="sport-field mt-1 w-full" onChange={(event) => setTossWinnerId(event.target.value)} value={tossWinnerId}>{scorecard.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><fieldset><legend className="text-sm font-bold text-sportNavy">Decision</legend><div className="mt-2 grid grid-cols-2 gap-2"><button className={`min-h-11 rounded-lg border px-3 text-sm font-black transition ${tossDecision === "BAT" ? "border-sportGreen bg-green-50 text-sportGreen ring-2 ring-green-100" : "border-slate-200 bg-white text-slate-700 hover:border-green-300"}`} onClick={() => setTossDecision("BAT")} type="button">Bat</button><button className={`min-h-11 rounded-lg border px-3 text-sm font-black transition ${tossDecision === "BOWL" ? "border-sportGreen bg-green-50 text-sportGreen ring-2 ring-green-100" : "border-slate-200 bg-white text-slate-700 hover:border-green-300"}`} onClick={() => setTossDecision("BOWL")} type="button">Bowl</button></div></fieldset><button className="sport-primary-button w-full md:w-auto" disabled={!canOperate || !tossWinnerId || isSaving} onClick={() => void mutate(`/api/scoring/fixtures/${fixture.id}/toss/`, { winner_team_id: Number(tossWinnerId), decision: tossDecision }, "Toss recorded.")} type="button">Save toss</button></div>{!canOperate ? <div className="px-5 pb-5 sm:px-6 sm:pb-6"><ReadOnlyNote text="The appointed scorer or a team captain records the toss." /></div> : null}</section> : null}

          {showStart && startTeams?.batting && startTeams.bowling ? <section className="sport-surface overflow-hidden"><div className="border-b border-slate-200 bg-slate-50/70 p-5 sm:p-6"><StepHeading index="4" title={scorecard.innings.length ? "Start the chase" : "Start first innings"} text={`${startTeams.batting.name} will bat. Confirm the opening players, then enter the match.`} /></div><div className="p-5 sm:p-6"><div className="grid gap-3 md:grid-cols-3"><PlayerSelect label="Striker" players={startTeams.batting.players} onChange={(value) => setOpening((current) => ({ ...current, strikerId: value }))} value={opening.strikerId} /><PlayerSelect label="Non-striker" players={startTeams.batting.players} onChange={(value) => setOpening((current) => ({ ...current, nonStrikerId: value }))} value={opening.nonStrikerId} /><PlayerSelect label="Opening bowler" players={startTeams.bowling.players} onChange={(value) => setOpening((current) => ({ ...current, bowlerId: value }))} value={opening.bowlerId} /></div><div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between"><button className="sport-secondary-button w-full sm:w-auto" disabled={!canOperate || isSaving} onClick={prepareStart} type="button">Use first listed players</button><button className="sport-primary-button w-full sm:w-auto" disabled={!canOperate || isSaving || !opening.strikerId || !opening.nonStrikerId || !opening.bowlerId || opening.strikerId === opening.nonStrikerId} onClick={() => void startSelectedInnings()} type="button">Start innings</button></div>{!canOperate ? <ReadOnlyNote text="The appointed scorer or a team captain starts the innings." /> : null}</div></section> : null}

          </div>

          {activeInnings ? <section className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              {activeInnings.current_bowler_id ? <ScoringConsole innings={activeInnings} canOperate={canOperate} isSaving={isSaving} lastDelivery={lastDelivery} panel={panel} setPanel={setPanel} onWicketClick={() => { if (panel === "wicket" || panel === "correct-wicket") { setPanel(null); return; } setWicket({ ...EMPTY_WICKET }); setPanel(panel === "correct" ? "correct-wicket" : "wicket"); }} onRun={(runs, correction) => void scoreRuns(runs, correction)} onUndo={() => void mutate(`/api/scoring/fixtures/${fixture.id}/deliveries/undo/`, undefined, "Last ball undone.")} /> : <NextBowlerPanel innings={activeInnings} scorecard={scorecard} nextBowlerId={nextBowlerId} setNextBowlerId={setNextBowlerId} canOperate={canOperate} isSaving={isSaving} onChoose={() => void mutate(`/api/scoring/fixtures/${fixture.id}/innings/bowler/`, { bowler_id: Number(nextBowlerId) }, "Next bowler set.")} />}
              {panel === "extras" || panel === "correct-extra" ? <ExtrasPanel correction={panel === "correct-extra"} extraRuns={extraRuns} extraType={extraType} isSaving={isSaving} noBallBatRuns={noBallBatRuns} onCancel={() => setPanel(null)} onSave={() => void saveExtra()} onSetBatRuns={setNoBallBatRuns} onSetRuns={setExtraRuns} onSetType={setExtraType} /> : null}
              {panel === "wicket" || panel === "correct-wicket" ? <WicketPanel correction={panel === "correct-wicket"} innings={activeInnings} scorecard={scorecard} wicket={wicket} isSaving={isSaving} onCancel={() => setPanel(null)} onChange={setWicket} onSave={() => void saveWicket()} /> : null}
            </div>
            <MatchContext innings={activeInnings} scorecard={scorecard} />
          </section> : null}

          {scorecard.status === "COMPLETED" ? <section className="rounded-xl border border-green-200 bg-green-50 p-5 sm:p-6"><p className="sport-eyebrow text-green-800">Match complete</p><h2 className="mt-1 text-2xl font-black text-green-950">{scorecard.result}</h2><p className="mt-2 text-sm leading-6 text-green-900">{isInstantScorerMatch ? "The finalized scorecard now contributes to the cricket records of the confirmed match squads." : "Captains still record attendance for their own rosters and acknowledge this result in the Game Room."}</p>{isInstantScorerMatch ? <Link className="sport-primary-button mt-4" href={scorerHomeHref}>Back to Cricket Scorer</Link> : <Link className="sport-primary-button mt-4" href={`/challenge-teams/${challenge.id}/room`}>Return to game room</Link>}</section> : null}

          {scorecard.innings.length ? <section className="space-y-4"><div><p className="sport-eyebrow">Scorecard</p><h2 className="mt-1 text-xl font-black text-sportNavy">Match summary</h2></div>{scorecard.innings.map((innings) => <InningsScorecard key={innings.id} innings={innings} />)}</section> : null}
        </> : null}
        {isInstantScorerMatch && isMatchChatOpen ? <div className="fixed inset-0 z-50" role="presentation"><button aria-label="Close match chat" className="absolute inset-0 bg-sportNavy/35 backdrop-blur-[2px]" onClick={() => setIsMatchChatOpen(false)} type="button" /><aside aria-labelledby="game-chat-heading" aria-modal="true" className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col overflow-y-auto rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:inset-y-4 sm:right-4 sm:left-auto sm:bottom-auto sm:w-[min(430px,calc(100vw-2rem))] sm:rounded-2xl" role="dialog"><GameRoomChat canSend={scorecard?.status !== "COMPLETED"} embedded onClose={() => setIsMatchChatOpen(false)} target={{ kind: "fixture", id: fixture.id }} /></aside></div> : null}
      </div>
    </main>
  );
}

function SetupCard({ overs, setOvers, canSetUp, isSaving, onSetUp }: { overs: number; setOvers: (value: number) => void; canSetUp: boolean; isSaving: boolean; onSetUp: () => void }) {
  return <section className="sport-surface overflow-hidden" aria-labelledby="setup-scorecard-title">
    <div className="border-b border-slate-200 bg-sportNavy px-5 py-6 text-white sm:px-7">
      <div className="flex items-start gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-400/15 text-xl font-black text-green-300">1</span><div><p className="text-xs font-black uppercase tracking-[0.16em] text-green-300">Match day setup</p><h2 className="mt-1 text-2xl font-black" id="setup-scorecard-title">Set up the scorecard</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Set the match format first. The captains will then confirm squads, record the toss, and open the first innings.</p></div></div>
    </div>
    <div className="p-5 sm:p-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0"><p className="text-sm font-black text-sportNavy">Overs per innings</p><p className="mt-1 text-sm text-slate-600">Choose a quick format or enter any value from 1 to 50 overs.</p><div className="mt-3 flex flex-wrap gap-2">{[5, 6, 10, 20].map((format) => <button className={`min-h-10 rounded-lg border px-4 text-sm font-black transition ${overs === format ? "border-sportGreen bg-green-50 text-sportGreen ring-2 ring-green-100" : "border-slate-200 bg-white text-slate-700 hover:border-green-300"}`} key={format} onClick={() => setOvers(format)} type="button">{format} overs</button>)}</div></div>
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end lg:max-w-[27rem]"><label className="block min-w-0 flex-1 text-sm font-bold text-sportNavy">Custom overs<input aria-label="Overs per innings" className="sport-field mt-1 w-full" max="50" min="1" onChange={(event) => setOvers(Number(event.target.value) || 1)} type="number" value={overs} /></label><button className="sport-primary-button w-full sm:w-auto" disabled={!canSetUp || isSaving || overs < 1 || overs > 50} onClick={onSetUp} type="button">{isSaving ? "Setting up..." : "Set up scorer"}</button></div>
      </div>
      {!canSetUp ? <ReadOnlyNote text="A captain can open scoring once this team match is scheduled." /> : null}
    </div>
  </section>;
}

function ScorerWaitingCard({ onRetry }: { onRetry: () => void }) {
  return <section className="sport-surface flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6" role="status"><div><p className="sport-eyebrow">Waiting for match setup</p><h2 className="mt-1 text-xl font-black text-sportNavy">The captain has not opened the scorecard yet</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">Only a team captain can choose the overs and open scoring. This page will show the live scorecard as soon as setup is complete.</p></div><button className="sport-secondary-button w-full shrink-0 sm:w-auto" onClick={onRetry} type="button">Refresh status</button></section>;
}

function LiveScoreHeader({ scorecard, activeInnings }: { scorecard: Scorecard; activeInnings: Innings | null }) {
  const displayed = activeInnings || scorecard.innings.at(-1) || null;
  const firstTeam = scorecard.teams[0];
  const secondTeam = scorecard.teams[1];
  const battingTeamId = displayed?.batting_team_id || scorecard.toss.first_batting_team_id;
  const score = displayed ? `${displayed.total_runs}/${displayed.wickets}` : "-/-";
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Match scoreboard">
    <div className="bg-sportNavy px-5 py-5 text-white sm:px-8 sm:py-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-green-400" /><p className="text-xs font-black uppercase tracking-[0.16em] text-green-300">{displayed ? (scorecard.status === "INNINGS_BREAK" ? "Innings break" : "Live score") : "Pre-match"}</p></div><p className="text-xs font-bold text-slate-300">{scorecard.overs_per_innings} overs per innings</p></div>
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-8">
        <TeamScore team={firstTeam} active={battingTeamId === firstTeam?.id} side="left" />
        <div className="min-w-[5.5rem] text-center"><p className="text-4xl font-black tracking-tight sm:text-5xl">{score}</p><p className="mt-1 text-xs font-bold text-slate-300">{displayed ? `${displayed.overs} overs` : "Awaiting first ball"}</p>{scorecard.chase ? <p className="mt-2 text-xs font-black text-green-300">Target {scorecard.chase.target}</p> : null}</div>
        <TeamScore team={secondTeam} active={battingTeamId === secondTeam?.id} side="right" />
      </div>
      <p className="mt-5 text-center text-xs font-semibold text-slate-300">{scorecard.toss.winner_team_name ? `${scorecard.toss.winner_team_name} won the toss and chose to ${scorecard.toss.decision.toLowerCase()}` : "Confirm squads and toss to start the match"}</p>
    </div>
    <div className="grid divide-y divide-slate-200 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
      <Metric label="Status" value={statusLabel(scorecard.status)} detail={scorecard.scorer.name ? `Scorer: ${scorecard.scorer.name}` : "Scorer not assigned"} />
      <Metric label="Current batters" value={displayed?.current_striker_name || "Not started"} detail={displayed?.current_non_striker_name ? `Non-striker: ${displayed.current_non_striker_name}` : ""} />
      <Metric label={scorecard.chase ? "Required rate" : "Run rate"} value={scorecard.chase ? `${scorecard.chase.required_run_rate}` : displayed ? `${displayed.run_rate}` : "-"} detail={scorecard.chase ? `${scorecard.chase.runs_needed} needed` : "runs per over"} />
      <Metric label={scorecard.chase ? "Balls remaining" : "Extras"} value={scorecard.chase ? `${scorecard.chase.balls_remaining}` : displayed ? `${displayed.extras.total}` : "0"} detail={scorecard.chase ? "to reach the target" : "runs"} />
    </div>
  </section>;
}

function teamInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.length > 1 ? `${words[0][0]}${words[1][0]}`.toUpperCase() : name.slice(0, 2).toUpperCase();
}

function TeamScore({ team, active, side }: { team?: ScorecardTeam; active: boolean; side: "left" | "right" }) {
  const name = team?.name || "Team";
  const logo = <MediaImage alt={`${name} team logo`} className="h-11 w-11 shrink-0 rounded-xl border border-white/20 bg-white object-contain p-1" fallback={<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-xs font-black text-green-200">{teamInitials(name)}</span>} source={team?.team_photo} />;
  return <div className={`${side === "right" ? "text-right" : "text-left"} min-w-0`}><div className={`flex items-center gap-3 ${side === "right" ? "justify-end" : ""}`}>{side === "right" ? <><p className="truncate text-sm font-black sm:text-base">{name}</p>{logo}</> : <>{logo}<p className="truncate text-sm font-black sm:text-base">{name}</p></>}</div><p className={`mt-2 text-[11px] font-bold uppercase tracking-[0.12em] ${active ? "text-green-300" : "text-slate-400"}`}>{active ? "Batting" : "Waiting"}</p></div>;
}

function ScorerProgress({ currentStage }: { currentStage: number }) {
  const steps = ["Format", "Squads", "Toss", "First ball"];
  return <section className="sport-surface px-4 py-4 sm:px-6" aria-label="Scoring progress"><ol className="grid grid-cols-4 gap-2">{steps.map((step, index) => { const number = index + 1; const complete = currentStage > number; const active = currentStage === number; return <li className="min-w-0" key={step}><div className="flex items-center gap-2"><span aria-label={complete ? `${step} complete` : active ? `${step}, current step` : `Step ${number}: ${step}`} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${complete || active ? "bg-sportGreen text-white" : "bg-slate-100 text-slate-500"}`}>{complete ? <span aria-hidden="true">✓</span> : number}</span><span className={`hidden truncate text-xs font-black sm:block ${active ? "text-sportNavy" : complete ? "text-slate-700" : "text-slate-500"}`}>{step}</span></div><div className={`mt-2 h-1 rounded-full ${complete || active ? "bg-sportGreen" : "bg-slate-200"}`} /></li>; })}</ol></section>;
}

function LineupStep({ eligiblePlayers, isInstantScorerMatch, scorecard, visibleParticipants, isSaving, squads, onToggle, onConfirm }: { eligiblePlayers: FixtureEligiblePlayer[]; isInstantScorerMatch: boolean; scorecard: Scorecard; visibleParticipants: TeamFixtureParticipant[]; isSaving: boolean; squads: Record<number, number[]>; onToggle: (teamId: number, playerId: number) => void; onConfirm: (teamId: number) => void }) {
  return <section className="sport-surface overflow-hidden" aria-labelledby="confirm-squads-title">
    <div className="border-b border-slate-200 bg-slate-50/70 p-5 sm:p-6"><StepHeading index="1" title="Confirm match squads" text="Each captain locks the players taking part today. This match-day snapshot does not change the permanent team roster." /></div>
    <div className="grid gap-4 p-5 sm:p-6 lg:grid-cols-2">{scorecard.teams.map((team) => { const isOwnTeam = scorecard.permissions.team_id === team.id; const selected = squads[team.id] || []; const candidates = isInstantScorerMatch && isOwnTeam && !team.squad_confirmed ? eligiblePlayers.map((player) => ({ id: player.player_id, player: player.player_id, player_name: player.player_name })) : visibleParticipants.filter((participant) => participant.team === team.id); return <div className={`rounded-lg border p-4 ${team.squad_confirmed ? "border-green-200 bg-green-50/40" : "border-slate-200 bg-white"}`} key={team.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-sportNavy">{teamInitials(team.name)}</span><h3 className="truncate font-black text-sportNavy">{team.name}</h3></div><p className="mt-3 text-sm font-semibold text-slate-600">{team.squad_confirmed ? `${team.players.length} players confirmed` : `${selected.length} players selected`}</p></div><span className={`sport-status ${team.squad_confirmed ? "border-green-200 bg-white text-sportGreen" : "border-slate-200 bg-slate-50 text-slate-700"}`}>{team.squad_confirmed ? "Confirmed" : isOwnTeam ? "Your squad" : "Awaiting"}</span></div><div className="mt-4 divide-y divide-slate-100 border-y border-slate-100">{candidates.length ? candidates.map((participant) => <label className="flex min-h-11 items-center gap-3 py-2 text-sm font-bold text-sportNavy" key={participant.id}><input className="h-4 w-4 accent-sportGreen" checked={selected.includes(participant.player)} disabled={team.squad_confirmed || !isOwnTeam || isSaving} onChange={() => onToggle(team.id, participant.player)} type="checkbox" /><span className="min-w-0 truncate">{participant.player_name}</span></label>) : <p className="py-4 text-sm text-slate-600">{isOwnTeam && isInstantScorerMatch ? "No active permanent team members are available." : "Awaiting this team's captain."}</p>}</div>{!team.squad_confirmed && isOwnTeam ? <button className="sport-primary-button mt-4 w-full" disabled={selected.length < 2 || isSaving} onClick={() => onConfirm(team.id)} type="button">Confirm {selected.length} players</button> : null}</div>; })}</div>
    <div className="border-t border-slate-200 px-5 py-4 sm:px-6"><p className="text-xs leading-5 text-slate-500">{isInstantScorerMatch ? "Captains select active registered members from their own team. This match-only squad never changes a permanent roster." : "Only selected fixture players are eligible. Fill My Squad players are not silently added to a Team Challenge scorecard."}</p></div>
  </section>;
}

function ScoringConsole({ innings, canOperate, isSaving, lastDelivery, panel, setPanel, onWicketClick, onRun, onUndo }: { innings: Innings; canOperate: boolean; isSaving: boolean; lastDelivery: Delivery | null; panel: "extras" | "wicket" | "correct" | "correct-extra" | "correct-wicket" | null; setPanel: (value: "extras" | "wicket" | "correct" | "correct-extra" | "correct-wicket" | null) => void; onWicketClick: () => void; onRun: (runs: number, correction: boolean) => void; onUndo: () => void }) {
  const overNumber = Math.floor(innings.legal_balls / 6) + 1;
  return <section className="sport-surface overflow-hidden" aria-labelledby="live-scoring-title">
    <div className="flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6"><div><p className="sport-eyebrow">Live scoring</p><h2 className="mt-1 text-xl font-black text-sportNavy" id="live-scoring-title">{innings.current_striker_name} on strike</h2><p className="mt-1 text-sm font-semibold text-slate-600">Record the next delivery. {innings.current_non_striker_name} is at the non-striker&apos;s end.</p></div><div className="flex flex-wrap gap-2 sm:justify-end"><button className="sport-secondary-button min-h-10 px-3 text-sm" disabled={!canOperate || isSaving || !lastDelivery} onClick={onUndo} type="button">Undo</button><button className="sport-secondary-button min-h-10 px-3 text-sm" disabled={!canOperate || isSaving || !lastDelivery} onClick={() => setPanel(panel === "correct" ? null : "correct")} type="button">Correct last ball</button></div></div>
    <div className="grid gap-px bg-slate-200 sm:grid-cols-3"><ScoringRole label="Striker" name={innings.current_striker_name} detail="On strike" active /><ScoringRole label="Non-striker" name={innings.current_non_striker_name} detail="At the other end" /><ScoringRole label="Bowler" name={innings.current_bowler_name} detail="Current over" /></div>
    <div className="p-5 sm:p-6"><div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Current over</p><p className="mt-1 text-lg font-black text-sportNavy">Over {overNumber}</p></div><p className="text-sm font-bold text-slate-500">{innings.last_over.length} of 6 balls recorded</p></div><div className="mt-3 flex min-h-11 flex-wrap items-center gap-2">{innings.last_over.length ? innings.last_over.map((token, index) => <span className={`inline-flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-sm font-black ${token === "W" ? "bg-red-100 text-red-800" : token.includes("wd") || token.includes("nb") ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-sportNavy"}`} key={`${token}-${index}`}>{token}</span>) : <span className="text-sm text-slate-500">No deliveries in this over yet.</span>}</div>{canOperate ? <>{panel === "correct" ? <div className="mt-5 border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950" role="status">Choose the replacement outcome for the latest ball.</div> : null}<div className="mt-6 grid grid-cols-4 gap-2 sm:grid-cols-7">{[0, 1, 2, 3, 4, 5, 6].map((runs) => <button className="min-h-16 rounded-lg border border-slate-200 bg-white text-xl font-black text-sportNavy transition hover:border-sportGreen hover:bg-green-50 focus-visible:ring-2 focus-visible:ring-green-200 disabled:cursor-not-allowed disabled:opacity-50" disabled={isSaving} key={runs} onClick={() => onRun(runs, panel === "correct")} title={`Record ${runs} runs`} type="button">{runs}</button>)}</div><div className="mt-3 grid gap-2 sm:grid-cols-2"><button className="min-h-12 rounded-lg border border-blue-200 bg-blue-50 px-4 text-sm font-black text-blue-900 transition hover:bg-blue-100 disabled:opacity-50" disabled={isSaving} onClick={() => setPanel(panel === "correct" ? "correct-extra" : panel === "extras" ? null : "extras")} type="button">Extras</button><button className="min-h-12 rounded-lg border border-red-200 bg-red-50 px-4 text-sm font-black text-red-800 transition hover:bg-red-100 disabled:opacity-50" disabled={isSaving} onClick={onWicketClick} type="button">Wicket</button></div></> : <ReadOnlyNote text="Live scoring is restricted to either captain or the appointed scorer." />}</div>
  </section>;
}

function ScoringRole({ label, name, detail, active = false }: { label: string; name: string; detail: string; active?: boolean }) {
  return <div className="min-w-0 bg-white p-4 sm:p-5"><p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="mt-2 truncate text-sm font-black text-sportNavy">{name || "Not selected"}</p><p className={`mt-1 text-xs font-bold ${active ? "text-sportGreen" : "text-slate-500"}`}>{active ? "Active - " : ""}{detail}</p></div>;
}

function ExtrasPanel({ correction, extraRuns, extraType, isSaving, noBallBatRuns, onCancel, onSave, onSetBatRuns, onSetRuns, onSetType }: { correction: boolean; extraRuns: number; extraType: Exclude<ExtraType, "NONE">; isSaving: boolean; noBallBatRuns: number; onCancel: () => void; onSave: () => void; onSetBatRuns: (value: number) => void; onSetRuns: (value: number) => void; onSetType: (value: Exclude<ExtraType, "NONE">) => void }) {
  return <section className="rounded-lg border border-blue-200 bg-blue-50 p-4 sm:p-5" aria-label={correction ? "Correct last ball" : "Record an extra"}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-blue-700">{correction ? "Ball correction" : "Additional runs"}</p><h3 className="mt-1 font-black text-blue-950">{correction ? "Replace the last ball" : "Record an extra"}</h3></div><button className="text-sm font-bold text-blue-700 hover:text-blue-950" disabled={isSaving} onClick={onCancel} type="button">Cancel</button></div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{(["WIDE", "NO_BALL", "BYE", "LEG_BYE"] as const).map((type) => <button className={`min-h-10 rounded-lg border px-2 text-xs font-black transition ${extraType === type ? "border-blue-700 bg-white text-blue-950 ring-2 ring-blue-100" : "border-blue-100 bg-blue-50 text-blue-800 hover:bg-white"}`} key={type} onClick={() => onSetType(type)} type="button">{extraLabel(type)}</button>)}</div><div className="mt-4 grid gap-3 sm:grid-cols-2"><NumberField label="Extra runs" max={7} min={1} onChange={onSetRuns} value={extraRuns} />{extraType === "NO_BALL" ? <NumberField label="Runs off bat" max={6} min={0} onChange={onSetBatRuns} value={noBallBatRuns} /> : null}</div><button className="sport-primary-button mt-4 w-full sm:w-auto" disabled={isSaving || extraRuns < 1} onClick={onSave} type="button">{correction ? "Save correction" : "Record extra"}</button></section>;
}

function WicketPanel({ correction, innings, scorecard, wicket, isSaving, onCancel, onChange, onSave }: { correction: boolean; innings: Innings; scorecard: Scorecard; wicket: { kind: WicketKind; dismissedPlayerId: string; fielderId: string; incomingPlayerId: string }; isSaving: boolean; onCancel: () => void; onChange: (value: { kind: WicketKind; dismissedPlayerId: string; fielderId: string; incomingPlayerId: string }) => void; onSave: () => void }) {
  const batting = scorecard.teams.find((team) => team.id === innings.batting_team_id)?.players || [];
  const bowling = scorecard.teams.find((team) => team.id === innings.bowling_team_id)?.players || [];
  const needsFielder = ["CAUGHT", "RUN_OUT", "STUMPED"].includes(wicket.kind);
  const dismissed = wicket.dismissedPlayerId ? Number(wicket.dismissedPlayerId) : null;
  const incoming = batting.filter((player) => player.id !== innings.current_striker_id && player.id !== innings.current_non_striker_id && player.id !== dismissed);
  const needsIncoming = innings.wickets + 1 < batting.length - 1;
  return <section className="rounded-lg border border-red-200 bg-red-50 p-4 sm:p-5" aria-label={correction ? "Correct last ball as a wicket" : "Record wicket"}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-red-700">{correction ? "Ball correction" : "Dismissal"}</p><h3 className="mt-1 font-black text-red-950">{correction ? "Replace the last ball with a wicket" : "Record wicket"}</h3></div><button className="text-sm font-bold text-red-700 hover:text-red-950" disabled={isSaving} onClick={onCancel} type="button">Cancel</button></div><p className="mt-2 text-sm leading-6 text-red-900">{needsIncoming ? "Choose the next batter who will enter after this dismissal." : "This is the final wicket for the confirmed lineup. Recording it will end the innings; no incoming batter is required."}</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="block text-sm font-bold text-red-950">Dismissal<select className="sport-field mt-1 w-full bg-white" onChange={(event) => onChange({ ...wicket, kind: event.target.value as WicketKind })} value={wicket.kind}>{WICKET_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><PlayerSelect label="Dismissed batter" players={batting.filter((player) => player.id === innings.current_striker_id || player.id === innings.current_non_striker_id)} onChange={(value) => onChange({ ...wicket, dismissedPlayerId: value })} value={wicket.dismissedPlayerId} /></div><div className="mt-3 grid gap-3 sm:grid-cols-2">{needsFielder ? <PlayerSelect label="Fielder" players={bowling} onChange={(value) => onChange({ ...wicket, fielderId: value })} value={wicket.fielderId} /> : null}{needsIncoming ? <PlayerSelect label="Incoming batter" players={incoming} onChange={(value) => onChange({ ...wicket, incomingPlayerId: value })} value={wicket.incomingPlayerId} /> : null}</div><button className="mt-4 w-full rounded-md bg-red-700 px-4 py-2.5 text-sm font-black text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto" disabled={isSaving || !wicket.dismissedPlayerId || (needsFielder && !wicket.fielderId) || (needsIncoming && !wicket.incomingPlayerId)} onClick={onSave} type="button">{correction ? "Save correction" : "Record wicket"}</button></section>;
}

function NextBowlerPanel({ innings, scorecard, nextBowlerId, setNextBowlerId, canOperate, isSaving, onChoose }: { innings: Innings; scorecard: Scorecard; nextBowlerId: string; setNextBowlerId: (value: string) => void; canOperate: boolean; isSaving: boolean; onChoose: () => void }) {
  const bowlers = scorecard.teams.find((team) => team.id === innings.bowling_team_id)?.players || [];
  return <section className="sport-surface overflow-hidden"><div className="border-b border-slate-200 bg-slate-50/70 p-5 sm:p-6"><p className="sport-eyebrow">Over complete</p><h2 className="mt-1 text-xl font-black text-sportNavy">Choose the next bowler</h2><p className="mt-2 text-sm leading-6 text-slate-600">The previous bowler cannot bowl consecutive overs. Choose who will start the next over.</p></div><div className="p-5 sm:p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><PlayerSelect label="Next bowler" players={bowlers} onChange={setNextBowlerId} value={nextBowlerId} /><button className="sport-primary-button w-full sm:w-auto" disabled={!canOperate || !nextBowlerId || isSaving} onClick={onChoose} type="button">Start next over</button></div></div></section>;
}

function MatchContext({ innings, scorecard }: { innings: Innings; scorecard: Scorecard }) {
  return <aside className="space-y-4 lg:sticky lg:top-4"><section className="sport-surface overflow-hidden"><div className="border-b border-slate-200 bg-sportNavy p-5 text-white"><p className="text-xs font-black uppercase tracking-[0.14em] text-green-300">Innings context</p><p className="mt-2 text-3xl font-black">{innings.total_runs}/{innings.wickets}</p><p className="mt-1 text-sm font-semibold text-slate-300">{innings.overs} overs - {innings.batting_team_name}</p></div><dl className="space-y-4 p-5 text-sm"><ContextRow label="Run rate" value={String(innings.run_rate)} /><ContextRow label="Extras" value={String(innings.extras.total)} /><ContextRow label="Partnership" value={`${innings.partnership.runs} runs, ${innings.partnership.balls} balls`} />{scorecard.chase ? <><div className="border-t border-slate-100 pt-4"><ContextRow label="Target" value={String(scorecard.chase.target)} /></div><ContextRow label="Needed" value={`${scorecard.chase.runs_needed} from ${scorecard.chase.balls_remaining} balls`} /><ContextRow label="Required rate" value={String(scorecard.chase.required_run_rate)} /></> : null}</dl></section><section className="sport-surface p-5"><p className="sport-eyebrow">Match details</p><dl className="mt-4 space-y-3 text-sm"><ContextRow label="Toss" value={scorecard.toss.winner_team_name ? `${scorecard.toss.winner_team_name} chose to ${scorecard.toss.decision.toLowerCase()}` : "Not recorded"} />{scorecard.scorer.name ? <ContextRow label="Scorer" value={scorecard.scorer.name} /> : null}</dl></section></aside>;
}

function InningsScorecard({ innings }: { innings: Innings }) {
  return <section className="sport-surface overflow-hidden"><div className="border-b border-slate-200 bg-white px-5 py-5 sm:px-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-50 text-xs font-black text-sportGreen">{innings.number}</span><h3 className="font-black text-sportNavy">{innings.batting_team_name}</h3></div><p className="mt-2 text-sm text-slate-600">{innings.status === "COMPLETED" ? closingLabel(innings.closing_reason) : "In progress"}</p></div><p className="text-2xl font-black text-sportNavy">{innings.total_runs}/{innings.wickets} <span className="text-sm font-bold text-slate-500">({innings.overs})</span></p></div></div><div className="grid gap-0 lg:grid-cols-2"><ScoreTable title="Batting" headings={["Batter", "R", "B", "4s", "6s", "SR"]}>{innings.batting.map((line) => <tr key={line.id}><td className="min-w-44"><p className="font-bold text-sportNavy">{line.name}{line.is_current ? <span className="ml-1 text-green-700">*</span> : null}</p><p className="text-xs text-slate-500">{line.dismissal}</p></td><td>{line.runs}</td><td>{line.balls}</td><td>{line.fours}</td><td>{line.sixes}</td><td>{line.strike_rate}</td></tr>)}</ScoreTable><ScoreTable title="Bowling" headings={["Bowler", "O", "R", "W", "Wd", "Nb", "Econ"]}>{innings.bowling.length ? innings.bowling.map((line) => <tr key={line.id}><td className="font-bold text-sportNavy">{line.name}</td><td>{line.overs}</td><td>{line.runs}</td><td>{line.wickets}</td><td>{line.wides}</td><td>{line.no_balls}</td><td>{line.economy}</td></tr>) : <tr><td className="text-slate-500" colSpan={7}>No completed bowling figures yet.</td></tr>}</ScoreTable></div><div className="border-t border-slate-200 bg-slate-50/60 px-5 py-4 text-sm text-slate-700 sm:px-6"><span className="font-bold text-sportNavy">Extras {innings.extras.total}</span> <span className="text-slate-500">(wd {innings.extras.wides}, nb {innings.extras.no_balls}, b {innings.extras.byes}, lb {innings.extras.leg_byes})</span>{innings.fall_of_wickets.length ? <p className="mt-2"><span className="font-bold text-sportNavy">Fall of wickets:</span> {innings.fall_of_wickets.map((fall) => `${fall.wicket}-${fall.score} (${fall.batter}, ${fall.overs})`).join(", ")}</p> : null}</div></section>;
}

function ScoreTable({ title, headings, children }: { title: string; headings: string[]; children: ReactNode }) { return <div className="overflow-x-auto p-5 sm:p-6"><h4 className="mb-3 text-sm font-black uppercase tracking-[0.1em] text-sportGreen">{title}</h4><table className="w-full min-w-[470px] text-left text-sm [&_td]:px-2 [&_td]:py-3 [&_td]:font-semibold [&_td]:text-slate-700 [&_td:first-child]:pl-0 [&_td:last-child]:pr-0"><thead className="border-y border-slate-200 text-xs uppercase tracking-[0.08em] text-slate-500"><tr>{headings.map((heading) => <th className="px-2 py-2 font-black first:pl-0 last:pr-0" key={heading}>{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{children}</tbody></table></div>; }
function StepHeading({ index, title, text }: { index: string; title: string; text: string }) { return <div className="flex gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 text-sm font-black text-sportGreen">{index}</span><div><h2 className="text-xl font-black text-sportNavy">{title}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{text}</p></div></div>; }
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="min-w-0 px-5 py-4 sm:px-6"><p className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">{label}</p><p className="mt-1 truncate font-black text-sportNavy">{value}</p>{detail ? <p className="mt-1 truncate text-xs font-semibold text-slate-500">{detail}</p> : null}</div>; }
function ContextRow({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-4"><dt className="font-semibold text-slate-600">{label}</dt><dd className="text-right font-black text-sportNavy">{value}</dd></div>; }
function PlayerSelect({ label, players, onChange, value }: { label: string; players: SquadPlayer[]; onChange: (value: string) => void; value: string }) { return <label className="block min-w-0 flex-1 text-sm font-bold text-sportNavy">{label}<select className="sport-field mt-1 w-full" onChange={(event) => onChange(event.target.value)} value={value}><option value="">Choose player</option>{players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>; }
function NumberField({ label, min, max, value, onChange }: { label: string; min: number; max: number; value: number; onChange: (value: number) => void }) { return <label className="block text-sm font-bold text-sportNavy">{label}<input className="sport-field mt-1 w-full bg-white" max={max} min={min} onChange={(event) => onChange(Number(event.target.value) || min)} type="number" value={value} /></label>; }
function ReadOnlyNote({ text }: { text: string }) { return <p className="mt-4 border-l-2 border-slate-300 pl-3 text-sm leading-6 text-slate-600">{text}</p>; }
function ScorerError({ error, onRetry }: { error: string; onRetry: () => void }) { return <main className="min-h-screen bg-[var(--sport-canvas)] px-4 py-10 sm:px-6"><section className="sport-error-state mx-auto max-w-2xl text-center"><p className="sport-eyebrow text-red-700">Scorer unavailable</p><h1 className="mt-1 text-2xl font-black text-red-950">We could not open SportSpot Scorer.</h1><p className="mt-2 text-sm font-semibold text-red-800">{error || "Please try again in a moment."}</p><div className="mt-5 flex flex-wrap justify-center gap-2"><button className="sport-primary-button bg-red-700 hover:bg-red-800" onClick={onRetry} type="button">Try again</button><Link className="sport-secondary-button" href="/scorer">Back to Cricket Scorer</Link></div></section></main>; }
function ScorerSkeleton() { return <main className="min-h-screen bg-[var(--sport-canvas)] px-4 py-8 sm:px-6"><div className="mx-auto max-w-6xl animate-pulse space-y-4"><div className="h-5 w-40 rounded bg-white" /><div className="h-24 rounded-xl bg-white" /><div className="h-52 rounded-xl bg-white" /><div className="h-80 rounded-xl bg-white" /></div></main>; }
function statusLabel(status: MatchStatus) { return ({ SETUP: "Scorer setup", INNINGS_ONE: "First innings", INNINGS_BREAK: "Innings break", INNINGS_TWO: "Second innings", COMPLETED: "Completed" })[status]; }
function closingLabel(reason: string) { return ({ ALL_OUT: "All out", OVERS_COMPLETE: "Overs complete", TARGET_REACHED: "Target reached" } as Record<string, string>)[reason] || "Completed"; }
function extraLabel(type: Exclude<ExtraType, "NONE">) { return ({ WIDE: "Wide", NO_BALL: "No ball", BYE: "Bye", LEG_BYE: "Leg bye" })[type]; }
