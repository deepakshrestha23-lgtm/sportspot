"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateOnly, formatDateTimeInNepal, formatTimeValue } from "@/lib/dates";
import { emitToast } from "@/lib/toast";
import BackButton from "@/components/BackButton";
import MediaImage from "@/components/MediaImage";
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

  if (isLoading) return <main className="min-h-screen bg-[var(--sport-canvas)] px-4 py-8"><div className="mx-auto max-w-6xl space-y-4"><div className="h-9 w-32 animate-pulse rounded-md bg-slate-200" /><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><div className="h-[34rem] animate-pulse rounded-xl bg-white" /><div className="h-[28rem] animate-pulse rounded-xl bg-white" /></div></div></main>;
  if (error || !game) return <main className="min-h-screen bg-[var(--sport-canvas)] px-4 py-8"><section className="sport-error-state mx-auto max-w-3xl"><h1 className="text-2xl font-bold text-red-950">Game unavailable</h1><p className="mt-2 text-sm font-semibold text-red-700">{error || "This game could not be found."}</p><button className="sport-primary-button mt-5 bg-red-600 hover:bg-red-700" onClick={() => loadGame()} type="button">Retry</button></section></main>;

  const canRequest = !game.user_state.is_host && !game.user_state.is_participant && !game.user_state.request_status && game.status === "RECRUITING";
  const canWaitlist = !game.user_state.is_host && !game.user_state.is_participant && !game.user_state.request_status && game.status === "FULL" && game.waitlist_enabled;
  const hasRoomAccess = game.user_state.is_host || game.user_state.is_participant;
  const locationLabel = game.is_booking_verified
    ? [game.venue_name, game.court_name].filter(Boolean).join(" · ")
    : [game.preferred_area, game.preferred_district].filter(Boolean).join(", ") || "Location to be confirmed";
  const scheduleLabel = game.start_at
    ? `${formatDateTimeInNepal(game.start_at, { weekday: "short", month: "short", day: "numeric" })} · ${game.booking_display_time}`
    : game.booking_display_time || "Date to be confirmed";
  const progress = Math.min((game.occupied_spots_count / Math.max(game.total_capacity, 1)) * 100, 100);
  const actionTitle = canRequest
    ? "Request your spot"
    : canWaitlist
      ? "Join the waitlist"
      : game.user_state.requires_reconfirmation
        ? "Confirm your spot"
        : game.user_state.request_status === "INVITED"
          ? "You are invited"
          : game.user_state.is_host
            ? "Coordinate this game"
            : game.user_state.is_participant
              ? "Stay connected"
              : "Game access";

  return (
    <main className="min-h-screen bg-[var(--sport-canvas)]">
      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <BackButton href="/find-game" label="Back to games" />

        <div className="mt-4 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-5">
            <section className="sport-surface overflow-hidden">
              <div className="border-t-4 border-sportGreen px-5 py-6 sm:px-7 sm:py-7">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <p className="sport-eyebrow">{game.game_type === "FILL_SQUAD" ? "Fill my squad" : "Pickup game"}</p>
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600"><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${game.is_booking_verified ? "bg-emerald-600" : "bg-blue-500"}`} />{game.is_booking_verified ? "Court confirmed" : "Planning game"}</span>
                      <span className="text-xs font-bold text-slate-500">{game.game_intensity_label}</span>
                    </div>
                    <h1 className="mt-3 max-w-3xl text-3xl font-black leading-tight tracking-tight text-sportNavy sm:text-4xl">{game.title}</h1>
                    <p className="mt-3 flex items-start gap-2 text-sm font-semibold leading-6 text-slate-600"><MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-sportGreen" />{locationLabel}</p>
                  </div>
                  <StatusBadge game={game} />
                </div>
              </div>

              <div className="grid divide-y divide-slate-100 sm:grid-cols-[1.35fr_1fr_1fr_1fr] sm:divide-x sm:divide-y-0">
                <GameFact icon={<CalendarIcon />} label="When" value={scheduleLabel} />
                <GameFact icon={<UsersIcon />} label="Roster" value={`${game.occupied_spots_count}/${game.total_capacity} players`} />
                <GameFact icon={<TargetIcon />} label="Minimum" value={`${game.minimum_players_to_proceed} to start`} />
                <GameFact icon={<ShieldIcon />} label="Skill level" value={formatSkill(game.min_skill_level)} />
              </div>

              {game.description ? <p className="border-t border-slate-100 px-5 py-4 text-sm leading-6 text-slate-600 sm:px-7">{game.description}</p> : null}
              {!game.is_booking_verified ? <div className="flex gap-3 border-t border-blue-100 bg-blue-50 px-5 py-4 text-sm font-semibold leading-6 text-blue-900 sm:px-7"><InfoIcon className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" /><p>This is a planning game. Accepted players stay provisional until the host books a court and confirms the final schedule.</p></div> : null}
            </section>

          <section className="sport-surface overflow-hidden">
            <header className="flex flex-col gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-7">
              <div>
                <p className="sport-eyebrow">Squad balance</p>
                <h2 className="mt-1 text-xl font-black text-sportNavy">{game.game_type === "FILL_SQUAD" ? "Temporary roles needed" : "Roles needed"}</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">See what the host is still recruiting for.</p>
              </div>
              <p className="text-sm font-bold text-slate-500"><span className="text-xl font-black text-sportNavy">{game.occupied_spots_count}</span> of {game.total_capacity} filled</p>
            </header>
            <div className="px-5 py-5 sm:px-7">
              <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-500"><span>Overall progress</span><span className="text-sportGreen">{game.available_spots > 0 ? `${game.available_spots} spot${game.available_spots === 1 ? "" : "s"} open` : "Squad is full"}</span></div>
              <div aria-label={`${game.occupied_spots_count} of ${game.total_capacity} player spots filled`} aria-valuemax={game.total_capacity} aria-valuemin={0} aria-valuenow={game.occupied_spots_count} className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar"><div className="h-full rounded-full bg-sportGreen transition-[width]" style={{ width: `${progress}%` }} /></div>
              {game.role_progress.length ? <div className="mt-5 grid gap-x-8 sm:grid-cols-2">{game.role_progress.map((item) => <RoleProgressRow item={item} key={item.role} />)}</div> : <p className="mt-5 text-sm text-slate-500">The host has not added role requirements for this game.</p>}
            </div>
          </section>

          <section className="sport-surface overflow-hidden">
            <header className="flex items-end justify-between gap-3 border-b border-slate-100 px-5 py-5 sm:px-7"><div><p className="sport-eyebrow">The squad</p><h2 className="mt-1 text-xl font-black text-sportNavy">Roster</h2></div><span className="text-sm font-bold text-slate-500">{game.occupied_spots_count}/{game.total_capacity}</span></header>
            {game.participants.length ? <div className="divide-y divide-slate-100">{game.participants.map((participant) => <ParticipantRow key={participant.id} participant={participant} />)}</div> : <p className="px-5 py-8 text-center text-sm font-semibold text-slate-500 sm:px-7">No players have joined yet. Be the first to request a spot.</p>}
          </section>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
          <section className="sport-surface order-2 p-5 sm:p-6"><div className="flex items-center gap-3"><div aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--sport-green-soft)] text-sm font-black text-sportGreen">{getInitials(game.host_name)}</div><div className="min-w-0"><p className="sport-eyebrow">{game.game_type === "FILL_SQUAD" ? "Team captain" : "Host"}</p><h2 className="truncate text-lg font-black text-sportNavy">{game.host_name}</h2><p className="text-xs font-semibold text-slate-500">{game.host_sportspot_id || "SportSpot player"}</p></div></div>{game.game_type === "FILL_SQUAD" && game.team_name ? <p className="mt-4 border-t border-slate-100 pt-4 text-sm font-black text-sportGreen">{game.team_name}</p> : null}{game.host_reliability_label ? <p className="mt-4 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm font-black text-sportGreen"><ShieldIcon className="h-4 w-4" />{game.host_reliability_label}</p> : null}</section>
          <section className="sport-surface order-3 p-5 sm:p-6"><p className="sport-eyebrow">Time-sensitive</p><h2 className="mt-1 text-lg font-black text-sportNavy">Deadlines</h2><div className="mt-3 divide-y divide-slate-100"><CountdownRow label="Recruitment" target={game.recruitment_deadline} /><CountdownRow label="Court booking" target={!game.is_booking_verified ? game.booking_deadline : null} /></div></section>

          <section className="sport-surface order-1 p-5 sm:p-6">
            <p className="sport-eyebrow">{game.user_state.is_host ? "Host controls" : "Your next step"}</p>
            <h2 className="mt-1 text-xl font-black text-sportNavy">{actionTitle}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{canRequest || canWaitlist ? "Choose the role that fits you and confirm that you can make the schedule." : game.user_state.is_host ? "Keep the roster, booking, and game room in sync from one place." : game.user_state.is_participant ? "Your accepted spot and private game room are available here." : "Review the game details before choosing an action."}</p>

            {canRequest || canWaitlist ? <div className="mt-5 border-t border-slate-100 pt-5"><label className="block"><span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Your role</span><select className="sport-input mt-1" onChange={(event) => setRequestedRole(event.target.value as GameRole)} value={requestedRole}>{availableRoles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="mt-4 block"><span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Note to host <span className="font-semibold normal-case tracking-normal text-slate-400">(optional)</span></span><textarea className="sport-input mt-1 min-h-24" onChange={(event) => setMessage(event.target.value)} placeholder="Introduce yourself briefly" value={message} /></label><label className="mt-4 flex items-start gap-3 text-sm font-semibold leading-5 text-slate-600"><input className="mt-1 h-4 w-4 accent-sportGreen" checked={attendanceConfirmed} onChange={(event) => setAttendanceConfirmed(event.target.checked)} type="checkbox" /><span>I can attend this schedule if accepted.</span></label><button className="sport-primary-button mt-5 min-h-12 w-full" disabled={isSubmitting} onClick={requestToJoin} type="button"><UsersIcon />{isSubmitting ? "Sending..." : canWaitlist ? "Join waitlist" : "Request to join"}</button></div> : null}
            {game.user_state.requires_reconfirmation ? <div className="mt-5 border-t border-slate-100 pt-5"><div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-900"><p className="font-black">The final schedule changed</p><p className="mt-1">{scheduleChangeMessage(game)} Confirm only if it still works for you. Declining does not affect reliability.</p></div><div className="mt-4 grid gap-2 text-sm font-bold text-amber-950"><div className="rounded-lg bg-amber-50 px-3 py-2"><span className="block text-[10px] font-black uppercase tracking-[0.12em] text-amber-700">Plan you joined</span>{formatProposedSchedule(game)}</div><div className="rounded-lg bg-amber-50 px-3 py-2"><span className="block text-[10px] font-black uppercase tracking-[0.12em] text-amber-700">Confirmed booking</span>{formatConfirmedSchedule(game)}</div></div><div className="mt-4 grid gap-2"><button className="sport-primary-button min-h-11 w-full" disabled={isSubmitting} onClick={() => reconfirm("RECONFIRM")} type="button">Confirm my spot</button><button className="sport-secondary-button min-h-11 w-full border-amber-300 text-amber-800" disabled={isSubmitting} onClick={() => reconfirm("DECLINE")} type="button">I cannot attend</button></div></div> : null}
            {game.user_state.request_status === "INVITED" ? <div className="mt-5 border-t border-slate-100 pt-5"><div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold leading-6 text-emerald-900">Review the details, then choose whether to accept this invitation.</div><div className="mt-4 grid gap-2"><button className="sport-primary-button min-h-11 w-full" disabled={isSubmitting} onClick={() => respondInvitation("ACCEPT")} type="button">Accept invitation</button><button className="sport-secondary-button min-h-11 w-full border-red-200 text-red-600 hover:bg-red-50" disabled={isSubmitting} onClick={() => respondInvitation("DECLINE")} type="button">Decline</button></div></div> : null}
            {game.user_state.request_status && game.user_state.request_status !== "INVITED" && !game.user_state.requires_reconfirmation ? <p className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-900">Your request is {formatStatus(game.user_state.request_status)}.</p> : null}
            {game.user_state.is_host || (hasRoomAccess && game.user_state.room_access !== "NONE") ? <div className="mt-5 grid gap-2 border-t border-slate-100 pt-5">{game.user_state.is_host ? <Link className="sport-primary-button min-h-11 w-full" href={`/dashboard/player/games/${game.id}`}><span>Manage game</span><ArrowUpRightIcon /></Link> : null}{hasRoomAccess && game.user_state.room_access !== "NONE" ? <Link className="sport-secondary-button min-h-11 w-full" href={`/dashboard/player/games/${game.id}/room`}><span>{roomLinkLabel(game)}</span><ArrowUpRightIcon /></Link> : null}</div> : null}
            {!game.user_state.is_host && game.user_state.is_participant && !game.user_state.requires_reconfirmation ? <button className="sport-secondary-button mt-3 min-h-11 w-full border-red-200 text-red-600 hover:bg-red-50" disabled={isSubmitting} onClick={leave} type="button">Leave game</button> : null}
          </section>
        </aside>
        </div>
      </section>
    </main>
  );
}

function roomLinkLabel(game: MatchmakingGame) { if (game.user_state.room_access === "READ_ONLY") return "View Game Record"; if (game.user_state.room_access === "RECONFIRMATION") return "Review Schedule Change"; if (game.game_type === "FILL_SQUAD") return game.is_booking_verified ? "Open Squad Room" : "Open Squad Planning"; return game.is_booking_verified ? "Open Game Room" : "Open Planning Room"; }
function getInitials(name: string) { const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); return initials || "?"; }
function CalendarIcon({ className = "h-4 w-4" }: { className?: string }) { return <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24"><rect height="15" rx="2" stroke="currentColor" strokeWidth="1.8" width="16" x="4" y="5" /><path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>; }
function MapPinIcon({ className = "h-4 w-4" }: { className?: string }) { return <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.8" /></svg>; }
function UsersIcon({ className = "h-4 w-4" }: { className?: string }) { return <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24"><path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 2a5 5 0 0 1 5 5M3 20a5 5 0 0 1 10 0" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>; }
function TargetIcon({ className = "h-4 w-4" }: { className?: string }) { return <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" /><path d="M12 4v2m8 6h-2m-6 8v-2m-8-6h2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>; }
function ShieldIcon({ className = "h-4 w-4" }: { className?: string }) { return <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24"><path d="m12 3 7 3v5c0 4.6-2.8 8-7 10-4.2-2-7-5.4-7-10V6l7-3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /><path d="m9 12 2 2 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>; }
function InfoIcon({ className = "h-4 w-4" }: { className?: string }) { return <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" /><path d="M12 10.5v5M12 7.5h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></svg>; }
function ArrowUpRightIcon() { return <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24"><path d="M7 17 17 7m0 0H9m8 0v8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>; }
function GameFact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="px-5 py-4 sm:px-4"><div className="flex items-start gap-2.5"><span className="mt-0.5 shrink-0 text-sportGreen">{icon}</span><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className="mt-1 text-sm font-black leading-5 text-sportNavy">{value}</p></div></div></div>; }
function RoleProgressRow({ item }: { item: MatchmakingGame["role_progress"][number] }) { const percentage = Math.min((item.filled_count / Math.max(item.required_count, 1)) * 100, 100); return <div className="border-t border-slate-100 py-3 first:pt-0"><div className="flex items-center justify-between gap-3"><p className="text-sm font-black text-sportNavy">{item.role_label}</p><span className={`text-xs font-black ${item.is_filled ? "text-sportGreen" : "text-slate-500"}`}>{item.is_filled ? "Filled" : `${item.filled_count}/${item.required_count}`}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-sportGreen" style={{ width: `${percentage}%` }} /></div></div>; }
function ParticipantRow({ participant }: { participant: MatchmakingGame["participants"][number] }) { const avatarClass = "h-9 w-9 shrink-0 rounded-full border border-slate-200 bg-sportNavy object-cover text-xs font-black text-white"; return <div className="flex items-center gap-3 px-5 py-4 sm:px-7"><MediaImage alt={`${participant.full_name} profile photo`} className={avatarClass} fallback={<span className={`${avatarClass} flex items-center justify-center`}>{getInitials(participant.full_name)}</span>} source={participant.profile_photo} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-black text-sportNavy">{participant.full_name}</p><p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{participant.role_label} <span aria-hidden="true" className="mx-1 text-slate-300">·</span> {participant.participant_type_label}{participant.reliability_label ? <span className="text-sportGreen"> <span aria-hidden="true" className="mx-1 text-slate-300">·</span>{participant.reliability_label}</span> : null}</p></div><Badge tone={participant.status === "CONFIRMED" ? "green" : "blue"}>{participant.status_label}</Badge></div>; }
function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "blue" }) { const classes = tone === "green" ? "border-green-200 bg-green-50 text-sportGreen" : tone === "blue" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600"; return <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${classes}`}>{children}</span>; }
function StatusBadge({ game }: { game: MatchmakingGame }) { const label = game.status === "RECRUITING" ? "Recruiting" : game.status === "FULL" ? (game.waitlist_enabled ? "Waitlist open" : "Full") : game.status === "CLOSED" ? "Recruitment closed" : game.status_label; const isClosed = game.status === "CLOSED" || game.status === "CANCELLED"; return <span className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black ${isClosed ? "border-red-200 bg-red-50 text-red-700" : game.status === "FULL" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-sportGreen"}`}><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${isClosed ? "bg-red-500" : game.status === "FULL" ? "bg-amber-500" : "bg-emerald-600"}`} />{label}</span>; }
function CountdownRow({ label, target }: { label: string; target: string | null }) { const countdown = useCountdown(target); if (!target) return null; return <div className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"><div><p className="text-sm font-bold text-sportNavy">{label}</p><p className="mt-0.5 text-xs font-semibold text-slate-500">{countdown === "Closed" ? "No longer accepting changes" : "Closes automatically"}</p></div><p className={`shrink-0 text-right text-sm font-black ${countdown === "Closed" ? "text-slate-500" : "text-sportGreen"}`}>{countdown}</p></div>; }
function useCountdown(target: string | null) { const [now, setNow] = useState<Date | null>(null); useEffect(() => { setNow(new Date()); const id = window.setInterval(() => setNow(new Date()), 60000); return () => window.clearInterval(id); }, []); if (!target || !now) return ""; const ms = new Date(target).getTime() - now.getTime(); if (ms <= 0) return "Closed"; const minutes = Math.floor(ms / 60000); if (minutes < 60) return minutes <= 15 ? `Closing soon - ${minutes}m` : `${minutes}m left`; const hours = Math.floor(minutes / 60); const days = Math.floor(hours / 24); return days > 0 ? `${days}d ${hours % 24}h left` : `${hours}h ${minutes % 60}m left`; }
function formatSkill(value: string) { if (value === "OPEN") return "Open to all"; return `${value.charAt(0)}${value.slice(1).toLowerCase()}+`; }
function formatStatus(value: string) { return value.replace(/_/g, " ").toLowerCase(); }

function scheduleChangeMessage(game: MatchmakingGame) {
  if (game.proposed_start_time && game.start_at) return "The host booked a different final time than the original plan.";
  return "The final booking differs from the plan you joined.";
}

function formatProposedSchedule(game: MatchmakingGame) {
  if (!game.proposed_date || !game.proposed_start_time) return "Original schedule not available";
  const date = formatDateOnly(game.proposed_date);
  const start = formatTimeValue(game.proposed_start_time);
  const end = game.proposed_end_time ? ` - ${formatTimeValue(game.proposed_end_time)}` : "";
  return `${date}, ${start}${end}`;
}

function formatConfirmedSchedule(game: MatchmakingGame) {
  if (!game.start_at) return "Final schedule not available";
  const date = formatDateTimeInNepal(game.start_at, { dateStyle: "medium" });
  const time = formatDateTimeInNepal(game.start_at, { timeStyle: "short" });
  const endTime = game.end_at ? ` - ${formatDateTimeInNepal(game.end_at, { timeStyle: "short" })}` : "";
  return `${date}, ${time}${endTime}`;
}


