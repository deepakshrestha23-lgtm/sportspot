"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { DashboardPageHeader } from "@/components/player-dashboard/DashboardPageHeader";
import ServiceAreaPicker, { type ServiceAreaSelection } from "@/components/location/ServiceAreaPicker";
import TimeSelect from "@/components/TimeSelect";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { addCalendarDays, buildTimeOptions, formatDateTimeInNepal, formatTimeValue, getLocalDateString, localDateTimeToIso, splitDateTimeInput, toDateTimeInput } from "@/lib/dates";
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
type ReferenceOption = { value: string; label: string; count?: number };
type DiscoveryReference = {
  districts: ReferenceOption[];
  areas_by_district: Record<string, ReferenceOption[]>;
  start_times: string[];
  matchmaking_deadline_config: DeadlineConfig;
};
type DiscoveryReferenceResponse = { filters?: DiscoveryReference } & Partial<DiscoveryReference>;
type DeadlineConfig = {
  minimum_booking_lead_minutes: number;
  minimum_recruitment_to_booking_minutes: number;
  minimum_plan_lead_minutes: number;
  recommended_recruitment_lead_minutes: number;
  recommended_booked_game_recruitment_lead_minutes: number;
  recommended_booking_lead_minutes: number;
};

type RoleCounts = Record<GameRole, number>;

const initialRoles: RoleCounts = { BATSMAN: 2, BOWLER: 2, ALL_ROUNDER: 1, WICKETKEEPER: 1, ANY: 3 };
const DURATION_OPTIONS = [60, 90, 120, 150, 180];
const formatTimeLabel = formatTimeValue;
const FALLBACK_DEADLINE_CONFIG: DeadlineConfig = {
  minimum_booking_lead_minutes: 60,
  minimum_recruitment_to_booking_minutes: 30,
  minimum_plan_lead_minutes: 120,
  recommended_recruitment_lead_minutes: 24 * 60,
  recommended_booked_game_recruitment_lead_minutes: 2 * 60,
  recommended_booking_lead_minutes: 12 * 60,
};

const CREATION_STEPS = [
  { number: 1, label: "Format", description: "Choose how to organise the game" },
  { number: 2, label: "Court plan", description: "Use a booking or plan the court" },
  { number: 3, label: "Players", description: "Set capacity and role needs" },
  { number: 4, label: "Details", description: "Add the game information" },
  { number: 5, label: "Review", description: "Check everything before publishing" },
] as const;

export default function CreateGamePage() {
  return (
    <Suspense fallback={<div className="sport-surface h-[520px] animate-pulse" />}>
      <CreateGameContent />
    </Suspense>
  );
}

function CreateGameContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [bookings, setBookings] = useState<EligibleGameBooking[]>([]);
  const [planningStartTimes, setPlanningStartTimes] = useState<string[]>([]);
  const [deadlineConfig, setDeadlineConfig] = useState<DeadlineConfig>(FALLBACK_DEADLINE_CONFIG);
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
  const [proposedDate, setProposedDate] = useState("");
  const [proposedStart, setProposedStart] = useState("");
  const [proposedDuration, setProposedDuration] = useState(120);
  const [preferredDistrict, setPreferredDistrict] = useState("");
  const [preferredArea, setPreferredArea] = useState("");
  const [preferredAreaCode, setPreferredAreaCode] = useState("");
  const [preferredVenue, setPreferredVenue] = useState("");
  const [alternativeDetails, setAlternativeDetails] = useState("");
  const [recruitmentDeadlineDate, setRecruitmentDeadlineDate] = useState("");
  const [recruitmentDeadlineTime, setRecruitmentDeadlineTime] = useState("");
  const [bookingDeadlineDate, setBookingDeadlineDate] = useState("");
  const [bookingDeadlineTime, setBookingDeadlineTime] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [activeStep, setActiveStep] = useState(1);
  const [stepMessage, setStepMessage] = useState("");
  const [createRequestId] = useState(() => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `game-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  });

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
  const proposedEnd = useMemo(() => addMinutesToTime(proposedStart, proposedDuration), [proposedDuration, proposedStart]);
  const startDateTime = useMemo(() => {
    if (mode === "BOOKING_FIRST") return selectedBooking?.start_at || null;
    if (!proposedDate || !proposedStart) return null;
    return appDateTimeToIso(proposedDate, proposedStart);
  }, [mode, proposedDate, proposedStart, selectedBooking]);
  const recruitmentDeadlineAt = useMemo(
    () => localDateTimeToIso(recruitmentDeadlineDate, recruitmentDeadlineTime),
    [recruitmentDeadlineDate, recruitmentDeadlineTime],
  );
  const bookingDeadlineAt = useMemo(
    () => (mode === "PLAN_FIRST" ? localDateTimeToIso(bookingDeadlineDate, bookingDeadlineTime) : ""),
    [bookingDeadlineDate, bookingDeadlineTime, mode],
  );
  const selectedServiceArea: ServiceAreaSelection | null = preferredAreaCode && preferredArea && preferredDistrict
    ? { code: preferredAreaCode, area: preferredArea, district: preferredDistrict }
    : null;
  const deadlineBufferInvalid = Boolean(
    mode === "PLAN_FIRST" &&
      recruitmentDeadlineAt &&
      bookingDeadlineAt &&
      new Date(bookingDeadlineAt).getTime() - new Date(recruitmentDeadlineAt).getTime() < deadlineConfig.minimum_recruitment_to_booking_minutes * 60 * 1000,
  );
  const bookingLeadInvalid = Boolean(
    mode === "PLAN_FIRST" &&
      startDateTime &&
      bookingDeadlineAt &&
      new Date(startDateTime).getTime() - new Date(bookingDeadlineAt).getTime() < deadlineConfig.minimum_booking_lead_minutes * 60 * 1000,
  );
  const selectedStartIsTooSoon = [recruitmentDeadlineAt, mode === "PLAN_FIRST" ? bookingDeadlineAt : ""].some(
    (value) => value && new Date(value).getTime() <= Date.now(),
  );
  const planStartIsTooSoon = Boolean(
    mode === "PLAN_FIRST" &&
      startDateTime &&
      new Date(startDateTime).getTime() <= Date.now() + deadlineConfig.minimum_plan_lead_minutes * 60 * 1000,
  );
  const recruitmentAfterStartInvalid = Boolean(
    startDateTime &&
      recruitmentDeadlineAt &&
      new Date(recruitmentDeadlineAt).getTime() >= new Date(startDateTime).getTime(),
  );
  const needsRoleWarning = recruitedSpots > Math.max(capacity - baselineSpots, 0);

  useEffect(() => {
    if (!startDateTime) {
      setRecruitmentDeadlineDate("");
      setRecruitmentDeadlineTime("");
      setBookingDeadlineDate("");
      setBookingDeadlineTime("");
      return;
    }
    const { recruitment: recruitmentSuggestion, booking: bookingSuggestion } = recommendedDeadlineParts(startDateTime, mode, deadlineConfig);
    setRecruitmentDeadlineDate(recruitmentSuggestion.date);
    setRecruitmentDeadlineTime(recruitmentSuggestion.time);
    if (mode === "PLAN_FIRST") {
      setBookingDeadlineDate(bookingSuggestion.date);
      setBookingDeadlineTime(bookingSuggestion.time);
    } else {
      setBookingDeadlineDate("");
      setBookingDeadlineTime("");
    }
  }, [deadlineConfig, mode, startDateTime]);

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
        api.get<DiscoveryReferenceResponse>("/api/venues/discovery/reference/"),
      ]);
      setBookings(bookingResponse.data.bookings);
      const reference = referenceResponse.data.filters || referenceResponse.data;
      setPlanningStartTimes(reference.start_times || []);
      setDeadlineConfig(reference.matchmaking_deadline_config || FALLBACK_DEADLINE_CONFIG);
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

  function validationMessageForStep(step: number) {
    if (step === 1) {
      if (gameType === "FILL_SQUAD" && !captainTeams.length) return "Create or captain a team before opening a Fill My Squad listing.";
      return null;
    }

    if (step === 2) {
      if (mode === "BOOKING_FIRST" && !selectedBooking) return "Choose a confirmed booking, or switch to Plan First.";
      if (mode === "PLAN_FIRST") {
        if (!proposedDate || !proposedStart || !proposedEnd) return "Choose a proposed date, start time and duration.";
        if (!selectedServiceArea) return "Choose the map-based service area where you would like to play.";
        if (planStartIsTooSoon) return `Choose a game time at least ${formatMinutesAsDuration(deadlineConfig.minimum_plan_lead_minutes)} from now.`;
      }
      return null;
    }

    if (step === 3) {
      if (gameType === "FILL_SQUAD" && !selectedTeamId) return "Choose the team that needs temporary players.";
      if (capacity < 2 || capacity > 30) return "Choose a total capacity between 2 and 30 players.";
      if (minimumPlayers < 2 || minimumPlayers > capacity) return "The minimum player threshold must be between 2 and total capacity.";
      if (needsRoleWarning) return "Reduce the role needs or increase capacity so the squad can fit.";
      return null;
    }

    if (step === 4) {
      if (!title.trim()) return "Add a clear title so players know what they are joining.";
      if (title.trim().length > 120) return "Keep the game title under 120 characters.";
      if (mode !== "PLAN_FIRST") return null;
      if (!recruitmentDeadlineAt || !bookingDeadlineAt) return "Choose when recruitment closes and when the court must be secured.";
      if (selectedStartIsTooSoon) return "Both deadlines must be in the future. Choose a later deadline or game time.";
      if (recruitmentAfterStartInvalid) return "Recruitment must close before the proposed game starts.";
      if (bookingLeadInvalid) return `The court must be secured at least ${formatMinutesAsDuration(deadlineConfig.minimum_booking_lead_minutes)} before the game starts.`;
      if (deadlineBufferInvalid) return `Leave at least ${formatMinutesAsDuration(deadlineConfig.minimum_recruitment_to_booking_minutes)} between recruitment closing and the court-booking deadline.`;
      return null;
    }

    return null;
  }

  function continueToNextStep() {
    const message = validationMessageForStep(activeStep);
    if (message) {
      setStepMessage(message);
      emitToast({ message, type: "warning", dedupeKey: `create-game-step-${activeStep}` });
      return;
    }
    setStepMessage("");
    setActiveStep((step) => Math.min(step + 1, CREATION_STEPS.length));
  }

  function goToStep(step: number) {
    if (step < activeStep) {
      setStepMessage("");
      setActiveStep(step);
    }
  }

  function formatPlanSchedule() {
    if (!startDateTime || !proposedEnd) return "Choose a proposed date and time";
    return `${formatDateTimeInNepal(startDateTime, { dateStyle: "medium", timeStyle: "short" })} - ${formatTimeLabel(proposedEnd)}`;
  }

  function publishFromReview() {
    const firstInvalidStep = CREATION_STEPS.slice(0, -1).find((step) => validationMessageForStep(step.number));
    if (firstInvalidStep) {
      const message = validationMessageForStep(firstInvalidStep.number) || "Check the game details before publishing.";
      setActiveStep(firstInvalidStep.number);
      setStepMessage(message);
      emitToast({ message, type: "warning", dedupeKey: `create-game-step-${firstInvalidStep.number}` });
      return;
    }
    void publishGame();
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
    if (mode === "PLAN_FIRST" && (!proposedDate || !proposedStart || !proposedEnd || !selectedServiceArea)) {
      emitToast({ message: "Choose a match area, date, start time and duration for the proposed game.", type: "warning", dedupeKey: "create-game-proposal" });
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
    if (minimumPlayers < 2 || minimumPlayers > capacity) {
      emitToast({ message: "The minimum player threshold must be between 2 and total capacity.", type: "warning", dedupeKey: "create-game-minimum" });
      return;
    }
    if (mode === "PLAN_FIRST") {
      const proposalStart = startDateTime ? new Date(startDateTime) : null;
      const proposalEnd = proposedDate && proposedEnd ? new Date(appDateTimeToIso(proposedDate, proposedEnd)) : null;
      if (!proposalStart || !proposalEnd || Number.isNaN(proposalStart.getTime()) || Number.isNaN(proposalEnd.getTime()) || proposalEnd <= proposalStart) {
        emitToast({ message: "Choose an end time after the proposed start time.", type: "warning", dedupeKey: "create-game-time-order" });
        return;
      }
      if (proposalStart.getTime() <= Date.now() + deadlineConfig.minimum_plan_lead_minutes * 60 * 1000) {
        emitToast({ message: `Choose a game time at least ${formatMinutesAsDuration(deadlineConfig.minimum_plan_lead_minutes)} from now so there is time to recruit players and secure a court.`, type: "warning", dedupeKey: "create-game-start-too-soon" });
        return;
      }
      if (!recruitmentDeadlineAt || (mode === "PLAN_FIRST" && !bookingDeadlineAt)) {
        emitToast({ message: "Choose when recruitment closes and, for Plan First, when the court must be secured.", type: "warning", dedupeKey: "create-game-deadlines" });
        return;
      }
      if (proposalStart <= new Date()) {
        emitToast({ message: "Choose a future date and time for the game.", type: "warning", dedupeKey: "create-game-start-future" });
        return;
      }
      const bookingCutoff = bookingDeadlineAt ? new Date(bookingDeadlineAt) : null;
      if (bookingCutoff && (Number.isNaN(bookingCutoff.getTime()) || proposalStart.getTime() - bookingCutoff.getTime() < deadlineConfig.minimum_booking_lead_minutes * 60 * 1000)) {
        emitToast({ message: `Choose a court-booking deadline at least ${formatMinutesAsDuration(deadlineConfig.minimum_booking_lead_minutes)} before the game starts.`, type: "warning", dedupeKey: "create-game-booking-deadline" });
        return;
      }
      const recruitmentCutoff = recruitmentDeadlineAt ? new Date(recruitmentDeadlineAt) : null;
      if (recruitmentCutoff && (Number.isNaN(recruitmentCutoff.getTime()) || recruitmentCutoff >= proposalStart)) {
        emitToast({ message: "The recruitment deadline must be before the proposed game starts.", type: "warning", dedupeKey: "create-game-recruitment-deadline" });
        return;
      }
      if (bookingCutoff && bookingCutoff <= new Date()) {
        emitToast({ message: "The court-booking deadline has already passed. Choose a later game time or a shorter deadline window.", type: "warning", dedupeKey: "create-game-booking-deadline-past" });
        return;
      }
      if (recruitmentCutoff && recruitmentCutoff <= new Date()) {
        emitToast({ message: "The recruitment deadline has already passed. Choose a later game time or a shorter deadline window.", type: "warning", dedupeKey: "create-game-recruitment-deadline-past" });
        return;
      }
      if (bookingCutoff && recruitmentCutoff && bookingCutoff.getTime() - recruitmentCutoff.getTime() < deadlineConfig.minimum_recruitment_to_booking_minutes * 60 * 1000) {
        emitToast({ message: `Leave at least ${formatMinutesAsDuration(deadlineConfig.minimum_recruitment_to_booking_minutes)} between recruitment closing and the court-booking deadline.`, type: "warning", dedupeKey: "create-game-deadline-order" });
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
        client_request_id: createRequestId,
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
        recruitment_deadline: recruitmentDeadlineAt || defaultDeadline(mode === "PLAN_FIRST" ? deadlineConfig.recommended_recruitment_lead_minutes / 60 : 2),
        proposed_date: mode === "PLAN_FIRST" ? proposedDate : null,
        proposed_start_time: mode === "PLAN_FIRST" ? proposedStart : null,
        proposed_end_time: mode === "PLAN_FIRST" ? proposedEnd : null,
        preferred_district: mode === "PLAN_FIRST" ? preferredDistrict : "",
        preferred_area: mode === "PLAN_FIRST" ? preferredArea : "",
        preferred_area_code: mode === "PLAN_FIRST" ? preferredAreaCode : "",
        preferred_venue_name: mode === "PLAN_FIRST" ? preferredVenue.trim() : "",
        alternative_details: mode === "PLAN_FIRST" ? alternativeDetails.trim() : "",
        booking_deadline: mode === "PLAN_FIRST" ? bookingDeadlineAt || defaultDeadline(deadlineConfig.recommended_booking_lead_minutes / 60) : null,
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
    return <div className="space-y-5"><div className="sport-surface h-24 animate-pulse" /><div className="sport-surface h-[560px] animate-pulse" /></div>;
  }

  return (
    <div className="space-y-5">
      <DashboardPageHeader
        backHref="/dashboard/player/games"
        backLabel="Back to games"
        eyebrow="Find Games"
        title={gameType === "FILL_SQUAD" ? "Create Fill My Squad" : "Create a Pickup Game"}
        description={gameType === "FILL_SQUAD" ? "Recruit temporary players for one specific team game without adding them as permanent members." : "Recruit individual Cricksal players for a confirmed booking or plan a game first and book the court after enough players join."}
      />

      {error ? (
        <section className="sport-error-state">
          <h2 className="text-xl font-bold text-red-950">We could not load game setup.</h2>
          <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>
          <button className="sport-primary-button mt-5 bg-red-600 hover:bg-red-700" onClick={loadContext} type="button">Retry</button>
        </section>
      ) : (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="sport-card min-w-0 p-4 sm:p-6">
            <CreationProgress activeStep={activeStep} onSelect={goToStep} />

            {stepMessage ? (
              <div className="mt-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900" role="alert">
                <span className="mt-0.5 shrink-0 font-black">!</span>
                <p className="min-w-0 flex-1">{stepMessage}</p>
                <button aria-label="Dismiss message" className="shrink-0 text-lg leading-none text-amber-700" onClick={() => setStepMessage("")} type="button">&times;</button>
              </div>
            ) : null}

            {activeStep === 1 ? (
              <div className="mt-7 space-y-6">
                <StepIntro eyebrow="Step 1 of 5" title="What are you organising?" description="Choose the type of Cricksal game you want players to join." />
                <div className="grid gap-3 md:grid-cols-2">
                  <ModeCard active={gameType === "PICKUP"} title="Pickup Game" description="Host as an individual and recruit individual players." onClick={() => { setGameType("PICKUP"); setStepMessage(""); }} />
                  <ModeCard active={gameType === "FILL_SQUAD"} disabled={captainTeams.length === 0} title="Fill My Squad" description="Recruit temporary players for a permanent team you captain." onClick={() => { setGameType("FILL_SQUAD"); setStepMessage(""); }} />
                </div>
                {captainTeams.length === 0 ? <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-800">Create or captain a team before opening a Fill My Squad listing.</p> : null}
                <div className="grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-3">
                  <MiniPrinciple title="One clear plan" description="Players see the schedule and expectations before they request to join." />
                  <MiniPrinciple title="Real booking status" description="A confirmed court is shown separately from a plan that still needs booking." />
                  <MiniPrinciple title="Safe capacity" description="The server checks spots, roles and availability again when you publish." />
                </div>
              </div>
            ) : null}

            {activeStep === 2 ? (
              <div className="mt-7 space-y-6">
                <StepIntro eyebrow="Step 2 of 5" title="Set the court plan" description="Start with a confirmed booking or share a proposed plan. Players will always see which one it is." />
                <div className="grid gap-3 md:grid-cols-2">
                  <ModeCard active={mode === "BOOKING_FIRST"} title="Court already booked" description="Use one of your paid, confirmed future court bookings." onClick={() => { setMode("BOOKING_FIRST"); setStepMessage(""); }} />
                  <ModeCard active={mode === "PLAN_FIRST"} title={gameType === "FILL_SQUAD" ? "Complete the squad first" : "Plan first, book later"} description="Publish the plan now and secure a real court after players join." onClick={() => { setMode("PLAN_FIRST"); setStepMessage(""); }} />
                </div>

                {mode === "BOOKING_FIRST" ? (
                  <div className="rounded-lg border border-slate-200 p-4 sm:p-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="sport-eyebrow">Verified booking</p>
                        <h2 className="mt-1 text-lg font-black text-sportNavy">Choose the court players will use</h2>
                      </div>
                      <Link className="text-sm font-black text-sportGreen hover:text-green-700" href="/courts">Book another court</Link>
                    </div>
                    {bookings.length === 0 ? (
                      <div className="sport-empty-state mt-4 border-green-200 bg-green-50 p-5">
                        <p className="font-black text-sportNavy">No eligible confirmed booking found.</p>
                        <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">Switch to Plan First, or book and pay for a future court before returning here.</p>
                      </div>
                    ) : (
                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        {bookings.map((booking) => <BookingCard active={booking.id === bookingId} booking={booking} key={booking.id} onClick={() => { setBookingId(booking.id); setStepMessage(""); }} />)}
                      </div>
                    )}
                    <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-800">{gameType === "FILL_SQUAD" ? "The court is already confirmed. The booking owner remains responsible if the squad does not fill." : "This game is linked to a confirmed booking. You remain responsible for the booking even if the game does not fill."}</p>
                  </div>
                ) : (
                  <div className="space-y-5 rounded-lg border border-slate-200 p-4 sm:p-5">
                    <div>
                      <p className="sport-eyebrow">Planning details</p>
                      <h2 className="mt-1 text-lg font-black text-sportNavy">When and where would you like to play?</h2>
                      <p className="mt-1 text-sm leading-6 text-slate-600">This is a proposed plan, not a reservation. Players will be told that the court still needs to be booked.</p>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Proposed date"><input className={inputClass} min={today()} type="date" value={proposedDate} onChange={(event) => { setProposedDate(event.target.value); setProposedStart(""); setStepMessage(""); }} /><div className="mt-2 flex flex-wrap gap-2">{quickDateOptions().map((option) => <button className={`min-h-9 rounded-full border px-3 py-1.5 text-xs font-black transition ${proposedDate === option.value ? "border-sportGreen bg-green-50 text-sportGreen" : "border-slate-200 text-slate-600 hover:border-green-200"}`} key={option.value} onClick={() => { setProposedDate(option.value); setProposedStart(""); setStepMessage(""); }} type="button">{option.label}</button>)}</div></Field>
                      <Field label="Start time"><TimeSelect ariaLabel="Game start time" className={inputClass} disabled={!proposedDate} options={planningStartTimes.filter((time) => canFitDuration(time, proposedDuration) && canStartAt(proposedDate, time, deadlineConfig.minimum_plan_lead_minutes))} placeholder="Choose a start time" value={proposedStart} onChange={(value) => { setProposedStart(value); setStepMessage(""); }} /><p className="mt-1 text-xs font-semibold text-slate-500">Start times follow SportSpot&apos;s supported 30-minute schedule.</p></Field>
                      <Field label="Duration" wide><div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{DURATION_OPTIONS.map((duration) => <button className={`min-h-10 rounded-lg border px-3 text-sm font-black transition ${proposedDuration === duration ? "border-sportGreen bg-green-50 text-sportGreen" : "border-slate-200 text-slate-600 hover:border-green-200"}`} key={duration} onClick={() => { setProposedDuration(duration); if (proposedStart && !canFitDuration(proposedStart, duration)) setProposedStart(""); setStepMessage(""); }} type="button">{formatDuration(duration)}</button>)}</div><p className="mt-2 text-sm font-semibold text-slate-600">{proposedStart && proposedEnd ? `Game ends at ${formatTimeLabel(proposedEnd)}.` : "The end time is calculated from the selected duration."}</p></Field>
                      <Field label="Preferred venue (optional)"><input className={inputClass} placeholder="Any suitable venue" value={preferredVenue} onChange={(event) => { setPreferredVenue(event.target.value); setStepMessage(""); }} /></Field>
                      <Field label="Alternative area or time (optional)" wide><input className={inputClass} placeholder="Example: another nearby area or evening also works" value={alternativeDetails} onChange={(event) => setAlternativeDetails(event.target.value)} /></Field>
                    </div>
                    <ServiceAreaPicker
                      id="game-service-area"
                      onChange={(selection) => { setPreferredAreaCode(selection.code); setPreferredArea(selection.area); setPreferredDistrict(selection.district); setStepMessage(""); }}
                      onClear={() => { setPreferredAreaCode(""); setPreferredArea(""); setPreferredDistrict(""); setStepMessage(""); }}
                      value={selectedServiceArea}
                    />
                    {planStartIsTooSoon ? <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-800">Choose a game time with at least {formatMinutesAsDuration(deadlineConfig.minimum_plan_lead_minutes)} available for recruitment and court booking.</p> : null}
                    <p className="rounded-lg bg-blue-50 px-4 py-3 text-sm font-semibold leading-6 text-blue-800">Players will see “Planning - Court Not Booked Yet” until a real confirmed SportSpot booking is attached.</p>
                  </div>
                )}
              </div>
            ) : null}

            {activeStep === 3 ? (
              <div className="mt-7 space-y-6">
                <StepIntro eyebrow="Step 3 of 5" title="Build the player roster" description="Set the total spots, minimum number to proceed and the Cricksal roles you want to recruit." />
                {gameType === "FILL_SQUAD" ? (
                  <div className="rounded-lg border border-slate-200 p-4 sm:p-5">
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                      <Field label="Team that needs players"><select className={inputClass} value={selectedTeamId || ""} onChange={(event) => { setSelectedTeamId(Number(event.target.value)); setStepMessage(""); }}>{captainTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></Field>
                      <div className="rounded-lg bg-green-50 p-3"><p className="text-xs font-black uppercase tracking-wide text-sportGreen">Captain included</p><p className="mt-1 text-sm font-black text-sportNavy">{teamDetail?.captain_name || "You"}</p></div>
                    </div>
                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <p className="text-sm font-black text-sportNavy">Who from the permanent team is playing?</p>
                      <p className="mt-1 text-sm leading-6 text-slate-600">Select only the members taking part in this game. They do not need to be recruited again.</p>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {activeTeamMembers.length ? activeTeamMembers.map((member) => <button aria-pressed={selectedTeamMemberIds.includes(member.id)} className={`rounded-lg border p-3 text-left transition ${selectedTeamMemberIds.includes(member.id) ? "border-sportGreen bg-green-50" : "border-slate-200 hover:border-green-200"}`} key={member.id} onClick={() => { toggleTeamMember(member.id); setStepMessage(""); }} type="button"><div className="flex items-center justify-between gap-3"><div><p className="font-black text-sportNavy">{member.full_name || member.display_name}</p><p className="mt-1 text-xs font-semibold text-slate-500">{formatRole(member.cricksal_role)} - {member.skill_level || "Skill not set"}</p></div><span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-sportGreen">{selectedTeamMemberIds.includes(member.id) ? "Selected" : "Add"}</span></div></button>) : <p className="rounded-lg bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-600 md:col-span-2">No other active registered team members are available. You can recruit temporary players after publishing.</p>}
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Total player spots"><input className={inputClass} min={2} max={30} type="number" value={capacity} onChange={(event) => { setCapacity(Number(event.target.value)); setStepMessage(""); }} /></Field>
                  <Field label="Minimum to proceed"><input className={inputClass} min={2} max={capacity} type="number" value={minimumPlayers} onChange={(event) => { setMinimumPlayers(Number(event.target.value)); setStepMessage(""); }} /></Field>
                  <Field label="Skill range"><select className={inputClass} value={skill} onChange={(event) => { setSkill(event.target.value as GameCreatePayload["min_skill_level"]); setStepMessage(""); }}><option value="OPEN">Open to all</option><option value="BEGINNER">Beginner+</option><option value="INTERMEDIATE">Intermediate+</option><option value="ADVANCED">Advanced only</option></select></Field>
                </div>
                <div>
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-black text-sportNavy">Role needs</p><p className="mt-1 text-sm text-slate-600">Players choose one available role when they request to join.</p></div><p className="text-sm font-black text-sportGreen">{recruitedSpots} temporary spot{recruitedSpots === 1 ? "" : "s"} requested</p></div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {roleOptions.map((role) => (
                      <div className="rounded-lg border border-slate-200 p-4" key={role.value}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0"><p className="font-black text-sportNavy">{role.label}</p><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{role.helper}</p></div>
                          <div className="flex shrink-0 items-center gap-2"><button aria-label={`Remove one ${role.label} spot`} className="h-9 w-9 rounded-full border border-slate-200 font-black text-slate-700 transition hover:border-green-300 hover:bg-green-50" onClick={() => { setRole(role.value, roleCounts[role.value] - 1); setStepMessage(""); }} type="button">-</button><span className="w-8 text-center font-black text-sportNavy">{roleCounts[role.value]}</span><button aria-label={`Add one ${role.label} spot`} className="h-9 w-9 rounded-full border border-slate-200 font-black text-slate-700 transition hover:border-green-300 hover:bg-green-50" onClick={() => { setRole(role.value, roleCounts[role.value] + 1); setStepMessage(""); }} type="button">+</button></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {needsRoleWarning ? <p className="rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold leading-6 text-red-700" role="alert">You are recruiting {recruitedSpots} temporary players, but only {Math.max(capacity - baselineSpots, 0)} spots remain after the selected squad.</p> : null}
              </div>
            ) : null}

            {activeStep === 4 ? (
              <div className="mt-7 space-y-6">
                <StepIntro eyebrow="Step 4 of 5" title="Add the game details" description="Give players the information they need to decide whether this game works for them." />
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Game title" wide><input className={inputClass} maxLength={120} placeholder="Example: Saturday evening Cricksal" value={title} onChange={(event) => { setTitle(event.target.value); setStepMessage(""); }} /></Field>
                  <Field label="Game style"><select className={inputClass} value={intensity} onChange={(event) => setIntensity(event.target.value as GameIntensity)}><option value="CASUAL">Casual</option><option value="COMPETITIVE">Competitive</option><option value="PRACTICE">Practice / Friendly</option></select></Field>
                  <Field label="Players can join until"><div className="grid grid-cols-[1.15fr_.85fr] gap-2"><input aria-label="Recruitment deadline date" className={inputClass} min={today()} type="date" value={recruitmentDeadlineDate} onChange={(event) => { setRecruitmentDeadlineDate(event.target.value); setStepMessage(""); }} /><TimeSelect ariaLabel="Recruitment deadline time" className={inputClass} options={buildTimeOptions()} value={recruitmentDeadlineTime} onChange={(value) => { setRecruitmentDeadlineTime(value); setStepMessage(""); }} /></div><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">The last time a new join request can be submitted.</p><p className="mt-1 text-xs font-black text-sportGreen">{recruitmentDeadlineAt ? `Closes ${formatDateTimeInNepal(recruitmentDeadlineAt, { dateStyle: "medium", timeStyle: "short" })}.` : "Choose the game time first."}</p></Field>
                  {mode === "PLAN_FIRST" ? <Field label="Secure the court by"><div className="grid grid-cols-[1.15fr_.85fr] gap-2"><input aria-label="Court booking deadline date" className={inputClass} min={today()} type="date" value={bookingDeadlineDate} onChange={(event) => { setBookingDeadlineDate(event.target.value); setStepMessage(""); }} /><TimeSelect ariaLabel="Court booking deadline time" className={inputClass} options={buildTimeOptions()} value={bookingDeadlineTime} onChange={(value) => { setBookingDeadlineTime(value); setStepMessage(""); }} /></div><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">The latest time to select and pay for a court. Recruitment closes first, with at least {formatMinutesAsDuration(deadlineConfig.minimum_recruitment_to_booking_minutes)} between these deadlines.</p><p className="mt-1 text-xs font-black text-sportGreen">{bookingDeadlineAt ? `Book by ${formatDateTimeInNepal(bookingDeadlineAt, { dateStyle: "medium", timeStyle: "short" })}.` : "Choose the game time first."}</p></Field> : null}
                  {deadlineBufferInvalid ? <p className="md:col-span-2 rounded-lg bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-800" role="alert">Recruitment must close at least {formatMinutesAsDuration(deadlineConfig.minimum_recruitment_to_booking_minutes)} before the court-booking deadline.</p> : null}
                  {bookingLeadInvalid ? <p className="md:col-span-2 rounded-lg bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-800" role="alert">The court must be secured at least {formatMinutesAsDuration(deadlineConfig.minimum_booking_lead_minutes)} before the game starts.</p> : null}
                  {selectedStartIsTooSoon ? <p className="md:col-span-2 rounded-lg bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-800" role="alert">Both deadlines must be in the future. Choose a later deadline or a later game time.</p> : null}
                  {recruitmentAfterStartInvalid ? <p className="md:col-span-2 rounded-lg bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-800" role="alert">Recruitment must close before the game starts.</p> : null}
                  <Field label="Description (optional)" wide><textarea className={`${inputClass} min-h-24 py-3`} maxLength={1000} placeholder="Tell players the game mood, expectations and format." value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
                  <Field label="Reporting instructions (optional)" wide><input className={inputClass} maxLength={500} placeholder="Example: arrive 15 minutes early near reception" value={reportingInstructions} onChange={(event) => setReportingInstructions(event.target.value)} /></Field>
                  <Field label="Equipment or dress instructions (optional)" wide><input className={inputClass} maxLength={500} placeholder="Example: bring gloves; turf shoes required" value={equipmentInstructions} onChange={(event) => setEquipmentInstructions(event.target.value)} /></Field>
                  <Field label="Note for accepted players (optional)" wide><textarea className={`${inputClass} min-h-20 py-3`} maxLength={500} placeholder="A coordination note for the planning room or Game Room." value={hostNotes} onChange={(event) => setHostNotes(event.target.value)} /></Field>
                </div>
                <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-4 text-sm font-semibold leading-6 text-slate-700"><input checked={waitlistEnabled} className="mt-1 h-4 w-4 accent-green-700" onChange={(event) => setWaitlistEnabled(event.target.checked)} type="checkbox" /><span><span className="block font-black text-sportNavy">Allow a waitlist when the game is full</span><span className="mt-1 block font-normal text-slate-600">Waitlisted players do not occupy confirmed spots or get Game Room access.</span></span></label>
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900"><p className="font-black">How the deadlines work</p><p className="mt-1">Players can request to join until recruitment closes. For Plan First, the court deadline comes after recruitment closes, and the court must still be booked before the game starts.</p></div>
              </div>
            ) : null}

            {activeStep === 5 ? (
              <div className="mt-7 space-y-5">
                <StepIntro eyebrow="Step 5 of 5" title="Review before publishing" description="Your listing will be visible to eligible Cricksal players after you publish it." />
                <ReviewSection title="Game format" onEdit={() => goToStep(1)} rows={[{ label: "Type", value: gameType === "FILL_SQUAD" ? "Fill My Squad" : "Pickup Game" }, { label: "Court status", value: mode === "BOOKING_FIRST" ? "Verified SportSpot Booking" : "Planning - Court Not Booked Yet" }]} />
                <ReviewSection title="Court plan" onEdit={() => goToStep(2)} rows={[{ label: "Place", value: mode === "BOOKING_FIRST" ? selectedBooking ? `${selectedBooking.venue_name}, ${selectedBooking.venue_area || selectedBooking.venue_city}` : "Choose a booking" : preferredVenue || [preferredArea, preferredDistrict].filter(Boolean).join(", ") || "Choose preferred area" }, { label: "Time", value: mode === "BOOKING_FIRST" ? selectedBooking?.booking_display_time || "Choose booking" : formatPlanSchedule() }, ...(mode === "PLAN_FIRST" ? [{ label: "Court booking by", value: bookingDeadlineAt ? formatDateTimeInNepal(bookingDeadlineAt, { dateStyle: "medium", timeStyle: "short" }) : "Choose a deadline" }] : [])]} />
                <ReviewSection title="Players" onEdit={() => goToStep(3)} rows={[{ label: "Roster", value: `${baselineSpots} selected + ${recruitedSpots} temporary role needs` }, { label: "Capacity", value: `${capacity} player spots` }, { label: "Minimum", value: `${minimumPlayers} players before proceeding` }, { label: "Skill", value: skill === "OPEN" ? "Open to all" : `${skill.charAt(0)}${skill.slice(1).toLowerCase()}+` }]} />
                <ReviewSection title="Listing details" onEdit={() => goToStep(4)} rows={[{ label: "Title", value: title || "Add a title" }, { label: "Style", value: intensity === "PRACTICE" ? "Practice / Friendly" : intensity.charAt(0) + intensity.slice(1).toLowerCase() }, { label: "Recruitment closes", value: recruitmentDeadlineAt ? formatDateTimeInNepal(recruitmentDeadlineAt, { dateStyle: "medium", timeStyle: "short" }) : "Choose a deadline" }, ...(mode === "PLAN_FIRST" ? [{ label: "Court booking by", value: bookingDeadlineAt ? formatDateTimeInNepal(bookingDeadlineAt, { dateStyle: "medium", timeStyle: "short" }) : "Choose a deadline" }] : []), { label: "Waitlist", value: waitlistEnabled ? "Allowed" : "Not allowed" }]} />
                <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-600">Publishing does not reserve a court. {mode === "PLAN_FIRST" ? "This listing remains a plan until you complete the normal court booking and payment flow." : "Your selected booking remains your responsibility even if the game does not fill."}</div>
              </div>
            ) : null}

            <WizardNavigation activeStep={activeStep} isSubmitting={isSubmitting} onBack={() => { setStepMessage(""); setActiveStep((step) => Math.max(1, step - 1)); }} onContinue={continueToNextStep} onPublish={publishFromReview} gameType={gameType} />
          </section>

          <aside className="sport-card h-fit xl:sticky xl:top-24">
            <div className="flex items-start justify-between gap-3"><div><p className="sport-eyebrow">Your setup</p><h2 className="mt-1 text-lg font-black text-sportNavy">{gameType === "FILL_SQUAD" ? "Squad summary" : "Game summary"}</h2></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600">{activeStep}/5</span></div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-sportGreen transition-all duration-300" style={{ width: `${(activeStep / CREATION_STEPS.length) * 100}%` }} /></div>
            <div className="mt-4 space-y-3 text-sm font-semibold text-slate-600">
              <SummaryRow label="Status" value={mode === "BOOKING_FIRST" ? "Verified SportSpot Booking" : "Planning - Court Not Booked Yet"} />
              <SummaryRow label="Place" value={mode === "BOOKING_FIRST" ? selectedBooking ? `${selectedBooking.venue_name}, ${selectedBooking.venue_area || selectedBooking.venue_city}` : "Choose booking" : preferredVenue || [preferredArea, preferredDistrict].filter(Boolean).join(", ") || "Choose preferred area"} />
              <SummaryRow label="Time" value={mode === "BOOKING_FIRST" ? selectedBooking?.booking_display_time || "Choose booking" : formatPlanSchedule()} />
              <SummaryRow label="Roster" value={`${baselineSpots} selected + ${recruitedSpots} temporary role needs`} />
              <SummaryRow label="Minimum" value={`${minimumPlayers} players before proceeding`} />
            </div>
            <p className="mt-4 border-t border-slate-100 pt-4 text-xs font-semibold leading-5 text-slate-500">{gameType === "FILL_SQUAD" ? "Accepted temporary players join this game only. Permanent team invitations stay separate." : "Accepted players get access to a planning room first. A full Game Room appears after the court booking is verified."}</p>
          </aside>
        </section>
      )}
    </div>
  );
}

function CreationProgress({ activeStep, onSelect }: { activeStep: number; onSelect: (step: number) => void }) {
  return (
    <nav aria-label="Game creation progress" className="overflow-x-auto border-b border-slate-100 pb-4">
      <ol className="flex min-w-[560px] items-center gap-2 sm:min-w-0">
        {CREATION_STEPS.map((step, index) => (
          <li className="flex min-w-0 flex-1 items-center gap-2" key={step.number}>
            <button
              aria-current={activeStep === step.number ? "step" : undefined}
              className={`flex min-h-10 min-w-0 items-center gap-2 rounded-lg px-2 text-left text-xs font-black transition focus:outline-none focus-visible:ring-2 focus-visible:ring-green-300 ${activeStep === step.number ? "bg-green-50 text-sportGreen" : step.number < activeStep ? "text-slate-600 hover:bg-slate-50" : "cursor-default text-slate-400"}`}
              disabled={step.number >= activeStep}
              onClick={() => onSelect(step.number)}
              type="button"
            >
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${activeStep === step.number ? "bg-sportGreen text-white" : step.number < activeStep ? "bg-slate-100 text-slate-700" : "bg-slate-100 text-slate-400"}`}>{step.number < activeStep ? "✓" : step.number}</span>
              <span className="hidden min-w-0 truncate sm:block">{step.label}</span>
            </button>
            {index < CREATION_STEPS.length - 1 ? <span className={`h-px flex-1 ${step.number < activeStep ? "bg-green-200" : "bg-slate-200"}`} /> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function StepIntro({ description, eyebrow, title }: { description: string; eyebrow: string; title: string }) {
  return <div><p className="sport-eyebrow">{eyebrow}</p><h2 className="mt-1 text-xl font-black tracking-tight text-sportNavy sm:text-2xl">{title}</h2><p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-600">{description}</p></div>;
}

function MiniPrinciple({ description, title }: { description: string; title: string }) {
  return <div className="rounded-lg bg-slate-50 p-3"><p className="text-sm font-black text-sportNavy">{title}</p><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{description}</p></div>;
}

type ReviewRow = { label: string; value: string };

function ReviewSection({ onEdit, rows, title }: { onEdit: () => void; rows: ReviewRow[]; title: string }) {
  return <section className="rounded-lg border border-slate-200 p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><h3 className="font-black text-sportNavy">{title}</h3><button className="text-sm font-black text-sportGreen hover:text-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-300" onClick={onEdit} type="button">Edit</button></div><dl className="mt-3 grid gap-3 sm:grid-cols-2">{rows.map((row) => <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2.5" key={`${title}-${row.label}`}><dt className="text-xs font-black uppercase tracking-wide text-slate-500">{row.label}</dt><dd className="mt-1 break-words text-sm font-black text-sportNavy">{row.value}</dd></div>)}</dl></section>;
}

function WizardNavigation({ activeStep, gameType, isSubmitting, onBack, onContinue, onPublish }: { activeStep: number; gameType: GameType; isSubmitting: boolean; onBack: () => void; onContinue: () => void; onPublish: () => void }) {
  const isReview = activeStep === CREATION_STEPS.length;
  return <div className="mt-7 flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between"><div>{activeStep > 1 ? <button className="sport-secondary-button w-full sm:w-auto" disabled={isSubmitting} onClick={onBack} type="button">Back</button> : <span className="hidden text-sm font-semibold text-slate-500 sm:inline">You can review every choice before publishing.</span>}</div>{isReview ? <button className="sport-primary-button w-full sm:w-auto" disabled={isSubmitting} onClick={onPublish} type="button">{isSubmitting ? "Publishing..." : gameType === "FILL_SQUAD" ? "Publish Fill My Squad" : "Publish Pickup Game"}</button> : <button className="sport-primary-button w-full sm:w-auto" onClick={onContinue} type="button">Continue to {CREATION_STEPS[activeStep].label}</button>}</div>;
}

function ModeCard({ active, description, disabled = false, onClick, title }: { active: boolean; description: string; disabled?: boolean; onClick: () => void; title: string }) {
  return <button className={`rounded-lg border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-green-200 disabled:cursor-not-allowed disabled:opacity-60 ${active ? "border-sportGreen bg-green-50 text-sportGreen" : "border-slate-200 bg-white text-sportNavy hover:border-green-200"}`} disabled={disabled} onClick={onClick} type="button"><span className="text-base font-black">{title}</span><span className="mt-1 block text-sm font-semibold text-slate-500">{description}</span></button>;
}

function BookingCard({ active, booking, onClick }: { active: boolean; booking: EligibleGameBooking; onClick: () => void }) {
  return <button className={`rounded-lg border p-4 text-left transition ${active ? "border-sportGreen bg-green-50" : "border-slate-200 hover:border-green-200"}`} onClick={onClick} type="button"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-sportNavy">{booking.venue_name}</p><p className="mt-1 text-sm font-semibold text-slate-600">{booking.court_name} - {booking.venue_area || booking.venue_city}</p></div><span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-sportGreen">Paid</span></div><p className="mt-3 text-sm font-semibold text-slate-600">{booking.booking_display_time}</p><p className="mt-1 text-xs font-black text-slate-500">{booking.booking_code} - NPR {Number(booking.amount).toLocaleString()}</p></button>;
}

function Field({ children, label, wide = false }: { children: React.ReactNode; label: string; wide?: boolean }) {
  return <label className={`block ${wide ? "md:col-span-2" : ""}`}><span className="sport-field-label">{label}</span><div className="mt-1">{children}</div></label>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-black text-sportNavy">{value}</p></div>;
}

function formatRole(value: string) { return value === "ALL_ROUNDER" ? "All-rounder" : value === "WICKETKEEPER" ? "Wicketkeeper" : value === "BATSMAN" ? "Batsman" : value === "BOWLER" ? "Bowler" : "Any role"; }

const inputClass = "sport-input";

function addMinutesToTime(value: string, minutesToAdd: number) {
  if (!value) return "";
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return "";
  const totalMinutes = hours * 60 + minutes + minutesToAdd;
  if (totalMinutes >= 24 * 60) return "";
  return `${Math.floor(totalMinutes / 60).toString().padStart(2, "0")}:${(totalMinutes % 60).toString().padStart(2, "0")}`;
}

function canFitDuration(value: string, duration: number) {
  return Boolean(addMinutesToTime(value, duration));
}

function canStartAt(dateValue: string, timeValue: string, minimumLeadMinutes = 0) {
  if (!dateValue || dateValue !== today()) return true;
  const startAt = appDateTimeToIso(dateValue, timeValue);
  return Boolean(startAt && new Date(startAt).getTime() > Date.now() + minimumLeadMinutes * 60 * 1000);
}

function formatDuration(minutes: number) {
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function appDateTimeToIso(dateValue: string, timeValue: string) {
  return localDateTimeToIso(dateValue, timeValue);
}

function addMinutesToIso(startAt: string | null, minutes: number) {
  if (!startAt) return "";
  const timestamp = new Date(startAt).getTime();
  return Number.isNaN(timestamp) ? "" : new Date(timestamp + minutes * 60 * 1000).toISOString();
}

function splitAppDateTime(value: string) {
  if (!value) return { date: "", time: "" };
  const [date, time] = splitDateTimeInput(toDateTimeInput(value));
  return { date, time };
}

function recommendedDeadlineParts(startAt: string, mode: CreationMode, config: DeadlineConfig) {
  const startTimestamp = new Date(startAt).getTime();
  if (mode !== "PLAN_FIRST") {
    return {
      recruitment: splitAppDateTime(addMinutesToIso(startAt, -config.recommended_booked_game_recruitment_lead_minutes)),
      booking: { date: "", time: "" },
    };
  }

  const nowTimestamp = Date.now();
  const bookingFloor = nowTimestamp + (config.minimum_recruitment_to_booking_minutes + 15) * 60 * 1000;
  const latestBooking = startTimestamp - config.minimum_booking_lead_minutes * 60 * 1000;
  const preferredBooking = startTimestamp - config.recommended_booking_lead_minutes * 60 * 1000;
  const bookingTimestamp = Math.min(Math.max(preferredBooking, bookingFloor), latestBooking);
  const recruitmentFloor = nowTimestamp + 15 * 60 * 1000;
  const preferredRecruitment = startTimestamp - config.recommended_recruitment_lead_minutes * 60 * 1000;
  const recruitmentTimestamp = Math.min(
    Math.max(preferredRecruitment, recruitmentFloor),
    bookingTimestamp - config.minimum_recruitment_to_booking_minutes * 60 * 1000,
  );
  return {
    recruitment: splitAppDateTime(new Date(recruitmentTimestamp).toISOString()),
    booking: splitAppDateTime(new Date(bookingTimestamp).toISOString()),
  };
}

function formatMinutesAsDuration(minutes: number) {
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function quickDateOptions() {
  const currentDate = today();
  return [
    { label: "Today", value: currentDate },
    { label: "Tomorrow", value: addCalendarDays(currentDate, 1) },
    { label: "In 3 days", value: addCalendarDays(currentDate, 3) },
  ];
}

function today() {
  return getLocalDateString();
}
