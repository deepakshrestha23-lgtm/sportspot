"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { DashboardPageHeader } from "@/components/player-dashboard/DashboardPageHeader";
import GameRoomChat from "@/components/player-dashboard/GameRoomChat";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateTimeInNepal } from "@/lib/dates";
import { emitToast } from "@/lib/toast";
import type { GameResponse, MatchmakingGame, ParticipationAttendanceStatus } from "@/types/matchmaking";

export default function GameRoomPage() {
  const params = useParams<{ gameId: string }>();
  const [game, setGame] = useState<MatchmakingGame | null>(null);
  const [note, setNote] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attendanceAction, setAttendanceAction] = useState<number | null>(null);
  const [disputeParticipantId, setDisputeParticipantId] = useState<number | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [isDisputing, setIsDisputing] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { loadRoom(); }, [params.gameId]);

  useEffect(() => {
    if (!isChatOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsChatOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isChatOpen]);

  async function loadRoom() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<GameResponse>(`/api/matchmaking/games/${params.gameId}/room/`);
      setGame(response.data.game);
      setNote(response.data.game.game_room_note || "");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not open this game room."));
    } finally { setIsLoading(false); }
  }

  async function saveNote() {
    try {
      const response = await api.patch<GameResponse>(`/api/matchmaking/games/${params.gameId}/room/`, { game_room_note: note });
      setGame(response.data.game);
      emitToast({ message: "Game room instructions have been updated.", type: "success", dedupeKey: `room-${params.gameId}` });
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not update the instructions."), type: "error", dedupeKey: `room-error-${params.gameId}` });
    }
  }

  async function reconfirm(response: "RECONFIRM" | "DECLINE") {
    setIsSubmitting(true);
    try {
      await api.post<GameResponse>(`/api/matchmaking/games/${params.gameId}/reconfirm/`, { response });
      emitToast({ message: response === "RECONFIRM" ? "Your spot has been reconfirmed." : "You have declined the updated game plan.", type: "success", dedupeKey: `room-reconfirm-${params.gameId}` });
      await loadRoom();
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not update your response."), type: "error", dedupeKey: `room-reconfirm-error-${params.gameId}` });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function recordAttendance(participantId: number, attendanceStatus: "ATTENDED" | "ABSENT") {
    if (!game || attendanceAction) return;
    setAttendanceAction(participantId);
    try {
      const response = await api.post<{ attendance: { id: number; status: ParticipationAttendanceStatus; review_deadline_at: string | null; attendance_submission_deadline_at: string | null } }>(
        `/api/matchmaking/games/${game.id}/participants/${participantId}/attendance/`,
        { status: attendanceStatus },
      );
      setGame((current) => current ? {
        ...current,
        participants: current.participants.map((participant) => participant.id === participantId
          ? { ...participant, attendance: { ...participant.attendance, ...response.data.attendance, can_dispute: false } }
          : participant),
      } : current);
      emitToast({ message: attendanceStatus === "ATTENDED" ? "Attendance recorded." : "No-show report sent for player review.", type: "success", dedupeKey: `attendance-${game.id}-${participantId}` });
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not record attendance."), type: "error", dedupeKey: `attendance-error-${game.id}-${participantId}` });
    } finally {
      setAttendanceAction(null);
    }
  }

  async function submitAttendanceDispute() {
    if (!game || !disputeParticipantId || disputeReason.trim().length < 5 || isDisputing) return;
    setIsDisputing(true);
    try {
      await api.post(`/api/matchmaking/games/${game.id}/participants/${disputeParticipantId}/attendance/dispute/`, { reason: disputeReason.trim() });
      setGame((current) => current ? {
        ...current,
        participants: current.participants.map((participant) => participant.id === disputeParticipantId
          ? { ...participant, attendance: { ...participant.attendance, status: "DISPUTED", can_dispute: false, review_deadline_at: participant.attendance?.review_deadline_at || null, attendance_submission_deadline_at: participant.attendance?.attendance_submission_deadline_at || null } }
          : participant),
      } : current);
      setDisputeParticipantId(null);
      setDisputeReason("");
      emitToast({ message: "Your attendance dispute has been submitted for review.", type: "success", dedupeKey: `game-attendance-dispute-${game.id}-${disputeParticipantId}` });
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not submit the attendance dispute."), type: "error", dedupeKey: `game-attendance-dispute-error-${game.id}-${disputeParticipantId}` });
    } finally {
      setIsDisputing(false);
    }
  }

  if (isLoading) return <div className="sport-surface h-[480px] animate-pulse" />;
  if (error || !game) return <section className="sport-error-state"><h1 className="text-xl font-bold text-red-950">We could not open this Game Room.</h1><p className="mt-2 text-sm font-semibold text-red-700">{error}</p><button className="sport-primary-button mt-5 bg-red-600 hover:bg-red-700" onClick={loadRoom} type="button">Retry</button></section>;

  const roomAccess = game.user_state.room_access || "NONE";
  const isPlanning = roomAccess === "PLANNING";
  const isReconfirmation = roomAccess === "RECONFIRMATION";
  const isReadOnly = roomAccess === "READ_ONLY";
  const isFillSquad = game.game_type === "FILL_SQUAD";
  const attendancePending = game.participants.some((participant) => participant.user !== null && participant.participant_type !== "GUEST" && ["NOT_CREATED", "COMMITTED", "ATTENDANCE_PENDING"].includes(participant.attendance?.status || "NOT_CREATED"));
  return (
    <div className="space-y-5">
      <DashboardPageHeader backHref={`/dashboard/player/games/${game.id}`} backLabel="Back to game" eyebrow={roomEyebrow(roomAccess, isFillSquad)} title={isFillSquad ? (isPlanning ? "Fill My Squad Planning" : "Fill My Squad Room") : (isPlanning ? "Pickup Planning Room" : "Pickup Game Room")} description={`${game.title} - ${game.booking_display_time}`} actions={<div className="flex flex-wrap items-center gap-2"><button aria-controls="game-room-chat" aria-expanded={isChatOpen} className="sport-secondary-button" onClick={() => setIsChatOpen(true)} type="button"><ChatIcon /> Chat</button>{game.user_state.is_host && !isReadOnly ? <Link className="sport-secondary-button" href={`/dashboard/player/games/${game.id}`}>Manage Game</Link> : null}</div>} />
      <section className={`sport-surface p-5 ${isReadOnly ? "border-slate-200 bg-slate-100" : isReconfirmation ? "border-amber-200 bg-amber-50" : isPlanning ? "border-blue-200 bg-blue-50" : "border-green-200 bg-green-50"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className={`text-xs font-black uppercase tracking-[0.18em] ${isReadOnly ? "text-slate-600" : isReconfirmation ? "text-amber-800" : isPlanning ? "text-blue-700" : "text-sportGreen"}`}>{roomBannerLabel(roomAccess, Boolean(game.is_booking_verified))}</p><h2 className="mt-1 text-xl font-black text-sportNavy">{isPlanning ? (isFillSquad ? "This squad room is for selected team members and accepted temporary players." : "This room is for planning and coordination.") : `${game.venue_name} - ${game.court_name}`}</h2><p className="mt-1 text-sm font-semibold text-slate-600">{isPlanning ? `${[game.preferred_area, game.preferred_district].filter(Boolean).join(", ")} - host must book before ${formatDate(game.booking_deadline)}` : `${game.venue_address || game.venue_area} - ${game.booking_code}`}</p></div>
          <StatusBadge label={game.status_label} />
        </div>
      </section>
      {isReconfirmation ? <RoomNotice title="Schedule confirmation needed" text={game.user_state.requires_reconfirmation ? "Review the updated venue and time, then confirm whether you can still attend." : "The host is coordinating the updated schedule with the roster."} tone="amber" /> : null}
      {isReadOnly ? <RoomNotice title={game.status_label === "Completed" ? "Game history" : "Game closed"} text="This room is read-only. The schedule and roster remain available for your records." tone="slate" /> : null}
      {game.status === "COMPLETED" ? <section className="sport-surface border-green-200 bg-green-50 p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="sport-eyebrow">Post-match</p><h2 className="mt-1 text-lg font-black text-sportNavy">Close out this game</h2><p className="mt-1 text-sm font-semibold text-slate-600">Attendance is confirmed here first. Verified players can then complete their feedback.</p></div>{game.user_state.is_host && attendancePending ? <a className="sport-primary-button shrink-0" href="#game-attendance">Record attendance</a> : <Link className="sport-secondary-button shrink-0" href="/dashboard/player/ratings">Open ratings & reliability</Link>}</div></section> : null}
      <section className="sport-surface flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5" aria-label="Game room chat">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-50 text-sportGreen"><ChatIcon /></span>
          <div className="min-w-0"><p className="sport-eyebrow">Room communication</p><h2 className="mt-1 text-base font-black text-sportNavy">Coordinate with the roster</h2><p className="mt-1 text-sm font-semibold text-slate-600">Arrival updates, equipment, and last-minute changes belong here.</p></div>
        </div>
        <button aria-controls="game-room-chat" className="sport-primary-button w-full shrink-0 sm:w-auto" onClick={() => setIsChatOpen(true)} type="button"><ChatIcon /> Open chat</button>
      </section>
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-xl font-black text-sportNavy">Schedule</h2><div className="mt-4 grid gap-3 sm:grid-cols-3"><Info label="Date and time" value={`${formatDate(game.start_at)} - ${game.booking_display_time}`} /><Info label="Venue" value={game.venue_name} /><Info label="Court" value={game.court_name} /></div>{game.requires_reconfirmation ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4"><p className="text-sm font-black text-amber-950">The final booking differs from the original plan.</p>{game.user_state.requires_reconfirmation ? <><p className="mt-1 text-sm font-semibold leading-6 text-amber-800">Confirm that this venue and time still work for you. You can decline without a reliability penalty.</p><div className="mt-3 flex flex-wrap gap-2"><button className="min-h-10 rounded-lg bg-sportGreen px-4 text-sm font-black text-white disabled:opacity-60" disabled={isSubmitting} onClick={() => reconfirm("RECONFIRM")} type="button">Confirm my spot</button><button className="min-h-10 rounded-lg border border-amber-300 bg-white px-4 text-sm font-black text-amber-800 disabled:opacity-60" disabled={isSubmitting} onClick={() => reconfirm("DECLINE")} type="button">I cannot attend</button></div></> : game.user_state.is_host ? <p className="mt-1 text-sm font-semibold leading-6 text-amber-800">{game.registered_reconfirmation_pending_count} registered player response{game.registered_reconfirmation_pending_count === 1 ? "" : "s"} and {game.guest_confirmation_pending_count} guest acknowledgement{game.guest_confirmation_pending_count === 1 ? "" : "s"} still pending. <Link className="font-black underline" href={`/dashboard/player/games/${game.id}`}>Manage responses</Link></p> : <p className="mt-1 text-sm font-semibold leading-6 text-amber-800">The host is coordinating the updated schedule with the roster.</p>}</div> : null}</section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-xl font-black text-sportNavy">Instructions</h2>{game.reporting_instructions ? <InfoBlock title="Reporting" text={game.reporting_instructions} /> : null}{game.equipment_instructions ? <InfoBlock title="Equipment" text={game.equipment_instructions} /> : null}{game.user_state.is_host && !isReadOnly ? <><textarea className="mt-4 min-h-40 w-full rounded-xl border border-slate-200 p-4 text-sm font-semibold" onChange={(event) => setNote(event.target.value)} placeholder="Arrival point, equipment, lineup or simple coordination notes." value={note} /><button className="mt-3 rounded-xl bg-sportGreen px-4 py-2.5 text-sm font-black text-white" onClick={saveNote} type="button">Save Instructions</button></> : <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">{game.game_room_note || "The host has not added private instructions yet."}</p>}</section>
          {game.status === "COMPLETED" && game.user_state.is_host ? <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" id="game-attendance"><h2 className="text-xl font-black text-sportNavy">Attendance</h2><p className="mt-1 text-sm font-semibold text-slate-600">Submit the roster by {formatAttendanceDeadline(game)}. Unreported attendance stays neutral; a no-show report remains disputable for 24 hours.</p><div className="mt-4 space-y-2">{game.participants.filter((participant) => participant.user !== null && participant.participant_type !== "GUEST").map((participant) => <AttendanceRow key={participant.id} action={attendanceAction} participant={participant} onAttendance={(status) => void recordAttendance(participant.id, status)} />)}</div></section> : null}
          {isPlanning ? <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-xl font-black text-sportNavy">Planning progress</h2><div className="mt-4 grid gap-3 sm:grid-cols-3"><Info label="Minimum needed" value={`${game.minimum_players_to_proceed} players`} /><Info label="Provisional" value={game.provisional_participants_count} /><Info label="Open spots" value={game.available_spots} /></div></section> : null}
        </div>
        <aside className="sport-surface p-5 lg:sticky lg:top-5 lg:self-start"><div className="flex items-end justify-between gap-3"><div><p className="sport-eyebrow">People in this room</p><h2 className="mt-1 text-xl font-black text-sportNavy">Roster</h2></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{game.participants.length} players</span></div><p className="mt-1 text-sm font-semibold text-slate-600">Accepted players and their current room status.</p><div className="mt-4 space-y-2">{game.participants.map((participant) => <div className="rounded-xl bg-slate-50 p-3" key={participant.id}><div className="flex items-start justify-between gap-2"><div><p className="font-black text-sportNavy">{participant.full_name}</p><p className="text-sm font-semibold text-slate-500">{participant.role_label} - {participant.participant_type_label}</p></div><StatusBadge label={participant.status_label} compact /></div>{participant.attendance && participant.attendance.status !== "NOT_CREATED" && participant.attendance.status !== "NOT_TRACKED" ? <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold text-slate-500">Attendance: {formatAttendanceStatus(participant.attendance.status)}</p>{participant.attendance.can_dispute ? <button className="text-xs font-black text-amber-800 underline underline-offset-2" onClick={() => { setDisputeParticipantId(participant.id); setDisputeReason(""); }} type="button">Dispute report</button> : null}</div> : null}{disputeParticipantId === participant.id ? <AttendanceDisputeForm isSubmitting={isDisputing} onCancel={() => setDisputeParticipantId(null)} onChange={setDisputeReason} onSubmit={() => void submitAttendanceDispute()} reason={disputeReason} /> : null}</div>)}</div></aside>
      </section>
      {isChatOpen ? <div className="fixed inset-0 z-50" role="presentation"><button aria-label="Close game chat" className="absolute inset-0 bg-sportNavy/35 backdrop-blur-[2px]" onClick={() => setIsChatOpen(false)} type="button" /><aside aria-labelledby="game-chat-heading" aria-modal="true" className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col overflow-y-auto rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:inset-y-4 sm:right-4 sm:left-auto sm:bottom-auto sm:w-[min(430px,calc(100vw-2rem))] sm:rounded-2xl" id="game-room-chat" role="dialog"><GameRoomChat canSend={!isReadOnly} embedded onClose={() => setIsChatOpen(false)} target={{ kind: "game", id: game.id }} /></aside></div> : null}
    </div>
  );
}

function AttendanceRow({ action, onAttendance, participant }: { action: number | null; onAttendance: (status: "ATTENDED" | "ABSENT") => void; participant: MatchmakingGame["participants"][number] }) {
  const status = participant.attendance?.status;
  if (status && status !== "NOT_CREATED" && status !== "NOT_TRACKED" && status !== "COMMITTED" && status !== "ATTENDANCE_PENDING") {
    return <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3"><span className="font-bold text-sportNavy">{participant.full_name}</span><span className="text-xs font-bold text-slate-600">{formatAttendanceStatus(status)}</span></div>;
  }
  return <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"><span className="font-bold text-sportNavy">{participant.full_name}</span><div className="flex gap-2"><button className="sport-secondary-button min-h-9 px-3 text-xs" disabled={Boolean(action)} onClick={() => onAttendance("ATTENDED")} type="button">Attended</button><button className="sport-secondary-button min-h-9 border-red-200 px-3 text-xs text-red-700 hover:bg-red-50" disabled={Boolean(action)} onClick={() => onAttendance("ABSENT")} type="button">No-show</button></div></div>;
}
function AttendanceDisputeForm({ isSubmitting, onCancel, onChange, onSubmit, reason }: { isSubmitting: boolean; onCancel: () => void; onChange: (value: string) => void; onSubmit: () => void; reason: string }) {
  return <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-black text-amber-950">Why is this report incorrect?</p><p className="mt-1 text-xs leading-5 text-amber-800">Include a short explanation for staff review. Your reliability stays unchanged while it is reviewed.</p><textarea className="mt-3 min-h-20 w-full rounded-lg border border-amber-200 bg-white p-3 text-sm font-semibold text-sportNavy outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" maxLength={500} onChange={(event) => onChange(event.target.value)} placeholder="For example: I attended the game and checked in with the host." value={reason} /><div className="mt-3 flex flex-wrap gap-2"><button className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-black text-slate-700" disabled={isSubmitting} onClick={onCancel} type="button">Cancel</button><button className="min-h-9 rounded-lg bg-sportGreen px-3 text-xs font-black text-white disabled:opacity-50" disabled={isSubmitting || reason.trim().length < 5} onClick={onSubmit} type="button">{isSubmitting ? "Submitting..." : "Submit dispute"}</button></div></div>;
}
function formatAttendanceStatus(status: string) { if (status === "UNVERIFIED") return "Unverified (neutral)"; return status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatAttendanceDeadline(game: MatchmakingGame) { const deadline = game.participants.find((participant) => participant.attendance?.attendance_submission_deadline_at)?.attendance?.attendance_submission_deadline_at; return deadline ? formatDate(deadline) : "within 24 hours of the game"; }
function Info({ label, value }: { label: string; value: string | number | null }) { return <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-black text-sportNavy">{value || "To be confirmed"}</p></div>; }
function InfoBlock({ text, title }: { title: string; text: string }) { return <div className="mt-4 rounded-xl bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-500">{title}</p><p className="mt-1 text-sm font-semibold leading-6 text-slate-700">{text}</p></div>; }
function StatusBadge({ compact = false, label }: { label: string; compact?: boolean }) { return <span className={`rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700 ${compact ? "shrink-0" : ""}`}>{label}</span>; }
function roomEyebrow(access: string, isFillSquad: boolean) { if (access === "PLANNING") return isFillSquad ? "Squad planning" : "Planning room"; if (access === "RECONFIRMATION") return "Schedule change"; if (access === "READ_ONLY") return "Game history"; return isFillSquad ? "Squad room" : "Game room"; }
function roomBannerLabel(access: string, hasBooking: boolean) { if (access === "PLANNING") return "Court not booked yet"; if (access === "RECONFIRMATION") return "Schedule change requested"; if (access === "READ_ONLY") return "Read-only record"; return hasBooking ? "Verified SportSpot booking" : "Court not booked yet"; }
function RoomNotice({ title, text, tone }: { title: string; text: string; tone: "amber" | "slate" }) { return <section className={`rounded-xl border px-4 py-3 ${tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-950" : "border-slate-200 bg-slate-100 text-slate-800"}`}><p className="text-sm font-black">{title}</p><p className="mt-1 text-sm leading-6">{text}</p></section>; }
function formatDate(value: string | null) { if (!value) return "Date to be confirmed"; return formatDateTimeInNepal(value, { dateStyle: "medium", timeStyle: "short" }); }
function ChatIcon() { return <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.4 8.4 0 0 1-3.2-.6L4 20l1.4-3.5A7.5 7.5 0 1 1 20 11.5Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" /></svg>; }
