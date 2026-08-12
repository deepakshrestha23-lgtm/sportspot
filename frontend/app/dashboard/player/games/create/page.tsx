"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { DashboardPageHeader } from "@/components/player-dashboard/DashboardPageHeader";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { emitToast } from "@/lib/toast";
import type { EligibleBookingsResponse, EligibleGameBooking, GameCreatePayload, GameIntensity, GameResponse, GameRole, GameType } from "@/types/matchmaking";
import type { MyTeamsResponse, Team, TeamResponse } from "@/types/team";

const roleOptions: Array<{ label: string; value: GameRole; helper: string }> = [
  { label: "Batsman", value: "BATSMAN", helper: "Run scorers and batting control" },
  { label: "Bowler", value: "BOWLER", helper: "Pace, spin and wickets" },
  { label: "All-rounder", value: "ALL_ROUNDER", helper: "Flexible batting and bowling" },
  { label: "Wicketkeeper", value: "WICKETKEEPER", helper: "Keeper and field organiser" },
  { label: "Any Role", value: "ANY", helper: "Flexible player spots" },
];

type CreationMode = "BOOKING_FIRST" | "PLAN_FIRST";
type DiscoveryReference = {
  areas_by_district: Record<string, Array<{ value: string; label: string }>>;
};

type RoleCounts = Record<GameRole, number>;

const initialRoles: RoleCounts = { BATSMAN: 2, BOWLER: 2, ALL_ROUNDER: 1, WICKETKEEPER: 1, ANY: 3 };

export default function CreateGamePage() {
  return (
    <Suspense fallback={<div className="h-[520px] animate-pulse rounded-2xl bg-white" />}>
      <CreateGameContent />
    </Suspense>
  );
}

function CreateGameContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [bookings, setBookings] = useState<EligibleGameBooking[]>([]);
  const [areasByDistrict, setAreasByDistrict] = useState<DiscoveryReference["areas_by_district"]>({});
  const [gameType, setGameType] = useState<GameType>((searchParams.get("type") as GameType) || "PICKUP");
  const [captainTeams, setCaptainTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(Number(searchParams.get("team")) || null);
  const [teamDetail, setTeamDetail] = useState<Team | null>(null);
  const [selectedTeamMemberIds, setSelectedTeamMemberIds] = useState<number[]>([]);
  const [mode, setMode] = useState<CreationMode>((searchParams.get("mode") as CreationMode) || "BOOKING_FIRST");
  const [bookingId, setBookingId] = useState<number | null>(Number(searchParams.get("booking")) || null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [hostNotes, setHostNotes] = useState("");
  const [reportingInstructions, setReportingInstructions] = useState("");
  const [equipmentInstructions, setEquipmentInstructions] = useState("");
  const [intensity, setIntensity] = useState<GameIntensity>("CASUAL");
  const [capacity, setCapacity] = useState(12);
  const [minimumPlayers, setMinimumPlayers] = useState(6);
  const [skill, setSkill] = useState<GameCreatePayload["min_skill_level"]>("OPEN");
  const [roleCounts, setRoleCounts] = useState<RoleCounts>(initialRoles);
  const [waitlistEnabled, setWaitlistEnabled] = useState(true);
  const [recruitmentDeadline, setRecruitmentDeadline] = useState("");
  const [proposedDate, setProposedDate] = useState("");
  const [proposedStart, setProposedStart] = useState("");
  const [proposedEnd, setProposedEnd] = useState("");
  const [preferredArea, setPreferredArea] = useState("");
  const [preferredVenue, setPreferredVenue] = useState("");
  const [alternativeDetails, setAlternativeDetails] = useState("");
  const [bookingDeadline, setBookingDeadline] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadContext();
  }, []);

  useEffect(() => {
    if (selectedTeamId) loadTeam(selectedTeamId);
    else setTeamDetail(null);
  }, [selectedTeamId]);

  const selectedBooking = bookings.find((booking) => booking.id === bookingId);
  const activeTeamMembers = useMemo(() => (teamDetail?.members || []).filter((member) => member.member_type === "REGISTERED" && member.status === "ACTIVE" && member.role_in_team !== "CAPTAIN"), [teamDetail]);
  const selectedTeamMembers = useMemo(() => activeTeamMembers.filter((member) => selectedTeamMemberIds.includes(member.id)), [activeTeamMembers, selectedTeamMemberIds]);
  const baselineSpots = gameType === "FILL_SQUAD" ? 1 + selectedTeamMembers.length : 1;
  const recruitedSpots = Object.values(roleCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const startDateTime = useMemo(() => {
    if (mode === "BOOKING_FIRST") return selectedBooking?.start_at || null;
    if (!proposedDate || !proposedStart) return null;
    return new Date(`${proposedDate}T${proposedStart}`).toISOString();
  }, [mode, proposedDate, proposedStart, selectedBooking]);
  const needsRoleWarning = recruitedSpots > Math.max(capacity - baselineSpots, 0);

  useEffect(() => {
    if (!title && selectedBooking && mode === "BOOKING_FIRST" && gameType === "PICKUP") {
      setTitle(`${selectedBooking.venue_name} Pickup Game`);
    }
    if (!title && teamDetail && gameType === "FILL_SQUAD") {
      setTitle(`${teamDetail.name} needs players`);
    }
  }, [gameType, mode, selectedBooking, teamDetail, title]);

  async function loadContext() {
    setIsLoading(true);
    setError("");
    try {
      const [bookingResponse, teamsResponse, referenceResponse] = await Promise.all([
        api.get<EligibleBookingsResponse>("/api/matchmaking/games/eligible-bookings/"),
        api.get<MyTeamsResponse>("/api/teams/my-teams/"),
        api.get<DiscoveryReference>("/api/venues/discovery/reference/"),
      ]);
      setBookings(bookingResponse.data.bookings);
      setAreasByDistrict(referenceResponse.data.areas_by_district || {});
      if (!bookingId && bookingResponse.data.bookings[0]) setBookingId(bookingResponse.data.bookings[0].id);
      const captainedTeams = teamsResponse.data.teams.filter((team) => team.is_captain);
      setCaptainTeams(captainedTeams);
      if (!selectedTeamId && captainedTeams[0]) setSelectedTeamId(captainedTeams[0].id);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load game setup right now."));
    } finally {
      setIsLoading(false);
    }
  }

  async function loadTeam(teamId: number) {
    try {
      const response = await api.get<TeamResponse>(`/api/teams/${teamId}/`);
      setTeamDetail(response.data.team);
      setSelectedTeamMemberIds([]);
    } catch (requestError) {
      setTeamDetail(null);
      emitToast({ message: getApiErrorMessage(requestError, "We could not load this team roster."), type: "error", dedupeKey: `fill-team-${teamId}` });
    }
  }

  function setRole(role: GameRole, next: number) {
    setRoleCounts((current) => ({ ...current, [role]: Math.max(0, Math.min(29, next)) }));
  }


  function toggleTeamMember(memberId: number) {
    setSelectedTeamMemberIds((current) => current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId]);
  }

  function defaultDeadline(hoursBefore: number) {
    if (!startDateTime) return null;
    const date = new Date(startDateTime);
    date.setHours(date.getHours() - hoursBefore);
    return date.toISOString();
  }

  function toApiDateTime(value: string) {
    return value ? new Date(value).toISOString() : null;
  }

  async function publishGame() {
    if (gameType === "FILL_SQUAD" && !selectedTeamId) {
      emitToast({ message: "Choose the team that needs temporary players.", type: "warning", dedupeKey: "fill-squad-team" });
      return;
    }
    if (mode === "BOOKING_FIRST" && !bookingId) {
      emitToast({ message: "Choose a confirmed booking first.", type: "warning", dedupeKey: "create-game-booking" });
      return;
    }
    if (mode === "PLAN_FIRST" && (!proposedDate || !proposedStart || !proposedEnd || !preferredArea)) {
      emitToast({ message: "Add the proposed date, time and preferred area.", type: "warning", dedupeKey: "create-game-proposal" });
      return;
    }
    if (!title.trim()) {
      emitToast({ message: "Add a clear game title.", type: "warning", dedupeKey: "create-game-title" });
      return;
    }
    if (title.trim().length > 120) {
      emitToast({ message: "Keep the game title under 120 characters.", type: "warning", dedupeKey: "create-game-title-length" });
      return;
    }
    if (minimumPlayers < 1 || minimumPlayers > capacity) {
      emitToast({ message: "The minimum player threshold must be between 1 and total capacity.", type: "warning", dedupeKey: "create-game-minimum" });
      return;
    }
    if (mode === "PLAN_FIRST") {
      const proposalStart = proposedDate && proposedStart ? new Date(proposedDate + "T" + proposedStart) : null;
      const proposalEnd = proposedDate && proposedEnd ? new Date(proposedDate + "T" + proposedEnd) : null;
      if (!proposalStart || !proposalEnd || Number.isNaN(proposalStart.getTime()) || Number.isNaN(proposalEnd.getTime()) || proposalEnd <= proposalStart) {
        emitToast({ message: "Choose an end time after the proposed start time.", type: "warning", dedupeKey: "create-game-time-order" });
        return;
      }
      if (proposalStart <= new Date()) {
        emitToast({ message: "Choose a future date and time for the game.", type: "warning", dedupeKey: "create-game-start-future" });
        return;
      }
      const bookingCutoff = bookingDeadline ? new Date(bookingDeadline) : null;
      if (bookingCutoff && (Number.isNaN(bookingCutoff.getTime()) || bookingCutoff >= proposalStart)) {
        emitToast({ message: "The court-booking deadline must be before the proposed game starts.", type: "warning", dedupeKey: "create-game-booking-deadline" });
        return;
      }
      const recruitmentCutoff = recruitmentDeadline ? new Date(recruitmentDeadline) : null;
      if (recruitmentCutoff && (Number.isNaN(recruitmentCutoff.getTime()) || recruitmentCutoff >= proposalStart)) {
        emitToast({ message: "The recruitment deadline must be before the proposed game starts.", type: "warning", dedupeKey: "create-game-recruitment-deadline" });
        return;
      }
    }
    if (needsRoleWarning) {
      emitToast({ message: "Temporary role needs cannot exceed the spots left after the selected squad is counted.", type: "warning", dedupeKey: "create-game-role-count" });
      return;
    }
    setIsSubmitting(true);
    try {
      const payload: GameCreatePayload = {
        game_type: gameType,
        team_id: gameType === "FILL_SQUAD" ? selectedTeamId : null,
        selected_team_member_ids: gameType === "FILL_SQUAD" ? selectedTeamMemberIds : [],
        creation_mode: mode,
        booking_id: mode === "BOOKING_FIRST" ? bookingId : null,
        title: title.trim(),
        description: description.trim(),
        host_notes: hostNotes.trim(),
        reporting_instructions: reportingInstructions.trim(),
        equipment_instructions: equipmentInstructions.trim(),
        game_intensity: intensity,
        min_skill_level: skill,
        total_capacity: capacity,
        minimum_players_to_proceed: minimumPlayers,
        waitlist_enabled: waitlistEnabled,
        recruitment_deadline: toApiDateTime(recruitmentDeadline) || defaultDeadline(2),
        proposed_date: mode === "PLAN_FIRST" ? proposedDate : null,
        proposed_start_time: mode === "PLAN_FIRST" ? proposedStart : null,
        proposed_end_time: mode === "PLAN_FIRST" ? proposedEnd : null,
        preferred_area: mode === "PLAN_FIRST" ? preferredArea : "",
        preferred_venue_name: mode === "PLAN_FIRST" ? preferredVenue.trim() : "",
        alternative_details: mode === "PLAN_FIRST" ? alternativeDetails.trim() : "",
        booking_deadline: mode === "PLAN_FIRST" ? toApiDateTime(bookingDeadline) || defaultDeadline(12) : null,
        role_requirements: roleOptions.map((role) => ({ role: role.value, required_count: roleCounts[role.value] })).filter((item) => item.required_count > 0),
        guests: [],
      };
      const response = await api.post<GameResponse>("/api/matchmaking/games/", payload);
      emitToast({ message: gameType === "FILL_SQUAD" ? "Your Fill My Squad listing is now open for players." : "Your pickup game is now open for players.", type: "success", dedupeKey: `game-published-${gameType}` });
      router.push(`/dashboard/player/games/${response.data.game.id}`);
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not publish this game. Please check the details and try again."), type: "error", dedupeKey: "game-publish-error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return <div className="space-y-5"><div className="h-24 animate-pulse rounded-2xl bg-white" /><div className="h-[560px] animate-pulse rounded-2xl bg-white" /></div>;
  }

  return (
    <div className="space-y-5">
      <DashboardPageHeader
        eyebrow="Find Games"
        title={gameType === "FILL_SQUAD" ? "Create Fill My Squad" : "Create a Pickup Game"}
        description={gameType === "FILL_SQUAD" ? "Recruit temporary players for one specific team game without adding them as permanent members." : "Recruit individual Cricksal players for a confirmed booking or plan a game first and book the court after enough players join."}
      />

      {error ? (
        <section className="rounded-2xl border border-red-100 bg-red-50 p-6">
          <h2 className="text-xl font-black text-red-950">We could not load game setup.</h2>
          <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>
          <button className="mt-5 rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white" onClick={loadContext} type="button">Retry</button>
        </section>
      ) : (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">1. Choose game format</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <ModeCard active={gameType === "PICKUP"} title="Pickup Game" description="Host as an individual and recruit individual players." onClick={() => setGameType("PICKUP")} />
                <ModeCard active={gameType === "FILL_SQUAD"} disabled={captainTeams.length === 0} title="Fill My Squad" description="Recruit temporary players for a permanent team you captain." onClick={() => setGameType("FILL_SQUAD")} />
              </div>
              {captainTeams.length === 0 ? <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">Create or captain a team before opening a Fill My Squad listing.</p> : null}
            </section>

            {gameType === "FILL_SQUAD" ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">2. Select permanent squad</p>
                <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                  <Field label="Team"><select className={inputClass} value={selectedTeamId || ""} onChange={(event) => setSelectedTeamId(Number(event.target.value))}>{captainTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></Field>
                  <div className="rounded-xl bg-green-50 p-3"><p className="text-xs font-black uppercase tracking-wide text-sportGreen">Captain included</p><p className="mt-1 text-sm font-black text-sportNavy">{teamDetail?.captain_name || "You"}</p></div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {activeTeamMembers.length ? activeTeamMembers.map((member) => <button className={`rounded-xl border p-4 text-left transition ${selectedTeamMemberIds.includes(member.id) ? "border-sportGreen bg-green-50" : "border-slate-200 hover:border-green-200"}`} key={member.id} onClick={() => toggleTeamMember(member.id)} type="button"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-sportNavy">{member.full_name || member.display_name}</p><p className="mt-1 text-sm font-semibold text-slate-500">{formatRole(member.cricksal_role)} - {member.skill_level || "Skill not set"}</p></div><span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-sportGreen">{selectedTeamMemberIds.includes(member.id) ? "Selected" : "Add"}</span></div></button>) : <p className="rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-600 md:col-span-2">No other active registered team members are available. You can still recruit temporary players and add named guests after publishing.</p>}
                </div>
                <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">Current squad: {baselineSpots} permanent spot{baselineSpots === 1 ? "" : "s"}. Temporary role needs are configured below.</p>
              </section>
            ) : null}

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{gameType === "FILL_SQUAD" ? "3" : "2"}. Choose booking status</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <ModeCard active={mode === "BOOKING_FIRST"} title="Court Already Booked" description="Open one of your paid confirmed court bookings for players." onClick={() => setMode("BOOKING_FIRST")} />
                <ModeCard active={mode === "PLAN_FIRST"} title={gameType === "FILL_SQUAD" ? "Complete Squad First" : "Plan First, Book Later"} description="Publish a proposed plan and verify the court after enough players join." onClick={() => setMode("PLAN_FIRST")} />
              </div>
            </section>

            {mode === "BOOKING_FIRST" ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">2. Select booking</p>
                    <h2 className="mt-1 text-xl font-black text-sportNavy">Eligible confirmed bookings</h2>
                  </div>
                  <Link className="text-sm font-black text-sportGreen" href="/courts">Book another court</Link>
                </div>
                {bookings.length === 0 ? (
                  <div className="mt-4 rounded-2xl border border-dashed border-green-300 bg-green-50 p-6 text-center">
                    <p className="font-black text-sportNavy">No eligible confirmed booking found.</p>
                    <p className="mt-1 text-sm font-semibold text-slate-600">You can still use Plan First, or book and pay for a future court first.</p>
                  </div>
                ) : (
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    {bookings.map((booking) => <BookingCard active={booking.id === bookingId} booking={booking} key={booking.id} onClick={() => setBookingId(booking.id)} />)}
                  </div>
                )}
                <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{gameType === "FILL_SQUAD" ? "The court is already confirmed. The booking owner remains responsible if the squad does not fill." : "This game is linked to a confirmed booking. You remain responsible for the booking even if the game does not fill."}</p>
              </section>
            ) : (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">2. Enter proposed plan</p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Field label="Proposed date"><input className={inputClass} min={today()} type="date" value={proposedDate} onChange={(event) => setProposedDate(event.target.value)} /></Field>
                  <div className="grid grid-cols-2 gap-3"><Field label="Start time"><input className={inputClass} type="time" value={proposedStart} onChange={(event) => setProposedStart(event.target.value)} /></Field><Field label="End time"><input className={inputClass} type="time" value={proposedEnd} onChange={(event) => setProposedEnd(event.target.value)} /></Field></div>
                  <Field label="Preferred area"><select className={inputClass} value={preferredArea} onChange={(event) => setPreferredArea(event.target.value)}><option value="">Choose area</option>{Object.entries(areasByDistrict).map(([district, options]) => <optgroup key={district} label={district}>{options.map((area) => <option key={area.value} value={area.value}>{area.label}</option>)}</optgroup>)}</select></Field>
                  <Field label="Preferred venue optional"><input className={inputClass} placeholder="Venue name if you have one in mind" value={preferredVenue} onChange={(event) => setPreferredVenue(event.target.value)} /></Field>
                  <Field label="Alternative area or time" wide><input className={inputClass} placeholder="Example: Jawalakhel also works, evening preferred" value={alternativeDetails} onChange={(event) => setAlternativeDetails(event.target.value)} /></Field>
                </div>
                <p className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">Players will see this as Planning - Court Not Booked Yet until a real confirmed SportSpot booking is attached.</p>
              </section>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">3. Configure players and roles</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <Field label="Total capacity"><input className={inputClass} min={2} max={30} type="number" value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} /></Field>
                <Field label="Minimum to proceed"><input className={inputClass} min={2} max={capacity} type="number" value={minimumPlayers} onChange={(event) => setMinimumPlayers(Number(event.target.value))} /></Field>
                <Field label="Skill range"><select className={inputClass} value={skill} onChange={(event) => setSkill(event.target.value as GameCreatePayload["min_skill_level"])}><option value="OPEN">Open to all</option><option value="BEGINNER">Beginner+</option><option value="INTERMEDIATE">Intermediate+</option><option value="ADVANCED">Advanced only</option></select></Field>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {roleOptions.map((role) => (
                  <div className="rounded-2xl border border-slate-200 p-4" key={role.value}>
                    <div className="flex items-center justify-between gap-3">
                      <div><p className="font-black text-sportNavy">{role.label}</p><p className="mt-1 text-xs font-semibold text-slate-500">{role.helper}</p></div>
                      <div className="flex items-center gap-2"><button className="h-9 w-9 rounded-full border border-slate-200 font-black" onClick={() => setRole(role.value, roleCounts[role.value] - 1)} type="button">-</button><span className="w-8 text-center font-black text-sportNavy">{roleCounts[role.value]}</span><button className="h-9 w-9 rounded-full border border-slate-200 font-black" onClick={() => setRole(role.value, roleCounts[role.value] + 1)} type="button">+</button></div>
                    </div>
                  </div>
                ))}
              </div>
              {needsRoleWarning ? <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">You are recruiting {recruitedSpots} temporary players, but only {Math.max(capacity - baselineSpots, 0)} spots are available after the selected squad.</p> : null}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">4. Game details and deadlines</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field label="Game title" wide><input className={inputClass} placeholder="Example: Saturday evening pickup" value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
                <Field label="Game type"><select className={inputClass} value={intensity} onChange={(event) => setIntensity(event.target.value as GameIntensity)}><option value="CASUAL">Casual</option><option value="COMPETITIVE">Competitive</option><option value="PRACTICE">Practice / Friendly</option></select></Field>
                <Field label="Recruitment deadline"><input className={inputClass} type="datetime-local" value={recruitmentDeadline} onChange={(event) => setRecruitmentDeadline(event.target.value)} /></Field>
                {mode === "PLAN_FIRST" ? <Field label="Court booking deadline"><input className={inputClass} type="datetime-local" value={bookingDeadline} onChange={(event) => setBookingDeadline(event.target.value)} /></Field> : null}
                <Field label="Description" wide><textarea className={`${inputClass} min-h-24 py-3`} placeholder="Tell players the game mood, expectations and format." value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
                <Field label="Reporting instructions" wide><input className={inputClass} placeholder="Example: arrive 15 minutes early near reception" value={reportingInstructions} onChange={(event) => setReportingInstructions(event.target.value)} /></Field>
                <Field label="Equipment or dress instructions" wide><input className={inputClass} placeholder="Example: bring gloves; turf shoes required" value={equipmentInstructions} onChange={(event) => setEquipmentInstructions(event.target.value)} /></Field>
                <Field label="Host note for accepted players" wide><textarea className={`${inputClass} min-h-20 py-3`} placeholder="Private coordination note for the planning room or game room." value={hostNotes} onChange={(event) => setHostNotes(event.target.value)} /></Field>
              </div>
              <label className="mt-4 flex items-start gap-3 text-sm font-semibold text-slate-600"><input checked={waitlistEnabled} className="mt-1" onChange={(event) => setWaitlistEnabled(event.target.checked)} type="checkbox" /> Allow waitlist when the game becomes full.</label>
            </section>
          </div>

          <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-24">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Review</p>
            <h2 className="mt-2 text-xl font-black text-sportNavy">{gameType === "FILL_SQUAD" ? "Squad Summary" : "Pickup Game Summary"}</h2>
            <div className="mt-4 space-y-3 text-sm font-semibold text-slate-600">
              <SummaryRow label="Status" value={mode === "BOOKING_FIRST" ? "Verified SportSpot Booking" : "Planning - Court Not Booked Yet"} />
              <SummaryRow label="Place" value={mode === "BOOKING_FIRST" ? selectedBooking ? `${selectedBooking.venue_name}, ${selectedBooking.venue_area || selectedBooking.venue_city}` : "Choose booking" : preferredVenue || preferredArea || "Choose preferred area"} />
              <SummaryRow label="Time" value={mode === "BOOKING_FIRST" ? selectedBooking?.booking_display_time || "Choose booking" : proposedDate && proposedStart ? `${proposedDate}, ${proposedStart} - ${proposedEnd || "end time"}` : "Choose proposed time"} />
              <SummaryRow label="Roster" value={`${baselineSpots} selected + ${recruitedSpots} temporary role needs`} />
              <SummaryRow label="Minimum" value={`${minimumPlayers} players before proceeding`} />
            </div>
            <button className="mt-5 min-h-12 w-full rounded-xl bg-sportGreen text-sm font-black text-white shadow-sm hover:bg-green-700 disabled:opacity-60" disabled={isSubmitting || needsRoleWarning} onClick={publishGame} type="button">{isSubmitting ? "Publishing..." : gameType === "FILL_SQUAD" ? "Publish Fill My Squad" : "Publish Pickup Game"}</button>
            <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">{gameType === "FILL_SQUAD" ? "Accepted temporary players join this game only. Permanent team invitations stay separate." : "Accepted players get access to a planning room first. A full Game Room appears after the court booking is verified."}</p>
          </aside>
        </section>
      )}
    </div>
  );
}

function ModeCard({ active, description, disabled = false, onClick, title }: { active: boolean; description: string; disabled?: boolean; onClick: () => void; title: string }) {
  return <button className={`rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-green-200 disabled:cursor-not-allowed disabled:opacity-60 ${active ? "border-sportGreen bg-green-50 text-sportGreen" : "border-slate-200 bg-white text-sportNavy hover:border-green-200"}`} disabled={disabled} onClick={onClick} type="button"><span className="text-base font-black">{title}</span><span className="mt-1 block text-sm font-semibold text-slate-500">{description}</span></button>;
}

function BookingCard({ active, booking, onClick }: { active: boolean; booking: EligibleGameBooking; onClick: () => void }) {
  return <button className={`rounded-2xl border p-4 text-left transition ${active ? "border-sportGreen bg-green-50" : "border-slate-200 hover:border-green-200"}`} onClick={onClick} type="button"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-sportNavy">{booking.venue_name}</p><p className="mt-1 text-sm font-semibold text-slate-600">{booking.court_name} - {booking.venue_area || booking.venue_city}</p></div><span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-sportGreen">Paid</span></div><p className="mt-3 text-sm font-semibold text-slate-600">{booking.booking_display_time}</p><p className="mt-1 text-xs font-black text-slate-500">{booking.booking_code} - NPR {Number(booking.amount).toLocaleString()}</p></button>;
}

function Field({ children, label, wide = false }: { children: React.ReactNode; label: string; wide?: boolean }) {
  return <label className={`block ${wide ? "md:col-span-2" : ""}`}><span className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</span><div className="mt-1">{children}</div></label>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-black text-sportNavy">{value}</p></div>;
}

function formatRole(value: string) { return value === "ALL_ROUNDER" ? "All-rounder" : value === "WICKETKEEPER" ? "Wicketkeeper" : value === "BATSMAN" ? "Batsman" : value === "BOWLER" ? "Bowler" : "Any role"; }

const inputClass = "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-sportNavy outline-none transition focus:border-sportGreen focus:ring-2 focus:ring-green-100";

function today() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}
