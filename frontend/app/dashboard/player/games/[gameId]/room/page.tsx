"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { DashboardPageHeader } from "@/components/player-dashboard/DashboardPageHeader";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { emitToast } from "@/lib/toast";
import type { GameResponse, MatchmakingGame } from "@/types/matchmaking";

export default function GameRoomPage() {
  const params = useParams<{ gameId: string }>();
  const [game, setGame] = useState<MatchmakingGame | null>(null);
  const [note, setNote] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { loadRoom(); }, [params.gameId]);

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

  if (isLoading) return <div className="h-[480px] animate-pulse rounded-2xl bg-white" />;
  if (error || !game) return <section className="rounded-2xl border border-red-100 bg-red-50 p-6"><h1 className="text-xl font-black text-red-950">Game room unavailable</h1><p className="mt-2 text-sm font-semibold text-red-700">{error}</p><button className="mt-5 rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white" onClick={loadRoom} type="button">Retry</button></section>;

  const isPlanning = !game.is_booking_verified;
  const isFillSquad = game.game_type === "FILL_SQUAD";
  return (
    <div className="space-y-5">
      <DashboardPageHeader eyebrow={isPlanning ? (isFillSquad ? "Squad Planning" : "Planning Room") : (isFillSquad ? "Squad Room" : "Game Room")} title={isFillSquad ? (isPlanning ? "Fill My Squad Planning" : "Fill My Squad Room") : (isPlanning ? "Pickup Planning Room" : "Pickup Game Room")} description={`${game.title} - ${game.booking_display_time}`} actions={game.user_state.is_host ? <Link className="rounded-xl border border-green-200 px-5 py-3 text-sm font-black text-sportGreen" href={`/dashboard/player/games/${game.id}`}>Manage Game</Link> : undefined} />
      <section className={`rounded-2xl border p-5 shadow-sm ${isPlanning ? "border-blue-200 bg-blue-50" : "border-green-200 bg-green-50"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className={`text-xs font-black uppercase tracking-[0.18em] ${isPlanning ? "text-blue-700" : "text-sportGreen"}`}>{isPlanning ? "Court not booked yet" : "Verified SportSpot Booking"}</p><h2 className="mt-1 text-xl font-black text-sportNavy">{isPlanning ? (isFillSquad ? "This squad room is for selected team members and accepted temporary players." : "This room is for planning and coordination.") : `${game.venue_name} - ${game.court_name}`}</h2><p className="mt-1 text-sm font-semibold text-slate-600">{isPlanning ? `${[game.preferred_area, game.preferred_district].filter(Boolean).join(", ")} - host must book before ${formatDate(game.booking_deadline)}` : `${game.venue_address || game.venue_area} - ${game.booking_code}`}</p></div>
          <StatusBadge label={game.status_label} />
        </div>
      </section>
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-xl font-black text-sportNavy">Schedule</h2><div className="mt-4 grid gap-3 sm:grid-cols-3"><Info label="Date and time" value={`${formatDate(game.start_at)} - ${game.booking_display_time}`} /><Info label="Venue" value={game.venue_name} /><Info label="Court" value={game.court_name} /></div>{game.requires_reconfirmation ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4"><p className="text-sm font-black text-amber-950">The final booking differs from the original plan.</p>{game.user_state.requires_reconfirmation ? <><p className="mt-1 text-sm font-semibold leading-6 text-amber-800">Confirm that this venue and time still work for you. You can decline without a reliability penalty.</p><div className="mt-3 flex flex-wrap gap-2"><button className="min-h-10 rounded-lg bg-sportGreen px-4 text-sm font-black text-white disabled:opacity-60" disabled={isSubmitting} onClick={() => reconfirm("RECONFIRM")} type="button">Confirm my spot</button><button className="min-h-10 rounded-lg border border-amber-300 bg-white px-4 text-sm font-black text-amber-800 disabled:opacity-60" disabled={isSubmitting} onClick={() => reconfirm("DECLINE")} type="button">I cannot attend</button></div></> : game.user_state.is_host ? <p className="mt-1 text-sm font-semibold leading-6 text-amber-800">{game.registered_reconfirmation_pending_count} registered player response{game.registered_reconfirmation_pending_count === 1 ? "" : "s"} and {game.guest_confirmation_pending_count} guest acknowledgement{game.guest_confirmation_pending_count === 1 ? "" : "s"} still pending. <Link className="font-black underline" href={`/dashboard/player/games/${game.id}`}>Manage responses</Link></p> : <p className="mt-1 text-sm font-semibold leading-6 text-amber-800">The host is coordinating the updated schedule with the roster.</p>}</div> : null}</section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-xl font-black text-sportNavy">Instructions</h2>{game.reporting_instructions ? <InfoBlock title="Reporting" text={game.reporting_instructions} /> : null}{game.equipment_instructions ? <InfoBlock title="Equipment" text={game.equipment_instructions} /> : null}{game.user_state.is_host ? <><textarea className="mt-4 min-h-40 w-full rounded-xl border border-slate-200 p-4 text-sm font-semibold" onChange={(event) => setNote(event.target.value)} placeholder="Arrival point, equipment, lineup or simple coordination notes." value={note} /><button className="mt-3 rounded-xl bg-sportGreen px-4 py-2.5 text-sm font-black text-white" onClick={saveNote} type="button">Save Instructions</button></> : <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">{game.game_room_note || "The host has not added private instructions yet."}</p>}</section>
          {isPlanning ? <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-xl font-black text-sportNavy">Planning progress</h2><div className="mt-4 grid gap-3 sm:grid-cols-3"><Info label="Minimum needed" value={`${game.minimum_players_to_proceed} players`} /><Info label="Provisional" value={game.provisional_participants_count} /><Info label="Open spots" value={game.available_spots} /></div></section> : null}
        </div>
        <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-xl font-black text-sportNavy">Roster</h2><div className="mt-4 space-y-2">{game.participants.map((participant) => <div className="rounded-xl bg-slate-50 p-3" key={participant.id}><div className="flex items-start justify-between gap-2"><div><p className="font-black text-sportNavy">{participant.full_name}</p><p className="text-sm font-semibold text-slate-500">{participant.role_label} - {participant.participant_type_label}</p></div><StatusBadge label={participant.status_label} compact /></div></div>)}</div></aside>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | number | null }) { return <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-black text-sportNavy">{value || "To be confirmed"}</p></div>; }
function InfoBlock({ text, title }: { title: string; text: string }) { return <div className="mt-4 rounded-xl bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-500">{title}</p><p className="mt-1 text-sm font-semibold leading-6 text-slate-700">{text}</p></div>; }
function StatusBadge({ compact = false, label }: { label: string; compact?: boolean }) { return <span className={`rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700 ${compact ? "shrink-0" : ""}`}>{label}</span>; }
function formatDate(value: string | null) { if (!value) return "Date to be confirmed"; return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
