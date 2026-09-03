"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import ConfirmActionModal from "@/components/ConfirmActionModal";
import { DashboardPageHeader } from "@/components/player-dashboard/DashboardPageHeader";
import GameHostEditModal, { type GameHostEditValues } from "@/components/player-dashboard/GameHostEditModal";
import GameParticipantEditModal from "@/components/player-dashboard/GameParticipantEditModal";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { emitToast } from "@/lib/toast";
import { toNepalTime } from "@/lib/dates";
import type { EligibleGameBooking, GamePlayerLookup, GamePlayerLookupResponse, GameResponse, GameRole, JoinRequest, MatchmakingGame } from "@/types/matchmaking";

const roles: Array<{ label: string; value: GameRole }> = [
  { label: "Any role", value: "ANY" },
  { label: "Batsman", value: "BATSMAN" },
  { label: "Bowler", value: "BOWLER" },
  { label: "All-rounder", value: "ALL_ROUNDER" },
  { label: "Wicketkeeper", value: "WICKETKEEPER" },
];

type ManageResponse = { game: MatchmakingGame; join_requests?: JoinRequest[]; eligible_bookings?: EligibleGameBooking[] };
type RosterParticipant = MatchmakingGame["participants"][number];

export default function GameManagePage() {
  const params = useParams<{ gameId: string }>();
  const [game, setGame] = useState<MatchmakingGame | null>(null);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [eligibleBookings, setEligibleBookings] = useState<EligibleGameBooking[]>([]);
  const [selectedBooking, setSelectedBooking] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestRole, setGuestRole] = useState<GameRole>("ANY");
  const [inviteSportSpotId, setInviteSportSpotId] = useState("");
  const [inviteRole, setInviteRole] = useState<GameRole>("ANY");
  const [inviteMessage, setInviteMessage] = useState("");
  const [lookupPlayer, setLookupPlayer] = useState<GamePlayerLookup | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingParticipant, setEditingParticipant] = useState<MatchmakingGame["participants"][number] | null>(null);
  const [participantToRemove, setParticipantToRemove] = useState<MatchmakingGame["participants"][number] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState(false);
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
      const response = await api.get<ManageResponse>(`/api/matchmaking/games/${params.gameId}/manage/`);
      setGame(response.data.game);
      setRequests(response.data.join_requests || []);
      setEligibleBookings(response.data.eligible_bookings || []);
      if (!selectedBooking && response.data.eligible_bookings?.[0]) setSelectedBooking(String(response.data.eligible_bookings[0].id));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load this game."));
    } finally {
      setIsLoading(false);
    }
  }

  async function decide(requestId: number, decision: string) {
    if (decision === "REJECT" && !window.confirm("Decline this player request? They will be notified.")) return;
    setActionInProgress(true);
    try {
      await api.post(`/api/matchmaking/requests/${requestId}/decide/`, { decision });
      emitToast({ message: decision === "ACCEPT" ? "The player has been accepted." : decision === "WAITLIST" ? "The player has been waitlisted." : "The request has been declined.", type: "success", dedupeKey: `manage-request-${requestId}-${decision}` });
      await loadGame();
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not update this request."), type: "error", dedupeKey: `manage-request-error-${requestId}` });
    } finally {
      setActionInProgress(false);
    }
  }

  async function addGuest() {
    if (guestName.trim().length < 2) {
      emitToast({ message: "Enter the guest player's name.", type: "warning", dedupeKey: "guest-name" });
      return;
    }
    setActionInProgress(true);
    try {
      await api.post(`/api/matchmaking/games/${params.gameId}/guests/`, { guest_name: guestName.trim(), role: guestRole });
      emitToast({ message: "Guest player has been added.", type: "success", dedupeKey: `guest-added-${params.gameId}` });
      setGuestName("");
      setGuestRole("ANY");
      await loadGame();
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not add this guest player."), type: "error", dedupeKey: `guest-error-${params.gameId}` });
    } finally {
      setActionInProgress(false);
    }
  }


  async function lookupRegisteredPlayer() {
    const sportspotId = inviteSportSpotId.trim().toUpperCase();
    if (!sportspotId) {
      emitToast({ message: "Enter the player's SportSpot ID.", type: "warning", dedupeKey: "game-invite-id-empty" });
      return;
    }
    setActionInProgress(true);
    try {
      const response = await api.get<GamePlayerLookupResponse>(`/api/matchmaking/games/${params.gameId}/players/lookup/`, { params: { sportspot_id: sportspotId } });
      setLookupPlayer(response.data.player);
      if (response.data.player.preferred_role) setInviteRole(response.data.player.preferred_role);
    } catch (requestError) {
      setLookupPlayer(null);
      emitToast({ message: getApiErrorMessage(requestError, "We could not find that SportSpot player."), type: "error", dedupeKey: "game-invite-lookup-error" });
    } finally {
      setActionInProgress(false);
    }
  }

  async function inviteRegisteredPlayer() {
    const sportspotId = inviteSportSpotId.trim().toUpperCase();
    if (!sportspotId) {
      emitToast({ message: "Enter the player's SportSpot ID.", type: "warning", dedupeKey: "game-invite-id-empty" });
      return;
    }
    setActionInProgress(true);
    try {
      await api.post(`/api/matchmaking/games/${params.gameId}/invite/`, { sportspot_id: sportspotId, requested_role: inviteRole, message: inviteMessage });
      emitToast({ message: "The player invitation has been sent.", type: "success", dedupeKey: `game-invite-${params.gameId}-${sportspotId}` });
      setInviteSportSpotId("");
      setInviteRole("ANY");
      setInviteMessage("");
      setLookupPlayer(null);
      await loadGame();
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not send this invitation."), type: "error", dedupeKey: `game-invite-error-${params.gameId}` });
    } finally {
      setActionInProgress(false);
    }
  }
  async function attachBooking() {
    if (!selectedBooking) {
      emitToast({ message: "Choose a confirmed booking to attach.", type: "warning", dedupeKey: "attach-booking-empty" });
      return;
    }
    setActionInProgress(true);
    try {
      const response = await api.post<GameResponse>(`/api/matchmaking/games/${params.gameId}/attach-booking/`, { booking_id: Number(selectedBooking) });
      setGame(response.data.game);
      emitToast({ message: response.data.game.requires_reconfirmation ? `${response.data.game.registered_reconfirmation_pending_count} registered player response${response.data.game.registered_reconfirmation_pending_count === 1 ? "" : "s"} and ${response.data.game.guest_confirmation_pending_count} guest acknowledgement${response.data.game.guest_confirmation_pending_count === 1 ? "" : "s"} are needed for the updated booking.` : "Booking attached and the game is now verified.", type: "success", dedupeKey: `attach-booking-${params.gameId}` });
      await loadGame();
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not attach this booking."), type: "error", dedupeKey: `attach-booking-error-${params.gameId}` });
    } finally {
      setActionInProgress(false);
    }
  }

  function toIsoDateTime(value: string) {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  async function saveGame(values: GameHostEditValues) {
    const payload: Record<string, unknown> = {
      title: values.title.trim(),
      description: values.description.trim(),
      host_notes: values.host_notes.trim(),
      reporting_instructions: values.reporting_instructions.trim(),
      equipment_instructions: values.equipment_instructions.trim(),
      game_intensity: values.game_intensity,
      min_skill_level: values.min_skill_level,
      total_capacity: values.total_capacity,
      minimum_players_to_proceed: values.minimum_players_to_proceed,
      waitlist_enabled: values.waitlist_enabled,
      recruitment_deadline: toIsoDateTime(values.recruitment_deadline),
      role_requirements: values.role_requirements,
    };
    if (game?.creation_mode === "PLAN_FIRST" && !game.is_booking_verified) {
      payload.proposed_date = values.proposed_date;
      payload.proposed_start_time = values.proposed_start_time;
      payload.proposed_end_time = values.proposed_end_time;
      payload.preferred_district = values.preferred_district.trim();
      payload.preferred_area = values.preferred_area.trim();
      payload.preferred_area_code = values.preferred_area_code;
      payload.preferred_venue_name = values.preferred_venue_name.trim();
      payload.alternative_details = values.alternative_details.trim();
      payload.booking_deadline = toIsoDateTime(values.booking_deadline);
    }
    setActionInProgress(true);
    try {
      const response = await api.patch<GameResponse>(`/api/matchmaking/games/${params.gameId}/manage/`, payload);
      setGame(response.data.game);
      setShowEditModal(false);
      emitToast({ message: response.data.game.requires_reconfirmation ? "Game details updated. Registered players need to confirm, and offline guests need host acknowledgement." : "Your game details have been updated.", type: "success", dedupeKey: `game-edit-${params.gameId}` });
      await loadGame(true);
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not save these game changes."), type: "error", dedupeKey: `game-edit-error-${params.gameId}` });
    } finally {
      setActionInProgress(false);
    }
  }

  async function saveParticipant(payload: { role: GameRole; guest_name?: string }) {
    if (!editingParticipant) return;
    setActionInProgress(true);
    try {
      await api.patch(`/api/matchmaking/games/${params.gameId}/participants/${editingParticipant.id}/`, payload);
      setEditingParticipant(null);
      emitToast({ message: "The participant details have been updated.", type: "success", dedupeKey: `game-participant-edit-${editingParticipant.id}` });
      await loadGame(true);
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not update this participant."), type: "error", dedupeKey: `game-participant-edit-error-${editingParticipant.id}` });
    } finally {
      setActionInProgress(false);
    }
  }

  async function removeParticipant() {
    if (!participantToRemove) return;
    setActionInProgress(true);
    try {
      await api.delete(`/api/matchmaking/games/${params.gameId}/participants/${participantToRemove.id}/`);
      emitToast({ message: `${participantToRemove.full_name} has been removed from this game.`, type: "success", dedupeKey: `game-participant-remove-${participantToRemove.id}` });
      setParticipantToRemove(null);
      await loadGame(true);
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not remove this participant."), type: "error", dedupeKey: `game-participant-remove-error-${participantToRemove.id}` });
    } finally {
      setActionInProgress(false);
    }
  }

  async function confirmGuestSchedule(participant: MatchmakingGame["participants"][number]) {
    if (participant.status !== "GUEST_CONFIRMATION_REQUIRED") return;
    if (!window.confirm(`Confirm that ${participant.full_name} knows the final booking details?`)) return;
    setActionInProgress(true);
    try {
      await api.post(`/api/matchmaking/games/${params.gameId}/participants/${participant.id}/confirm-schedule/`);
      emitToast({ message: `${participant.full_name} has been marked as informed of the final schedule.`, type: "success", dedupeKey: `guest-schedule-${participant.id}` });
      await loadGame(true);
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not confirm this guest schedule."), type: "error", dedupeKey: `guest-schedule-error-${participant.id}` });
    } finally {
      setActionInProgress(false);
    }
  }

  async function inviteParticipantToTeam(participant: MatchmakingGame["participants"][number]) {
    if (!window.confirm(`Send ${participant.full_name} an invitation to join your permanent team? This is separate from their temporary place in this game.`)) return;
    setActionInProgress(true);
    try {
      await api.post(`/api/matchmaking/games/${params.gameId}/participants/${participant.id}/invite-to-team/`);
      emitToast({ message: "The permanent team invitation has been sent.", type: "success", dedupeKey: `permanent-team-invite-${participant.id}` });
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not send the permanent team invitation."), type: "error", dedupeKey: `permanent-team-invite-error-${participant.id}` });
    } finally {
      setActionInProgress(false);
    }
  }

  async function cancelGame() {
    if (cancelReason.trim().length < 5) {
      emitToast({ message: "Add a short cancellation reason.", type: "warning", dedupeKey: "game-cancel-reason" });
      return;
    }
    if (!window.confirm("Cancel this public game? The linked court booking will remain unchanged.")) return;
    setActionInProgress(true);
    try {
      await api.post(`/api/matchmaking/games/${params.gameId}/cancel/`, { reason: cancelReason.trim() });
      emitToast({ message: "The public game has been cancelled. Any linked court booking remains separate.", type: "success", dedupeKey: `game-cancel-${params.gameId}` });
      await loadGame();
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not cancel this game."), type: "error", dedupeKey: `game-cancel-error-${params.gameId}` });
    } finally {
      setActionInProgress(false);
    }
  }

  async function closeRecruitment() {
    if (!window.confirm("Close recruitment? Accepted participants will keep their spots, and any linked court booking will remain unchanged.")) return;
    setActionInProgress(true);
    try {
      await api.post(`/api/matchmaking/games/${params.gameId}/close-recruitment/`);
      emitToast({ message: "Recruitment is closed. Existing participants remain in the game.", type: "success", dedupeKey: `game-close-recruitment-${params.gameId}` });
      await loadGame();
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not close recruitment."), type: "error", dedupeKey: `game-close-recruitment-error-${params.gameId}` });
    } finally {
      setActionInProgress(false);
    }
  }

  async function reopenRecruitment() {
    if (!window.confirm("Reopen recruitment? New players will be able to discover and request to join this game again.")) return;
    setActionInProgress(true);
    try {
      await api.post(`/api/matchmaking/games/${params.gameId}/reopen-recruitment/`);
      emitToast({ message: "Recruitment is open again.", type: "success", dedupeKey: `game-reopen-recruitment-${params.gameId}` });
      await loadGame();
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not reopen recruitment."), type: "error", dedupeKey: `game-reopen-recruitment-error-${params.gameId}` });
    } finally {
      setActionInProgress(false);
    }
  }

  if (isLoading) return <div className="sport-surface h-[560px] animate-pulse" />;
  if (error || !game) return <section className="sport-error-state"><h1 className="text-xl font-bold text-red-950">Game unavailable</h1><p className="mt-2 text-sm font-semibold text-red-700">{error}</p><button className="sport-primary-button mt-5 bg-red-600 hover:bg-red-700" onClick={() => loadGame()} type="button">Retry</button></section>;

  const pendingRequests = requests.filter((request) => request.status === "PENDING");
  const waitlistedRequests = requests.filter((request) => request.status === "WAITLISTED");
  const invitedRequests = requests.filter((request) => request.status === "INVITED");
  const canEditGame = game.user_state.is_host && !["CANCELLED", "COMPLETED", "IN_PROGRESS", "BOOKING_PENDING"].includes(game.status);
  const canOpenRoom = game.user_state.room_access && game.user_state.room_access !== "NONE";

  return (
    <div className="space-y-5">
      <DashboardPageHeader eyebrow={game.game_type === "FILL_SQUAD" ? "Fill My Squad Host" : "Pickup Game Host"} title={game.title} description={`${game.venue_name} - ${game.booking_display_time}`} actions={<div className="flex flex-wrap items-center gap-2">{canEditGame ? <button className="sport-secondary-button min-h-11" onClick={() => setShowEditModal(true)} type="button">Edit game</button> : null}{canOpenRoom ? <Link className="sport-primary-button min-h-11" href={`/dashboard/player/games/${game.id}/room`}>{roomLinkLabel(game)}</Link> : null}</div>} />
      {!canEditGame && game.user_state.is_host ? <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">This game is {game.status_label.toLowerCase()} and can no longer be edited.</p> : null}
      {game.requires_reconfirmation ? <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4"><h2 className="font-black text-amber-950">Schedule update needs attention</h2><p className="mt-1 text-sm font-semibold leading-6 text-amber-800">The confirmed booking differs from the plan shared with the roster. Registered players must confirm or decline the new details. Offline guests cannot respond in SportSpot, so confirm with each guest and use the action on their roster entry.</p><div className="mt-3 flex flex-wrap gap-3 text-xs font-black text-amber-900"><span>{game.registered_reconfirmation_pending_count} player response{game.registered_reconfirmation_pending_count === 1 ? "" : "s"} pending</span><span>{game.guest_confirmation_pending_count} guest acknowledgement{game.guest_confirmation_pending_count === 1 ? "" : "s"} pending</span></div></section> : null}
      <section className="grid gap-4 md:grid-cols-5"><Metric label="Occupied" value={`${game.occupied_spots_count}/${game.total_capacity}`} /><Metric label="Confirmed" value={game.confirmed_participants_count} /><Metric label="Provisional" value={game.provisional_participants_count} /><Metric label="Open spots" value={game.available_spots} /><Metric label="Waitlist" value={game.waitlist_count} /></section>

      {!game.is_booking_verified && game.creation_mode === "PLAN_FIRST" ? <PlanFirstBookingPanel actionInProgress={actionInProgress} attachBooking={attachBooking} eligibleBookings={eligibleBookings} game={game} selectedBooking={selectedBooking} setSelectedBooking={setSelectedBooking} /> : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-xl font-black text-sportNavy">{game.game_type === "FILL_SQUAD" ? "Temporary role progress" : "Role progress"}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{game.role_progress.map((item) => <div className="rounded-xl border border-slate-200 p-4" key={item.role}><div className="flex items-center justify-between"><p className="font-black text-sportNavy">{item.role_label}</p><Badge tone={item.is_filled ? "green" : "slate"}>{item.filled_count}/{item.required_count}</Badge></div><div className="mt-3 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-sportGreen" style={{ width: `${Math.min((item.filled_count / Math.max(item.required_count, 1)) * 100, 100)}%` }} /></div></div>)}</div></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="text-xl font-black text-sportNavy">Join requests</h2><Badge>{pendingRequests.length} pending</Badge></div><RequestList requests={pendingRequests} empty="No pending requests." onDecision={decide} disabled={actionInProgress} /></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="text-xl font-black text-sportNavy">Waitlist</h2><Badge tone="blue">{waitlistedRequests.length} players</Badge></div><RequestList requests={waitlistedRequests} empty="No waitlisted players." onDecision={decide} disabled={actionInProgress} /></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="text-xl font-black text-sportNavy">Invited players</h2><Badge tone="blue">{invitedRequests.length} sent</Badge></div><RequestList requests={invitedRequests} empty="No pending invitations." onDecision={decide} disabled={actionInProgress} /></section>
        </div>
        <aside className="space-y-4">
          <RosterCard actionInProgress={actionInProgress} game={game} onConfirmGuest={confirmGuestSchedule} onEdit={setEditingParticipant} onInviteToTeam={inviteParticipantToTeam} onRemove={setParticipantToRemove} />
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-xl font-black text-sportNavy">Invite registered player</h2><p className="mt-1 text-sm font-semibold text-slate-600">Invite a SportSpot player by ID. They must accept before joining the roster.</p><div className="mt-4 flex gap-2"><input className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 px-4 text-sm font-bold uppercase" placeholder="SSP-1001" value={inviteSportSpotId} onChange={(event) => { setInviteSportSpotId(event.target.value); setLookupPlayer(null); }} /><button className="min-h-12 rounded-xl border border-green-200 px-4 text-sm font-black text-sportGreen disabled:opacity-60" disabled={actionInProgress} onClick={lookupRegisteredPlayer} type="button">Find</button></div>{lookupPlayer ? <div className="mt-3 rounded-xl bg-green-50 p-3"><p className="font-black text-sportNavy">{lookupPlayer.full_name}</p><p className="text-sm font-semibold text-slate-600">{lookupPlayer.sportspot_id} - {lookupPlayer.skill_level || "Skill not set"}</p>{lookupPlayer.reliability_label ? <p className="mt-1 text-xs font-black text-sportGreen">{lookupPlayer.reliability_label}</p> : null}</div> : null}<select className="mt-3 h-12 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as GameRole)}>{roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select><textarea className="mt-3 min-h-20 w-full rounded-xl border border-slate-200 p-3 text-sm font-semibold" placeholder="Optional message" value={inviteMessage} onChange={(event) => setInviteMessage(event.target.value)} /><button className="mt-3 min-h-11 w-full rounded-xl bg-sportGreen text-sm font-black text-white disabled:opacity-60" disabled={actionInProgress || (game.available_spots <= 0 && !game.waitlist_enabled)} onClick={inviteRegisteredPlayer} type="button">{game.available_spots <= 0 && game.waitlist_enabled ? "Invite to Waitlist" : "Send Invitation"}</button></section>          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-xl font-black text-sportNavy">Add guest player</h2><p className="mt-1 text-sm font-semibold text-slate-600">Guests occupy player spots but do not receive SportSpot notifications or Game Room access.</p><input className="mt-4 h-12 w-full rounded-xl border border-slate-200 px-4 text-sm font-bold" placeholder="Guest display name" value={guestName} onChange={(event) => setGuestName(event.target.value)} /><select className="mt-3 h-12 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold" value={guestRole} onChange={(event) => setGuestRole(event.target.value as GameRole)}>{roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select><button className="mt-3 min-h-11 w-full rounded-xl bg-sportGreen text-sm font-black text-white disabled:opacity-60" disabled={actionInProgress || game.available_spots <= 0} onClick={addGuest} type="button">Add Guest</button></section>
          {game.user_state.is_host && !["CANCELLED", "COMPLETED", "IN_PROGRESS"].includes(game.status) ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <h2 className="text-lg font-black text-sportNavy">Manage recruitment</h2>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
                  Closing recruitment stops new requests but keeps accepted participants and the court booking together. Cancelling the game ends this coordination only; it does not cancel a court booking or decide a refund.
                </p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {(game.status === "RECRUITING" || game.status === "FULL") ? <button className="min-h-11 rounded-xl border border-green-200 bg-green-50 px-4 text-sm font-black text-green-800 hover:bg-green-100 disabled:opacity-60" disabled={actionInProgress} onClick={closeRecruitment} type="button">Close recruitment</button> : null}
                {game.status === "CLOSED" && !game.is_public ? <button className="min-h-11 rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-black text-blue-800 hover:bg-blue-100 disabled:opacity-60" disabled={actionInProgress} onClick={reopenRecruitment} type="button">Reopen recruitment</button> : null}
              </div>
              {game.booking ? <Link className="mt-3 inline-flex text-sm font-black text-sportGreen hover:underline" href={`/dashboard/player/bookings/${game.booking}`}>Open linked booking</Link> : null}
              <div className="mt-5 border-t border-red-100 pt-4">
                <h3 className="text-sm font-black text-red-950">Cancel this game</h3>
                <p className="mt-1 text-sm font-semibold leading-6 text-red-700">The game will leave discovery and its open requests will close. Any linked booking remains available for you to manage separately under My Bookings.</p>
                <textarea className="mt-3 min-h-20 w-full rounded-xl border border-red-200 bg-red-50/40 p-3 text-sm" onChange={(e) => setCancelReason(e.target.value)} placeholder="Why are you cancelling this game?" value={cancelReason} />
                <button className="mt-3 min-h-11 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-60" disabled={actionInProgress} onClick={cancelGame} type="button">Cancel game</button>
              </div>
            </section>
          ) : null}
        </aside>
      </section>
      {showEditModal && canEditGame ? <GameHostEditModal game={game} isSaving={actionInProgress} onClose={() => setShowEditModal(false)} onSave={saveGame} /> : null}
      {editingParticipant ? <GameParticipantEditModal isSaving={actionInProgress} onClose={() => setEditingParticipant(null)} onSave={saveParticipant} participant={editingParticipant} /> : null}
      {participantToRemove ? <ConfirmActionModal actionLabel="Remove participant" body={`${participantToRemove.full_name} will lose access to this game's private room. Their player spot will become available again.`} isWorking={actionInProgress} onCancel={() => setParticipantToRemove(null)} onConfirm={removeParticipant} title="Remove this participant?" /> : null}
    </div>
  );
}


function PlanFirstBookingPanel({ actionInProgress, attachBooking, eligibleBookings, game, selectedBooking, setSelectedBooking }: { actionInProgress: boolean; attachBooking: () => void; eligibleBookings: EligibleGameBooking[]; game: MatchmakingGame; selectedBooking: string; setSelectedBooking: (value: string) => void }) {
  const neededPlayers = Math.max(game.minimum_players_to_proceed - game.occupied_spots_count, 0);
  const canUseGuidedBooking = neededPlayers === 0 && !["CANCELLED", "IN_PROGRESS", "COMPLETED"].includes(game.status);
  const bookingHref = buildGuidedBookingHref(game);

  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Planning - Court Not Booked Yet</p>
          <h2 className="mt-1 text-xl font-black text-blue-950">Book a court for this game</h2>
          <p className="mt-1 text-sm font-semibold leading-6 text-blue-800">
            {canUseGuidedBooking
              ? "Your minimum player threshold is ready. Choose an available SportSpot court, pay with Khalti, and the game will update automatically after payment succeeds."
              : `You need ${neededPlayers} more player spot${neededPlayers === 1 ? "" : "s"} before the guided booking handoff opens.`}
          </p>
        </div>
        {canUseGuidedBooking ? (
          <Link className="inline-flex min-h-11 items-center justify-center rounded-xl bg-sportGreen px-5 text-sm font-black text-white hover:bg-green-700" href={bookingHref}>Book Court for Game</Link>
        ) : (
          <span className="inline-flex min-h-11 items-center justify-center rounded-xl border border-blue-200 bg-white px-5 text-sm font-black text-blue-700">Recruit players first</span>
        )}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MiniInfo label="Minimum needed" value={`${game.occupied_spots_count}/${game.minimum_players_to_proceed}`} />
      <MiniInfo label="Proposed area" value={[game.preferred_area, game.preferred_district].filter(Boolean).join(", ") || "Not set"} />
        <MiniInfo label="Proposed time" value={game.booking_display_time || "Not set"} />
      </div>
      {eligibleBookings.length ? <div className="mt-4 rounded-xl border border-blue-100 bg-white/80 p-4"><p className="text-sm font-black text-blue-950">Already booked outside this flow?</p><div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><select className="h-12 rounded-xl border border-blue-200 bg-white px-3 text-sm font-bold" value={selectedBooking} onChange={(event) => setSelectedBooking(event.target.value)}>{eligibleBookings.map((booking) => <option key={booking.id} value={booking.id}>{booking.venue_name} - {booking.court_name} - {booking.booking_display_time}</option>)}</select><button className="min-h-12 rounded-xl bg-blue-700 px-5 text-sm font-black text-white disabled:opacity-60" disabled={actionInProgress} onClick={attachBooking} type="button">Attach Booking</button></div></div> : null}
    </section>
  );
}

function MiniInfo({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-white/80 px-4 py-3"><p className="text-[11px] font-black uppercase tracking-[0.14em] text-blue-600">{label}</p><p className="mt-1 text-sm font-black text-blue-950">{value}</p></div>;
}

function RosterCard({ actionInProgress, game, onConfirmGuest, onEdit, onInviteToTeam, onRemove }: { actionInProgress: boolean; game: MatchmakingGame; onConfirmGuest: (participant: RosterParticipant) => void; onEdit: (participant: RosterParticipant) => void; onInviteToTeam: (participant: RosterParticipant) => void; onRemove: (participant: RosterParticipant) => void }) {
  const guestConfirmationCount = game.participants.filter((participant) => participant.status === "GUEST_CONFIRMATION_REQUIRED").length;
  const isHost = game.user_state.is_host;

  return (
    <section className="sport-surface p-4 sm:p-5">
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold tracking-tight text-sportNavy">Roster</h2>
            {guestConfirmationCount > 0 && isHost ? <Badge tone="amber">Action needed</Badge> : null}
          </div>
          <p className="mt-1 max-w-md text-sm leading-5 text-slate-500">Manage this game&apos;s participants. Permanent team membership is unchanged.</p>
        </div>
        <div aria-label={`${game.occupied_spots_count} of ${game.total_capacity} player spots filled`} className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-right leading-none">
          <span className="text-base font-bold text-sportNavy">{game.occupied_spots_count}</span>
          <span className="ml-1 text-xs font-semibold text-slate-500">/ {game.total_capacity}</span>
          <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">filled</span>
        </div>
      </header>

      <div className="mt-4 space-y-2.5">
        {game.participants.map((participant) => {
          const canEdit = isHost && participant.participant_type !== "HOST" && ["RECRUITING", "FULL", "CLOSED"].includes(game.status);
          const needsGuestConfirmation = isHost && participant.status === "GUEST_CONFIRMATION_REQUIRED";
          const canInviteToPermanentTeam = isHost
            && game.game_type === "FILL_SQUAD"
            && game.status === "COMPLETED"
            && participant.participant_type === "TEMPORARY"
            && participant.status === "CONFIRMED"
            && Boolean(participant.sportspot_id);

          return (
            <article className={`rounded-xl border bg-white p-3.5 transition-colors ${needsGuestConfirmation ? "border-amber-200 bg-amber-50/30" : "border-slate-200 hover:border-slate-300"}`} key={participant.id}>
              <div className="flex min-w-0 items-start gap-2.5">
                <div aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${needsGuestConfirmation ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-sportNavy"}`}>
                  {getInitials(participant.full_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold text-sportNavy">{participant.full_name}</h3>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{participant.role_label}<span aria-hidden="true" className="mx-1.5 text-slate-300">·</span>{participant.participant_type_label}</p>
                    </div>
                    <ParticipantStatusBadge participant={participant} />
                  </div>
                  {participant.sportspot_id ? <p className="mt-1 text-xs font-semibold text-slate-400">{participant.sportspot_id}</p> : null}
                  {needsGuestConfirmation ? <p className="mt-2 text-xs font-semibold text-amber-700">Offline guest · confirm final schedule</p> : null}
                </div>
              </div>

              {needsGuestConfirmation || canEdit || canInviteToPermanentTeam ? <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
                {needsGuestConfirmation ? <button aria-label={`Confirm ${participant.full_name}'s schedule`} className="sport-primary-button min-h-9 px-3 py-2 text-xs" disabled={actionInProgress} onClick={() => onConfirmGuest(participant)} title="Confirm guest schedule" type="button">Confirm schedule</button> : null}
                {canInviteToPermanentTeam ? <button aria-label={`Invite ${participant.full_name} to the permanent team`} className="sport-secondary-button min-h-9 px-3 py-2 text-xs" disabled={actionInProgress} onClick={() => onInviteToTeam(participant)} type="button">Invite to permanent team</button> : null}
                {canEdit ? <button aria-label={`Edit ${participant.full_name}`} className="sport-secondary-button min-h-9 px-3 py-2 text-xs" onClick={() => onEdit(participant)} type="button">Edit</button> : null}
                {canEdit ? <button aria-label={`Remove ${participant.full_name}`} className="inline-flex min-h-9 items-center justify-center rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-200 focus-visible:ring-offset-2" onClick={() => onRemove(participant)} type="button">Remove</button> : null}
              </div> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function roomLinkLabel(game: MatchmakingGame) { if (game.user_state.room_access === "READ_ONLY") return "View Game Record"; if (game.user_state.room_access === "RECONFIRMATION") return "Review Schedule Change"; if (game.game_type === "FILL_SQUAD") return game.is_booking_verified ? "Open Squad Room" : "Open Squad Planning"; return game.is_booking_verified ? "Open Game Room" : "Open Planning Room"; }

function ParticipantStatusBadge({ participant }: { participant: RosterParticipant }) {
  const tone = participant.status === "CONFIRMED" ? "green" : participant.status === "GUEST_CONFIRMATION_REQUIRED" ? "amber" : participant.status === "RECONFIRM_REQUIRED" ? "blue" : "slate";
  const label = participant.status === "GUEST_CONFIRMATION_REQUIRED" ? "Host confirmation needed" : participant.status_label;
  return <Badge tone={tone}>{label}</Badge>;
}

function getInitials(name: string) {
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return initials || "?";
}

function buildGuidedBookingHref(game: MatchmakingGame) {
  const query = new URLSearchParams();
  query.set("matchmaking_game", String(game.id));
  query.set("game_title", game.title);
  if (game.proposed_date) query.set("date", game.proposed_date);
  if (game.preferred_area) query.set("area", game.preferred_area);
  const startTime = (game.proposed_start_time?.slice(0, 5) || (game.start_at ? toNepalTime(game.start_at) : ""));
  if (startTime) query.set("start_time", startTime);
  const duration = getGameDurationMinutes(game);
  if (duration) query.set("duration", String(duration));
  return `/courts?${query.toString()}`;
}

function getGameDurationMinutes(game: MatchmakingGame) {
  if (game.start_at && game.end_at) {
    const minutes = Math.round((new Date(game.end_at).getTime() - new Date(game.start_at).getTime()) / 60000);
    return [60, 120, 180].includes(minutes) ? minutes : 60;
  }
  if (game.proposed_start_time && game.proposed_end_time) {
    const [startHour, startMinute] = game.proposed_start_time.split(":").map(Number);
    const [endHour, endMinute] = game.proposed_end_time.split(":").map(Number);
    const minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
    return [60, 120, 180].includes(minutes) ? minutes : 60;
  }
  return 60;
}

function RequestList({ disabled, empty, onDecision, requests }: { requests: JoinRequest[]; empty: string; disabled: boolean; onDecision: (id: number, decision: string) => void }) {
  if (!requests.length) return <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">{empty}</p>;
  return <div className="mt-4 space-y-3">{requests.map((request) => {
    const canDecide = request.status === "PENDING" || request.status === "WAITLISTED";
    return <div className="rounded-xl border border-slate-200 p-4" key={request.id}><div className="flex items-start justify-between gap-3"><div><p className="font-black text-sportNavy">{request.player_name}</p><p className="mt-1 text-sm font-semibold text-slate-500">Requested {request.requested_role_label} - {request.reliability_label || "New Player"}</p>{request.average_rating ? <p className="mt-1 text-xs font-black text-sportGreen">Rating {Number(request.average_rating).toFixed(1)}/5</p> : null}{request.message ? <p className="mt-2 text-sm text-slate-600">{request.message}</p> : null}</div><Badge>{request.status.toLowerCase()}</Badge></div>{canDecide ? <div className="mt-3 flex flex-wrap gap-2"><button className="rounded-lg bg-sportGreen px-3 py-2 text-xs font-black text-white disabled:opacity-60" disabled={disabled} onClick={() => onDecision(request.id, "ACCEPT")} type="button">Accept</button><button className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black disabled:opacity-60" disabled={disabled} onClick={() => onDecision(request.id, "WAITLIST")} type="button">Waitlist</button><button className="rounded-lg border border-red-200 px-3 py-2 text-xs font-black text-red-600 disabled:opacity-60" disabled={disabled} onClick={() => onDecision(request.id, "REJECT")} type="button">Decline</button></div> : <p className="mt-3 text-xs font-black uppercase tracking-wide text-slate-500">Waiting for player response</p>}</div>;
  })}</div>;
}
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-sportNavy">{value}</p></div>; }
function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "blue" | "amber" }) { const classes = tone === "green" ? "border-green-200 bg-green-50 text-sportGreen" : tone === "blue" ? "border-blue-200 bg-blue-50 text-blue-700" : tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-600"; return <span className={`sport-status whitespace-nowrap ${classes}`}>{children}</span>; }



