"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { emitToast } from "@/lib/toast";
import type { GameResponse, GameRole, JoinRequestResponse, MatchmakingGame } from "@/types/matchmaking";

const fallbackRoles: Array<{ label: string; value: GameRole }> = [
  { label: "Any role", value: "ANY" },
  { label: "Batsman", value: "BATSMAN" },
  { label: "Bowler", value: "BOWLER" },
  { label: "All-rounder", value: "ALL_ROUNDER" },
  { label: "Wicketkeeper", value: "WICKETKEEPER" },
];

export default function GameDetailPage() {
  const params = useParams<{ gameId: string }>();
  const [game, setGame] = useState<MatchmakingGame | null>(null);
  const [requestedRole, setRequestedRole] = useState<GameRole>("ANY");
  const [message, setMessage] = useState("");
  const [attendanceConfirmed, setAttendanceConfirmed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadGame();
    const refreshId = window.setInterval(() => loadGame(true), 30000);
    return () => window.clearInterval(refreshId);
  }, [params.gameId]);

  async function loadGame(silent = false) {
    if (!silent) setIsLoading(true);
    setError("");
    try {
      const response = await api.get<GameResponse>(`/api/matchmaking/games/${params.gameId}/`);
      setGame(response.data.game);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load this game right now."));
    } finally {
      setIsLoading(false);
    }
  }

  const availableRoles = useMemo(() => {
    if (!game) return fallbackRoles;
    const fromProgress = game.role_progress.filter((item) => item.available_count > 0).map((item) => ({ label: item.role_label, value: item.role }));
    return fromProgress.length ? fromProgress : fallbackRoles.filter((role) => role.value === "ANY");
  }, [game]);

  useEffect(() => {
    if (availableRoles.length && !availableRoles.some((role) => role.value === requestedRole)) {
      setRequestedRole(availableRoles[0].value);
    }
  }, [availableRoles, requestedRole]);

  async function requestToJoin() {
    if (!attendanceConfirmed) {
      emitToast({ message: "Confirm that you can attend before sending a request.", type: "warning", dedupeKey: "game-attendance-confirm" });
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await api.post<JoinRequestResponse>(`/api/matchmaking/games/${params.gameId}/request/`, { requested_role: requestedRole, message, attendance_confirmed: attendanceConfirmed });
      emitToast({ message: response.data.request.status === "WAITLISTED" ? "You have joined the waitlist." : "Your request has been sent.", type: "success", dedupeKey: `game-request-${params.gameId}` });
      await loadGame();
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not send your request. Please try again."), type: "error", dedupeKey: `game-request-error-${params.gameId}` });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function reconfirm(response: "RECONFIRM" | "DECLINE") {
    setIsSubmitting(true);
    try {
      await api.post<GameResponse>(`/api/matchmaking/games/${params.gameId}/reconfirm/`, { response });
      emitToast({ message: response === "RECONFIRM" ? "Your spot has been reconfirmed." : "You have declined the updated game plan.", type: "success", dedupeKey: `game-reconfirm-${params.gameId}` });
      await loadGame();
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not update your response."), type: "error", dedupeKey: `game-reconfirm-error-${params.gameId}` });
    } finally {
      setIsSubmitting(false);
    }
  }


  async function respondInvitation(response: "ACCEPT" | "DECLINE") {
    if (!game?.user_state.join_request_id) return;
    setIsSubmitting(true);
    try {
      const invitationResponse = await api.post<JoinRequestResponse>(`/api/matchmaking/requests/${game.user_state.join_request_id}/respond-invitation/`, { response });
      const invitationStatus = invitationResponse.data.request?.status;
      emitToast({
        message: invitationStatus === "EXPIRED"
          ? "This invitation has expired and is no longer available."
          : response === "ACCEPT"
            ? "You have joined the game."
            : "The game invitation has been declined.",
        type: invitationStatus === "EXPIRED" ? "warning" : "success",
        dedupeKey: `game-invite-response-${params.gameId}-${response}`,
      });
      await loadGame();
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not update this invitation."), type: "error", dedupeKey: `game-invite-response-error-${params.gameId}` });
    } finally {
      setIsSubmitting(false);
    }
  }
  async function leave() {
    if (!window.confirm("Leave this game? Your spot may be offered to another player.")) return;
    setIsSubmitting(true);
    try {
      await api.post(`/api/matchmaking/games/${params.gameId}/leave/`);
      emitToast({ message: "You have left this game.", type: "success", dedupeKey: `game-leave-${params.gameId}` });
      await loadGame();
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not update your spot."), type: "error", dedupeKey: `game-leave-error-${params.gameId}` });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) return <main className="min-h-screen bg-slate-50 px-4 py-8"><div className="mx-auto h-[560px] max-w-6xl animate-pulse rounded-3xl bg-white" /></main>;
  if (error || !game) return <main className="min-h-screen bg-slate-50 px-4 py-8"><section className="mx-auto max-w-3xl rounded-2xl border border-red-100 bg-red-50 p-6"><h1 className="text-2xl font-black text-red-950">Game unavailable</h1><p className="mt-2 text-sm font-semibold text-red-700">{error || "This game could not be found."}</p><button className="mt-5 rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white" onClick={() => loadGame()} type="button">Retry</button></section></main>;

  const canRequest = !game.user_state.is_host && !game.user_state.is_participant && !game.user_state.request_status && game.status === "RECRUITING";
  const canWaitlist = !game.user_state.is_host && !game.user_state.is_participant && !game.user_state.request_status && game.status === "FULL" && game.waitlist_enabled;
  const hasRoomAccess = game.user_state.is_host || game.user_state.is_participant;

  return (
    <main className="min-h-screen bg-slate-50">
      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
        <div className="space-y-5">
          <Link className="text-sm font-black text-sportGreen hover:text-green-700" href="/find-game">Back to games</Link>
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap gap-2"><Badge tone="green">{game.game_type === "FILL_SQUAD" ? "Fill My Squad" : "Pickup Game"}</Badge><Badge tone={game.is_booking_verified ? "green" : "blue"}>{game.is_booking_verified ? "Verified SportSpot Booking" : "Planning - Court Not Booked Yet"}</Badge><Badge>{game.game_intensity_label}</Badge></div>
                <h1 className="mt-4 text-3xl font-black tracking-tight text-sportNavy">{game.title}</h1>
                <p className="mt-2 text-sm font-semibold text-slate-600">{game.venue_name} - {game.is_booking_verified ? game.court_name : game.preferred_area}</p>
              </div>
              <StatusBadge game={game} />
            </div>
            {game.description ? <p className="mt-5 max-w-3xl text-sm leading-6 text-slate-600">{game.description}</p> : null}
            <div className="mt-6 grid gap-3 sm:grid-cols-4">
              <InfoCard label="Date & time" value={`${formatDateTime(game.start_at)} - ${game.booking_display_time}`} />
              <InfoCard label="Roster" value={`${game.occupied_spots_count}/${game.total_capacity}`} />
              <InfoCard label="Minimum" value={`${game.minimum_players_to_proceed} players`} />
              <InfoCard label="Skill" value={formatSkill(game.min_skill_level)} />
            </div>
            {!game.is_booking_verified ? <p className="mt-5 rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">This is a planning game. Accepted players are provisional until the host books a court and confirms the final details.</p> : null}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black text-sportNavy">{game.game_type === "FILL_SQUAD" ? "Temporary roles needed" : "Role-wise recruitment"}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {game.role_progress.map((item) => <div className="rounded-2xl border border-slate-200 p-4" key={item.role}><div className="flex items-center justify-between"><p className="font-black text-sportNavy">{item.role_label}</p><Badge tone={item.is_filled ? "green" : "slate"}>{item.is_filled ? "Filled" : `${item.filled_count}/${item.required_count}`}</Badge></div><div className="mt-3 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-sportGreen" style={{ width: `${Math.min((item.filled_count / Math.max(item.required_count, 1)) * 100, 100)}%` }} /></div></div>)}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black text-sportNavy">Roster</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {game.participants.map((participant) => <div className="rounded-2xl border border-slate-200 p-4" key={participant.id}><div className="flex items-start justify-between gap-3"><div><p className="font-black text-sportNavy">{participant.full_name}</p><p className="mt-1 text-sm font-semibold text-slate-500">{participant.role_label} - {participant.participant_type_label}</p>{participant.reliability_label ? <p className="mt-2 text-xs font-black text-sportGreen">{participant.reliability_label}</p> : null}</div><Badge tone={participant.status === "CONFIRMED" ? "green" : "blue"}>{participant.status_label}</Badge></div></div>)}
            </div>
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{game.game_type === "FILL_SQUAD" ? "Team captain" : "Host"}</p><h2 className="mt-2 text-xl font-black text-sportNavy">{game.host_name}</h2>{game.game_type === "FILL_SQUAD" && game.team_name ? <p className="mt-1 text-sm font-black text-sportGreen">{game.team_name}</p> : null}<p className="mt-1 text-sm font-semibold text-slate-500">{game.host_sportspot_id || "SportSpot player"}</p>{game.host_reliability_label ? <p className="mt-3 rounded-xl bg-green-50 px-3 py-2 text-sm font-black text-sportGreen">{game.host_reliability_label}</p> : null}</section>
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-black text-sportNavy">Deadlines</h2><CountdownRow label="Recruitment" target={game.recruitment_deadline} /><CountdownRow label="Court booking" target={!game.is_booking_verified ? game.booking_deadline : null} /></section>

          {game.user_state.is_host ? <Link className="flex min-h-12 items-center justify-center rounded-xl bg-sportGreen text-sm font-black text-white" href={`/dashboard/player/games/${game.id}`}>Manage Game</Link> : null}
          {hasRoomAccess ? <Link className="flex min-h-12 items-center justify-center rounded-xl border border-green-200 bg-white text-sm font-black text-sportGreen" href={`/dashboard/player/games/${game.id}/room`}>{game.game_type === "FILL_SQUAD" ? (game.is_booking_verified ? "Open Squad Room" : "Open Squad Planning") : (game.is_booking_verified ? "Open Game Room" : "Open Planning Room")}</Link> : null}
          {game.user_state.requires_reconfirmation ? <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5"><h2 className="text-lg font-black text-amber-950">Reconfirm your spot</h2><p className="mt-2 text-sm font-semibold text-amber-800">The final booking differs from the original plan. Confirm only if the new venue and time still work for you.</p><div className="mt-4 flex gap-2"><button className="min-h-11 flex-1 rounded-xl bg-sportGreen text-sm font-black text-white disabled:opacity-60" disabled={isSubmitting} onClick={() => reconfirm("RECONFIRM")} type="button">Reconfirm</button><button className="min-h-11 flex-1 rounded-xl border border-amber-300 bg-white text-sm font-black text-amber-800 disabled:opacity-60" disabled={isSubmitting} onClick={() => reconfirm("DECLINE")} type="button">Decline</button></div></section> : null}
          {!game.user_state.is_host && game.user_state.is_participant && !game.user_state.requires_reconfirmation ? <button className="min-h-12 w-full rounded-xl border border-red-200 bg-white text-sm font-black text-red-600 disabled:opacity-60" disabled={isSubmitting} onClick={leave} type="button">Leave Game</button> : null}
          {game.user_state.request_status === "INVITED" ? <section className="rounded-3xl border border-green-200 bg-green-50 p-5"><h2 className="text-lg font-black text-green-950">You are invited</h2><p className="mt-2 text-sm font-semibold text-green-800">Review the game details before accepting your spot.</p><div className="mt-4 flex gap-2"><button className="min-h-11 flex-1 rounded-xl bg-sportGreen text-sm font-black text-white disabled:opacity-60" disabled={isSubmitting} onClick={() => respondInvitation("ACCEPT")} type="button">Accept Invite</button><button className="min-h-11 flex-1 rounded-xl border border-red-200 bg-white text-sm font-black text-red-600 disabled:opacity-60" disabled={isSubmitting} onClick={() => respondInvitation("DECLINE")} type="button">Decline</button></div></section> : game.user_state.request_status ? <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm font-black text-green-900">Your request is {formatStatus(game.user_state.request_status)}.</div> : null}
          {canRequest || canWaitlist ? <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-black text-sportNavy">{canWaitlist ? "Join waitlist" : "Request to join"}</h2><label className="mt-4 block"><span className="text-xs font-black uppercase tracking-wide text-slate-500">Your role</span><select className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold" onChange={(event) => setRequestedRole(event.target.value as GameRole)} value={requestedRole}>{availableRoles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="mt-3 block"><span className="text-xs font-black uppercase tracking-wide text-slate-500">Message</span><textarea className="mt-1 min-h-24 w-full rounded-xl border border-slate-200 p-3 text-sm font-semibold" onChange={(event) => setMessage(event.target.value)} placeholder="Add a short note for the host" value={message} /></label><label className="mt-3 flex gap-3 text-sm font-semibold text-slate-600"><input className="mt-1" checked={attendanceConfirmed} onChange={(event) => setAttendanceConfirmed(event.target.checked)} type="checkbox" /> I confirm that I can attend this schedule if accepted.</label><button className="mt-4 min-h-12 w-full rounded-xl bg-sportGreen text-sm font-black text-white disabled:opacity-60" disabled={isSubmitting} onClick={requestToJoin} type="button">{isSubmitting ? "Sending..." : canWaitlist ? "Join Waitlist" : "Request to Join"}</button></section> : null}
        </aside>
      </section>
    </main>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-sm font-black text-sportNavy">{value}</p></div>; }
function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "blue" }) { const classes = tone === "green" ? "border-green-200 bg-green-50 text-sportGreen" : tone === "blue" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600"; return <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${classes}`}>{children}</span>; }
function StatusBadge({ game }: { game: MatchmakingGame }) { const label = game.status === "RECRUITING" ? "Recruiting" : game.status === "FULL" ? (game.waitlist_enabled ? "Waitlist open" : "Full") : game.status === "CLOSED" ? "Recruitment closed" : game.status_label; return <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{label}</span>; }
function CountdownRow({ label, target }: { label: string; target: string | null }) { const countdown = useCountdown(target); if (!target) return null; return <div className="mt-3 rounded-xl bg-slate-50 p-3"><p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-black text-sportNavy">{countdown}</p></div>; }
function useCountdown(target: string | null) { const [now, setNow] = useState<Date | null>(null); useEffect(() => { setNow(new Date()); const id = window.setInterval(() => setNow(new Date()), 60000); return () => window.clearInterval(id); }, []); if (!target || !now) return ""; const ms = new Date(target).getTime() - now.getTime(); if (ms <= 0) return "Closed"; const minutes = Math.floor(ms / 60000); if (minutes < 60) return minutes <= 15 ? `Closing soon - ${minutes}m` : `${minutes}m left`; const hours = Math.floor(minutes / 60); const days = Math.floor(hours / 24); return days > 0 ? `${days}d ${hours % 24}h left` : `${hours}h ${minutes % 60}m left`; }
function formatDateTime(value: string | null) { if (!value) return "Date to be confirmed"; return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function formatSkill(value: string) { if (value === "OPEN") return "Open to all"; return `${value.charAt(0)}${value.slice(1).toLowerCase()}+`; }
function formatStatus(value: string) { return value.replace(/_/g, " ").toLowerCase(); }


