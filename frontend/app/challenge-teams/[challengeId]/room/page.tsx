"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import BackButton from "@/components/BackButton";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateTimeInNepal } from "@/lib/dates";
import { emitToast } from "@/lib/toast";
import type { FixtureEligiblePlayer, TeamChallenge, TeamFixture, TeamFixtureParticipant } from "@/types/teamChallenge";

type RoomResponse = { challenge: TeamChallenge; fixture: TeamFixture };

export default function TeamChallengeRoomPage() {
  const params = useParams<{ challengeId: string }>();
  const [data, setData] = useState<RoomResponse | null>(null);
  const [eligiblePlayers, setEligiblePlayers] = useState<FixtureEligiblePlayer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [action, setAction] = useState<"add" | "remove" | "attendance" | "result" | "confirm" | null>(null);
  const [resultDraft, setResultDraft] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void loadRoom();
  }, [params.challengeId]);

  async function loadRoom() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<RoomResponse>(`/api/team-challenges/challenges/${params.challengeId}/room/`);
      setData(response.data);
      setResultDraft(response.data.fixture.result || "");
      if (response.data.fixture.permissions.can_manage_lineup) {
        await loadEligiblePlayers(response.data.fixture.id);
      } else {
        setEligiblePlayers([]);
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not open this Game Room."));
    } finally {
      setIsLoading(false);
    }
  }

  async function loadEligiblePlayers(fixtureId: number) {
    try {
      const response = await api.get<{ players: FixtureEligiblePlayer[] }>(`/api/team-challenges/fixtures/${fixtureId}/eligible-players/`);
      setEligiblePlayers(response.data.players);
    } catch {
      setEligiblePlayers([]);
    }
  }

  async function updateFixture(
    kind: Exclude<"add" | "remove" | "attendance" | "result" | "confirm", null>,
    path: string,
    payload: Record<string, unknown> | undefined,
    successMessage: string,
  ) {
    if (!data || action) return;
    setAction(kind);
    try {
      const response = await api.post<{ fixture: TeamFixture }>(path, payload);
      setData((current) => current ? { ...current, fixture: response.data.fixture } : current);
      setResultDraft(response.data.fixture.result || "");
      if (response.data.fixture.permissions.can_manage_lineup) {
        await loadEligiblePlayers(response.data.fixture.id);
      }
      emitToast({ message: successMessage, type: "success", dedupeKey: `team-fixture-${kind}-${data.fixture.id}` });
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not update this team match. Please try again."), type: "error", dedupeKey: `team-fixture-${kind}-error` });
    } finally {
      setAction(null);
    }
  }

  if (isLoading) return <RoomSkeleton />;
  if (!data) {
    return (
      <main className="min-h-screen bg-[var(--sport-canvas)] px-4 py-10 sm:px-6">
        <section className="sport-error-state mx-auto max-w-2xl text-center">
          <h1 className="text-xl font-black text-red-950">We could not open this Game Room.</h1>
          <p className="mt-2 text-sm font-semibold text-red-800">{error || "This room is not available for your account."}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button className="sport-primary-button bg-red-600 hover:bg-red-700" onClick={() => void loadRoom()} type="button">Try again</button>
            <Link className="sport-secondary-button" href={`/challenge-teams/${params.challengeId}`}>Back to challenge</Link>
          </div>
        </section>
      </main>
    );
  }

  const { challenge, fixture } = data;
  const booking = fixture.booking_summary;
  const roomState = fixture.room_state;
  const isReadOnly = roomState === "READ_ONLY";
  const canManage = fixture.permissions.is_captain && !isReadOnly;
  const ownParticipants = fixture.participants.filter((participant) => participant.team === fixture.permissions.team_id);
  return (
    <main className="min-h-screen bg-[var(--sport-canvas)] px-4 py-8 sm:px-6 lg:py-10">
      <div className="mx-auto max-w-5xl space-y-5">
        <BackButton href={`/challenge-teams/${challenge.id}`} label="Back to challenge" />
        <header className="sport-surface p-5 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="sport-eyebrow">{roomStateLabel(roomState)}</p>
              <h1 className="sport-page-title mt-1">{challenge.challenger_team.name} <span className="text-slate-400">vs</span> {challenge.challenged_team?.name || "Opposing team"}</h1>
              <p className="sport-page-description">{roomDescription(roomState, Boolean(booking))}</p>
            </div>
            <span className={`sport-status ${roomState === "READ_ONLY" ? "border-slate-200 bg-slate-100 text-slate-700" : roomState === "RECONFIRMATION" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-green-200 bg-green-50 text-sportGreen"}`}>{roomStateLabel(roomState)}</span>
          </div>
        </header>

        {roomState === "PLANNING" ? <RoomNotice tone="blue" title="Planning Room" text="Both teams can coordinate here while the court is being arranged. A booking has not been attached yet." /> : null}
        {roomState === "RECONFIRMATION" ? <RoomNotice tone="amber" title="Schedule confirmation needed" text="The match plan changed. Review the latest schedule with your captain before the response deadline." /> : null}
        {isReadOnly ? <RoomNotice tone="slate" title={fixture.status === "COMPLETED" ? "Match history" : "Match closed"} text="This room is read-only. The roster, schedule and result remain available for your records." /> : null}

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            <section className="sport-surface p-5 sm:p-6">
              <SectionHeading title="Match details" description={booking ? "The confirmed booking is the source of truth for this match." : "The latest agreed proposal is shown until a court booking is attached."} />
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Info label={booking ? "Venue and court" : "Preferred area"} value={booking ? `${booking.venue_name} · ${booking.court_name}` : [challenge.current_proposal.preferred_area, challenge.current_proposal.preferred_district].filter(Boolean).join(", ") || "Area to be confirmed"} />
                <Info label="When" value={booking ? `${formatDate(booking.start_at)} - ${formatTime(booking.end_at)}` : proposalSchedule(challenge)} />
                <Info label="Booking reference" value={booking?.booking_code || (booking ? "Not available" : "Court not booked yet")} />
                <Info label="Payment" value={booking ? formatStatus(booking.payment_status) : "Not applicable yet"} />
              </div>
              {fixture.result ? <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4"><p className="text-xs font-black uppercase tracking-[0.12em] text-green-800">Match result</p><p className="mt-1 font-bold text-green-950">{fixture.result}</p><p className="mt-1 text-sm text-green-800">{fixture.result_confirmed_at ? "Confirmed by both team captains." : "Waiting for the other captain to confirm."}</p></div> : null}
            </section>
            {canManage && fixture.permissions.can_manage_lineup ? <section className="sport-surface p-5 sm:p-6"><SectionHeading title="Manage your lineup" description="Select active registered members who are playing for your team." /><div className="mt-4 space-y-2">{eligiblePlayers.length ? eligiblePlayers.map((player) => <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between" key={player.player_id}><div className="min-w-0"><p className="truncate font-bold text-sportNavy">{player.player_name}</p><p className="mt-1 text-xs font-semibold text-slate-500">{formatStatus(player.cricksal_role)}{player.sportspot_id ? ` · ${player.sportspot_id}` : ""}</p></div><button className="sport-secondary-button shrink-0" disabled={Boolean(action)} onClick={() => void updateFixture("add", `/api/team-challenges/fixtures/${fixture.id}/participants/`, { player_id: player.player_id }, "The player has been added to the lineup.")} type="button">{action === "add" ? "Adding..." : "Add to lineup"}</button></div>) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">All available members are already listed, or no active members are available.</p>}</div></section> : null}
            {fixture.permissions.can_record_attendance ? <section className="sport-surface p-5 sm:p-6"><SectionHeading title="Attendance" description="Record attendance for your team after the match has finished." /><div className="mt-4 space-y-2">{ownParticipants.length ? ownParticipants.map((participant) => <AttendanceRow key={participant.id} action={action} participant={participant} onAttendance={(attendanceStatus) => void updateFixture("attendance", `/api/team-challenges/fixtures/${fixture.id}/participants/${participant.id}/attendance/`, { status: attendanceStatus }, `${participant.player_name}'s attendance has been recorded.`)} />) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No players from your team have been selected yet.</p>}</div></section> : null}
            {fixture.status === "COMPLETED" && canManage ? <section className="sport-surface p-5 sm:p-6"><SectionHeading title="Match result" description="One captain submits the result and the other captain confirms it." />{!fixture.result_confirmed_at ? <textarea className="sport-field mt-4 min-h-24 w-full" disabled={!fixture.permissions.can_submit_result || Boolean(action)} maxLength={200} onChange={(event) => setResultDraft(event.target.value)} placeholder="For example: Kathmandu Kings won by 4 wickets" value={resultDraft} /> : null}<div className="mt-3 flex flex-wrap gap-2">{fixture.permissions.can_submit_result && !fixture.result_confirmed_at ? <button className="sport-primary-button" disabled={!resultDraft.trim() || Boolean(action)} onClick={() => void updateFixture("result", `/api/team-challenges/fixtures/${fixture.id}/result/`, { result: resultDraft.trim() }, "The match result has been submitted.")} type="button">{action === "result" ? "Submitting..." : fixture.result ? "Update result" : "Submit result"}</button> : null}{fixture.permissions.can_confirm_result ? <button className="sport-primary-button" disabled={Boolean(action)} onClick={() => void updateFixture("confirm", `/api/team-challenges/fixtures/${fixture.id}/result/confirm/`, undefined, "The match result has been confirmed.")} type="button">{action === "confirm" ? "Confirming..." : "Confirm result"}</button> : null}</div>{fixture.result && !fixture.result_confirmed_at && !fixture.permissions.can_confirm_result ? <p className="mt-3 text-sm text-slate-600">The other captain must confirm this result before ratings become available.</p> : null}</section> : null}
            <section className="sport-surface p-5 sm:p-6">
              <SectionHeading title={isReadOnly ? "Match record" : "Before you play"} description="Keep the agreed schedule and team information close at hand." />
              <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                {booking ? "Please arrive ready for the confirmed time and coordinate lineup changes with your team captain." : "Keep checking with your captain while the court is being arranged. The match is not fully scheduled until a confirmed booking is attached."} Only selected participants can access this room.
              </div>
            </section>
          </div>

          <aside className="sport-surface h-fit p-5 sm:p-6">
            <SectionHeading title="Participants" description={`${fixture.participants.length} selected player${fixture.participants.length === 1 ? "" : "s"}`} />
            <div className="mt-4 space-y-2">
              {fixture.participants.length ? fixture.participants.map((participant) => (
                <div className="rounded-xl bg-slate-50 p-3" key={participant.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="truncate font-black text-sportNavy">{participant.player_name}</p><p className="mt-1 text-xs font-semibold text-slate-500">{participant.team_name}{participant.sportspot_id ? ` · ${participant.sportspot_id}` : ""}</p></div>
                    <span className="shrink-0 text-xs font-bold text-slate-600">{participant.status_label}</span>
                  </div>
                  {fixture.permissions.can_manage_lineup && fixture.permissions.team_id === participant.team && participant.status === "SELECTED" ? <button className="mt-3 min-h-9 text-xs font-bold text-red-700 underline-offset-2 hover:underline" disabled={Boolean(action)} onClick={() => { if (window.confirm(`Remove ${participant.player_name} from this lineup?`)) void updateFixture("remove", `/api/team-challenges/fixtures/${fixture.id}/participants/${participant.id}/remove/`, undefined, "The player has been removed from the lineup."); }} type="button">Remove from lineup</button> : null}
                </div>
              )) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">The lineup has not been added yet.</p>}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-lg font-black text-sportNavy">{title}</h2><p className="mt-1 text-sm text-slate-600">{description}</p></div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-1 font-bold text-sportNavy">{value}</p></div>;
}

function AttendanceRow({ action, onAttendance, participant }: { action: "add" | "remove" | "attendance" | "result" | "confirm" | null; onAttendance: (status: "ATTENDED" | "ABSENT") => void; participant: TeamFixtureParticipant }) {
  if (participant.status !== "SELECTED") {
    return <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3"><span className="font-bold text-sportNavy">{participant.player_name}</span><span className="text-xs font-bold text-slate-600">{participant.status_label}</span></div>;
  }
  return <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"><span className="font-bold text-sportNavy">{participant.player_name}</span><div className="flex gap-2"><button className="sport-secondary-button min-h-9 px-3 text-xs" disabled={Boolean(action)} onClick={() => onAttendance("ATTENDED")} type="button">Attended</button><button className="sport-secondary-button min-h-9 border-red-200 px-3 text-xs text-red-700 hover:bg-red-50" disabled={Boolean(action)} onClick={() => onAttendance("ABSENT")} type="button">Absent</button></div></div>;
}

function formatDate(value: string | null) {
  if (!value) return "Date to be confirmed";
  return formatDateTimeInNepal(value, { dateStyle: "medium", timeStyle: "short" });
}

function formatTime(value: string | null) {
  if (!value) return "Time to be confirmed";
  return formatDateTimeInNepal(value, { timeStyle: "short" });
}

function formatStatus(value: string | undefined) {
  if (!value) return "Not available";
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function roomStateLabel(state: TeamFixture["room_state"]) {
  if (state === "PLANNING") return "Planning room";
  if (state === "RECONFIRMATION") return "Schedule change";
  if (state === "CONFIRMED") return "Confirmed game room";
  if (state === "IN_PROGRESS") return "Match in progress";
  return "Match history";
}

function roomDescription(state: TeamFixture["room_state"], hasBooking: boolean) {
  if (state === "PLANNING") return "Coordinate the agreed match plan while the court is being arranged.";
  if (state === "RECONFIRMATION") return "Review the updated match plan with the participating captains and players.";
  if (state === "READ_ONLY") return "Review the schedule, roster and result from this team match.";
  return hasBooking ? "Coordinate the confirmed match with the participating captains and players." : "Coordinate the match while the final court is being arranged.";
}

function proposalSchedule(challenge: TeamChallenge) {
  const proposal = challenge.current_proposal;
  if (!proposal.proposed_date) return "Time to be confirmed";
  const start = proposal.proposed_start_time
    ? formatDateTimeInNepal(`${proposal.proposed_date}T${proposal.proposed_start_time}+05:45`, { dateStyle: "medium", timeStyle: "short" })
    : "Date selected · time to be confirmed";
  const end = proposal.proposed_end_time
    ? formatDateTimeInNepal(`${proposal.proposed_date}T${proposal.proposed_end_time}+05:45`, { timeStyle: "short" })
    : "";
  return `${start}${end ? ` - ${end}` : ""}`;
}

function RoomNotice({ tone, title, text }: { tone: "blue" | "amber" | "slate"; title: string; text: string }) {
  const styles = {
    blue: "border-blue-200 bg-blue-50 text-blue-950",
    amber: "border-amber-200 bg-amber-50 text-amber-950",
    slate: "border-slate-200 bg-slate-100 text-slate-800",
  };
  return <section className={`rounded-xl border px-4 py-3 ${styles[tone]}`}><p className="text-sm font-black">{title}</p><p className="mt-1 text-sm leading-6">{text}</p></section>;
}

function RoomSkeleton() {
  return <main className="min-h-screen bg-[var(--sport-canvas)] px-4 py-10 sm:px-6"><div className="mx-auto max-w-5xl animate-pulse space-y-5"><div className="h-5 w-36 rounded bg-white" /><div className="h-36 rounded-2xl bg-white" /><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><div className="h-96 rounded-2xl bg-white" /><div className="h-96 rounded-2xl bg-white" /></div></div></main>;
}
