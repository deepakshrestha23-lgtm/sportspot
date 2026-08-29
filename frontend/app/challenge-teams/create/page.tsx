"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { emitToast } from "@/lib/toast";
import { buildTimeOptions, formatDateOnly, formatTimeValue, joinDateTimeInput, localDateTimeToIso, parseDateTimeInput, splitDateTimeInput, toDateTimeInput, toNepalDate, toNepalTime } from "@/lib/dates";
import BackButton from "@/components/BackButton";
import TimeSelect from "@/components/TimeSelect";
import type { EligibleBookingsResponse, EligibleGameBooking } from "@/types/matchmaking";
import type { MyTeamsResponse, Team } from "@/types/team";
import type { ChallengeTeamListResponse, ChallengeTeamSummary } from "@/types/teamChallenge";

type Mode = "PLAN_FIRST" | "BOOKING_FIRST";
type ChallengeType = "DIRECT" | "OPEN";
type ReferenceOption = { value: string; label: string };
const toLocalDate = toNepalDate;
const formatTimeLabel = formatTimeValue;
type DiscoveryReferenceResponse = {
  filters?: {
    districts?: ReferenceOption[];
    areas_by_district?: Record<string, ReferenceOption[]>;
    start_times?: string[];
  };
  districts?: ReferenceOption[];
  areas_by_district?: Record<string, ReferenceOption[]>;
  start_times?: string[];
};

export default function CreateTeamChallengePage() {
  return <Suspense fallback={<main className="mx-auto max-w-4xl px-4 py-10"><div className="h-[560px] animate-pulse rounded-xl bg-white" /></main>}><CreateTeamChallengeContent /></Suspense>;
}

function CreateTeamChallengeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetId = Number(searchParams.get("team") || 0);
  const [teams, setTeams] = useState<Team[]>([]);
  const [opponentTeams, setOpponentTeams] = useState<ChallengeTeamSummary[]>([]);
  const [bookings, setBookings] = useState<EligibleGameBooking[]>([]);
  const [districts, setDistricts] = useState<ReferenceOption[]>([]);
  const [areasByDistrict, setAreasByDistrict] = useState<Record<string, ReferenceOption[]>>({});
  const [planningTimes, setPlanningTimes] = useState<string[]>([]);
  const [targetTeam, setTargetTeam] = useState<ChallengeTeamSummary | null>(null);
  const [teamId, setTeamId] = useState(0);
  const [mode, setMode] = useState<Mode>("PLAN_FIRST");
  const [challengeType, setChallengeType] = useState<ChallengeType>(targetId ? "DIRECT" : "OPEN");
  const [bookingId, setBookingId] = useState(0);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [district, setDistrict] = useState("");
  const [area, setArea] = useState("");
  const [venue, setVenue] = useState("");
  const [playersPerSide, setPlayersPerSide] = useState(6);
  const [intensity, setIntensity] = useState("CASUAL");
  const [message, setMessage] = useState("");
  const [responseDeadline, setResponseDeadline] = useState("");
  const [bookingDeadline, setBookingDeadline] = useState("");
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [contextNotice, setContextNotice] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const [deadlineError, setDeadlineError] = useState("");
  const [responseDeadlineTouched, setResponseDeadlineTouched] = useState(false);
  const [bookingDeadlineTouched, setBookingDeadlineTouched] = useState(false);
  const [requestId] = useState(() => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `challenge-${Date.now()}`);

  useEffect(() => {
    void loadContext();
  }, []);

  useEffect(() => {
    const selected = bookings.find((booking) => booking.id === bookingId);
    if (mode !== "BOOKING_FIRST" || !selected) return;
    const start = selected.start_at ? new Date(selected.start_at) : null;
    const end = selected.end_at ? new Date(selected.end_at) : null;
    if (!start || Number.isNaN(start.getTime())) return;
    setDate(toNepalDate(start));
    setStartTime(toNepalTime(start));
    if (end && !Number.isNaN(end.getTime())) setEndTime(toNepalTime(end));
    setDistrict(selected.venue_city || "");
    setArea(selected.venue_area || "");
    setVenue(selected.venue_name || "");
  }, [bookingId, bookings, mode]);

  useEffect(() => {
    if (!date || !startTime) return;
    const start = parseDateTimeInput(joinDateTimeInput(date, startTime));
    if (!start) return;
    const response = new Date(start.getTime() - (mode === "BOOKING_FIRST" ? 2 : 24) * 60 * 60 * 1000);
    const booking = new Date(start.getTime() - 2 * 60 * 60 * 1000);
    setResponseDeadline((current) => responseDeadlineTouched ? current : response.getTime() > Date.now() ? toDateTimeInput(response) : "");
    if (mode === "PLAN_FIRST") {
      setBookingDeadline((current) => bookingDeadlineTouched ? current : booking.getTime() > Date.now() ? toDateTimeInput(booking) : "");
    }
  }, [date, mode, startTime, responseDeadlineTouched, bookingDeadlineTouched]);

  async function loadContext() {
    setIsLoading(true);
    setContextNotice("");
    try {
      const [teamsResult, bookingsResult, opponentsResult, referenceResult] = await Promise.allSettled([
        api.get<MyTeamsResponse>("/api/teams/my-teams/"),
        api.get<EligibleBookingsResponse>("/api/matchmaking/games/eligible-bookings/"),
        api.get<ChallengeTeamListResponse>("/api/team-challenges/teams/"),
        api.get<DiscoveryReferenceResponse>("/api/venues/discovery/reference/"),
      ]);
      const requiredContextError = teamsResult.status === "rejected"
        ? teamsResult.reason
        : opponentsResult.status === "rejected"
          ? opponentsResult.reason
          : null;
      if (requiredContextError) throw requiredContextError;
      if (teamsResult.status !== "fulfilled" || opponentsResult.status !== "fulfilled") {
        throw new Error("We could not load the teams needed to create a challenge.");
      }
      const teamsResponse = teamsResult.value;
      const captains = teamsResponse.data.teams.filter((team) => team.is_captain);
      setTeams(captains);
      const opponentsResponse = opponentsResult.value;
      setOpponentTeams(opponentsResponse.data.teams.filter((team) => !captains.some((captain) => captain.id === team.id)));
      if (bookingsResult.status === "fulfilled") {
        setBookings(bookingsResult.value.data.bookings);
      } else {
        setBookings([]);
        setContextNotice("Your eligible bookings could not be loaded. You can still create a planned challenge and add a confirmed booking later.");
      }
      if (referenceResult.status === "fulfilled") {
        const referenceResponse = referenceResult.value;
        setDistricts(referenceResponse.data.filters?.districts || referenceResponse.data.districts || []);
        setAreasByDistrict(referenceResponse.data.filters?.areas_by_district || {});
        setPlanningTimes(referenceResponse.data.filters?.start_times || referenceResponse.data.start_times || []);
      } else {
        setDistricts([]);
        setAreasByDistrict({});
        setPlanningTimes([]);
        setContextNotice("Location options could not be loaded. Please try again before creating a planned challenge.");
      }
      if (captains.length) setTeamId(captains[0].id);
      if (bookingsResult.status === "fulfilled" && bookingsResult.value.data.bookings.length) setBookingId(bookingsResult.value.data.bookings[0].id);
      if (targetId) setTargetTeam(opponentsResponse.data.teams.find((team) => team.id === targetId) || null);
      setError("");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load the information needed to create a challenge.", { notify: false }));
    } finally {
      setIsLoading(false);
    }
  }

  const selectedBooking = useMemo(() => bookings.find((booking) => booking.id === bookingId) || null, [bookingId, bookings]);
  const areaOptions = district ? areasByDistrict[district] || [] : [];
  const startTimeOptions = useMemo(
    () => planningTimes.filter((time) => planningTimes.some((end) => end > time)),
    [planningTimes],
  );
  const endTimeOptions = useMemo(
    () => planningTimes.filter((time) => !startTime || time > startTime),
    [planningTimes, startTime],
  );
  const deadlineTimeOptions = useMemo(() => buildTimeOptions(), []);

  async function submit() {
    setScheduleError("");
    setDeadlineError("");
    if (!teamId) return emitToast({ message: "Choose the team sending this challenge.", type: "warning" });
    if (challengeType === "DIRECT" && !targetTeam) return emitToast({ message: "Choose an opposing team.", type: "warning" });
    if (mode === "BOOKING_FIRST" && !bookingId) return emitToast({ message: "Choose a paid confirmed booking.", type: "warning" });
    if (mode === "PLAN_FIRST" && (!date || !startTime || !endTime || !district || !area)) {
      setScheduleError("Complete the proposed date, start time, end time, district and area before sending.");
      setStep(2);
      return emitToast({ message: "Complete the proposed match schedule before sending.", type: "warning", dedupeKey: "challenge-schedule-required" });
    }
    if (!responseDeadline) return emitToast({ message: "Choose when the other team should respond.", type: "warning" });
    if (mode === "PLAN_FIRST" && !bookingDeadline) return emitToast({ message: "Choose when the court must be booked.", type: "warning" });
    const start = parseDateTimeInput(joinDateTimeInput(date, startTime));
    const end = parseDateTimeInput(joinDateTimeInput(date, endTime));
    if (mode === "PLAN_FIRST" && (!start || !end || end <= start)) {
      setScheduleError("Choose an end time after the start time.");
      setStep(2);
      return emitToast({ message: "Choose an end time after the start time.", type: "warning", dedupeKey: "challenge-schedule-order" });
    }
    if (start && start.getTime() <= Date.now()) {
      setScheduleError("Choose a future date and time for the match.");
      setStep(2);
      return emitToast({ message: "Choose a future date and time for the match.", type: "warning", dedupeKey: "challenge-schedule-future" });
    }
    const responseAt = parseDateTimeInput(responseDeadline);
    const bookingAt = parseDateTimeInput(bookingDeadline);
    if (!responseAt || responseAt.getTime() <= Date.now()) {
      setDeadlineError("Choose a future response deadline.");
      return emitToast({ message: "Choose a future response deadline.", type: "warning", dedupeKey: "challenge-response-deadline-required" });
    }
    if (start && responseAt >= start) {
      setDeadlineError("The response deadline must be before the match starts.");
      return emitToast({ message: "Set the response deadline before the match starts.", type: "warning", dedupeKey: "challenge-response-before-start" });
    }
    if (mode === "PLAN_FIRST") {
      if (!bookingAt) {
        setDeadlineError("Choose when the court must be booked.");
        return emitToast({ message: "Choose a court-booking deadline.", type: "warning", dedupeKey: "challenge-booking-deadline-required" });
      }
      if (bookingAt <= responseAt) {
        setDeadlineError("The court-booking deadline must be later than the response deadline.");
        return emitToast({ message: "Set the court-booking deadline after the response deadline.", type: "warning", dedupeKey: "challenge-deadline-order" });
      }
      if (start && bookingAt >= start) {
        setDeadlineError("The court-booking deadline must be before the match starts.");
        return emitToast({ message: "Set the court-booking deadline before the match starts.", type: "warning", dedupeKey: "challenge-booking-before-start" });
      }
    }
    setIsSubmitting(true);
    try {
      const response = await api.post<{ challenge: { id: number } }>("/api/team-challenges/challenges/", {
        challenge_type: challengeType,
        challenger_team: teamId,
        challenged_team: challengeType === "DIRECT" ? targetTeam?.id : null,
        court_mode: mode,
        booking: mode === "BOOKING_FIRST" ? bookingId : null,
        proposed_date: mode === "PLAN_FIRST" ? date : null,
        proposed_start_time: mode === "PLAN_FIRST" ? startTime : null,
        proposed_end_time: mode === "PLAN_FIRST" ? endTime : null,
        preferred_district: district,
        preferred_area: area,
        preferred_venue_name: venue,
        players_per_side: playersPerSide,
        intensity,
        message,
        response_deadline: toIso(responseDeadline),
        booking_deadline: mode === "PLAN_FIRST" ? toIso(bookingDeadline) : null,
        client_request_id: requestId,
      });
      emitToast({ message: "Your team challenge has been sent.", type: "success", dedupeKey: `challenge-created-${response.data.challenge.id}` });
      router.push(`/challenge-teams/${response.data.challenge.id}`);
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not send this challenge. Please check the details and try again."), type: "error", dedupeKey: "challenge-create-error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) return <main className="mx-auto max-w-4xl px-4 py-10"><div className="h-[560px] animate-pulse rounded-xl bg-white" /></main>;
  if (error) return <main className="mx-auto max-w-2xl px-4 py-10"><section className="sport-error-state text-center"><h1 className="text-xl font-bold text-red-950">We could not open challenge setup.</h1><p className="mt-2 text-sm text-red-800">{error}</p><button className="sport-primary-button mt-5 bg-red-600 hover:bg-red-700" onClick={() => void loadContext()} type="button">Try again</button></section></main>;
  if (!teams.length) return <main className="mx-auto max-w-2xl px-4 py-10"><section className="sport-surface p-8 text-center"><h1 className="text-xl font-bold text-sportNavy">Create a team before sending a challenge</h1><p className="mt-2 text-sm text-slate-600">Only a team captain can send a team challenge.</p><Link className="sport-primary-button mt-5" href="/dashboard/player/teams/create">Create Team</Link></section></main>;

  return <main className="min-h-[calc(100vh-68px)] bg-[var(--sport-canvas)] px-4 py-7 sm:px-6 lg:px-8"><div className="mx-auto max-w-5xl space-y-6">
    <div><BackButton href="/challenge-teams" label="Back to challenges" /><p className="sport-eyebrow">New team challenge</p><h1 className="sport-page-title">Arrange a Cricksal match</h1><p className="sport-page-description">Set a clear proposal. Accepting a challenge agrees the match plan; a court is confirmed separately unless you link an existing booking.</p></div>
    {contextNotice ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{contextNotice}</p> : null}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section className="sport-surface p-5 sm:p-7"><div className="mb-7 flex items-center gap-2 text-xs font-bold text-slate-500"><Step number={1} label="Teams" active={step === 1} /><span className="h-px flex-1 bg-slate-200" /><Step number={2} label="Schedule" active={step === 2} /><span className="h-px flex-1 bg-slate-200" /><Step number={3} label="Deadlines" active={step === 3} /></div>
        {step === 1 ? <div className="space-y-6"><Field label="Your team"><select className="sport-field w-full" onChange={(event) => setTeamId(Number(event.target.value))} value={teamId}><option value={0}>Choose a team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></Field><div><p className="mb-2 text-sm font-semibold text-sportNavy">Challenge type</p><div className="grid gap-3 sm:grid-cols-2"><Choice active={challengeType === "DIRECT"} description="Choose one team to invite." label="Direct challenge" onClick={() => setChallengeType("DIRECT")} /><Choice active={challengeType === "OPEN"} description="Let an eligible team respond." label="Open challenge" onClick={() => setChallengeType("OPEN")} /></div></div>{challengeType === "DIRECT" ? <Field label="Opposing team"><select className="sport-field w-full" onChange={(event) => setTargetTeam(opponentTeams.find((team) => team.id === Number(event.target.value)) || null)} value={targetTeam?.id || 0}><option value={0}>Choose an opposing team</option>{opponentTeams.map((team) => <option key={team.id} value={team.id}>{team.name} - {team.location}</option>)}</select></Field> : <p className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-800">Your proposal will be visible to teams that are accepting challenges. You will choose the opponent after a team responds.</p>}<button className="sport-primary-button" onClick={() => setStep(2)} type="button">Continue to schedule</button></div> : null}
        {step === 2 ? <div className="space-y-6"><div><p className="mb-2 text-sm font-semibold text-sportNavy">Court arrangement</p><div className="grid gap-3 sm:grid-cols-2"><Choice active={mode === "BOOKING_FIRST"} description="Use a paid confirmed booking you own." label="Use an existing booking" onClick={() => { setMode("BOOKING_FIRST"); setScheduleError(""); }} /><Choice active={mode === "PLAN_FIRST"} description="Agree the match first, then book a court." label="Plan first" onClick={() => { setMode("PLAN_FIRST"); setScheduleError(""); }} /></div></div>{mode === "BOOKING_FIRST" ? <Field label="Confirmed booking"><select className="sport-field w-full" onChange={(event) => setBookingId(Number(event.target.value))} value={bookingId}><option value={0}>Choose a confirmed booking</option>{bookings.map((booking) => <option key={booking.id} value={booking.id}>{booking.venue_name} - {booking.court_name} - {booking.booking_display_time}</option>)}</select>{selectedBooking ? <p className="mt-2 text-xs text-slate-500">{selectedBooking.venue_city}{selectedBooking.venue_area ? ` - ${selectedBooking.venue_area}` : ""} - {selectedBooking.booking_code}</p> : <p className="mt-2 text-sm text-amber-700">Only your paid, confirmed future bookings can be used.</p>}</Field> : <div className="space-y-4"><p className="text-sm leading-6 text-slate-600">Set the proposed match schedule first. These details are shared with the other captain and are separate from the later court booking.</p><div className="grid gap-4 sm:grid-cols-2"><Field label="Proposed date"><input className="sport-field w-full" min={toLocalDate(new Date())} onChange={(event) => { setDate(event.target.value); setScheduleError(""); }} type="date" value={date} /></Field><Field label="Start time"><select className="sport-field w-full" onChange={(event) => { setStartTime(event.target.value); if (endTime && event.target.value >= endTime) setEndTime(""); setScheduleError(""); }} value={startTime}><option value="">Choose start time</option>{startTimeOptions.map((time) => <option key={time} value={time}>{formatTimeLabel(time)}</option>)}</select></Field><Field label="End time"><select className="sport-field w-full" disabled={!startTime} onChange={(event) => { setEndTime(event.target.value); setScheduleError(""); }} value={endTime}><option value="">{startTime ? "Choose end time" : "Choose a start time first"}</option>{endTimeOptions.map((time) => <option key={time} value={time}>{formatTimeLabel(time)}</option>)}</select></Field><Field label="District"><select className="sport-field w-full" onChange={(event) => { setDistrict(event.target.value); setArea(""); setScheduleError(""); }} value={district}><option value="">Choose district</option>{districts.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field><Field label="Area"><select className="sport-field w-full" disabled={!district} onChange={(event) => { setArea(event.target.value); setScheduleError(""); }} value={area}><option value="">{district ? "Choose area" : "Choose a district first"}</option>{areaOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field><Field label="Preferred venue (optional)"><input className="sport-field w-full" onChange={(event) => setVenue(event.target.value)} placeholder="Any suitable venue" value={venue} /></Field></div></div>}{scheduleError ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900" role="alert">{scheduleError}</p> : null}<div className="grid gap-4 sm:grid-cols-2"><Field label="Players per side"><input className="sport-field w-full" max={30} min={2} onChange={(event) => setPlayersPerSide(Number(event.target.value))} type="number" value={playersPerSide} /></Field><Field label="Match style"><select className="sport-field w-full" onChange={(event) => setIntensity(event.target.value)} value={intensity}><option value="CASUAL">Casual</option><option value="COMPETITIVE">Competitive</option><option value="PRACTICE">Practice</option></select></Field></div><div className="flex flex-wrap gap-2"><button className="sport-secondary-button" onClick={() => setStep(1)} type="button">Back</button><button className="sport-primary-button" onClick={() => setStep(3)} type="button">Continue to deadlines</button></div></div> : null}
        {step === 3 ? <div className="space-y-6"><div className="rounded-lg border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm leading-6 text-blue-900"><p className="font-bold">Set the deadlines in order</p><p className="mt-1">The other captain responds first. For a planned match, the court-booking deadline comes later and must still be before the match starts.</p></div><div className="grid gap-4 sm:grid-cols-2"><DateTimeField label="Response deadline" helper="When the other captain must decide" minDate={toLocalDate(new Date())} onChange={(value) => { setResponseDeadline(value); setResponseDeadlineTouched(true); setDeadlineError(""); }} options={deadlineTimeOptions} value={responseDeadline} />{mode === "PLAN_FIRST" ? <DateTimeField label="Court-booking deadline" helper="When a paid court must be secured" minDate={toLocalDate(new Date())} onChange={(value) => { setBookingDeadline(value); setBookingDeadlineTouched(true); setDeadlineError(""); }} options={deadlineTimeOptions} value={bookingDeadline} /> : null}</div>{deadlineError ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900" role="alert">{deadlineError}</p> : null}<Field label="Message (optional)"><textarea className="sport-field min-h-28 w-full" maxLength={500} onChange={(event) => setMessage(event.target.value)} placeholder="Share any useful match details with the other captain." value={message} /></Field><div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-700"><p className="font-bold text-sportNavy">Before you send</p><p className="mt-2">{mode === "BOOKING_FIRST" ? "This challenge includes your confirmed SportSpot booking." : "This is a plan only. A SportSpot court will still need to be selected and paid for after both teams agree."}</p></div><div className="flex flex-wrap gap-2"><button className="sport-secondary-button" onClick={() => setStep(2)} type="button">Back to schedule</button><button className="sport-primary-button" disabled={isSubmitting} onClick={() => void submit()} type="button">{isSubmitting ? "Sending..." : "Send Challenge"}</button></div></div> : null}
      </section>
      <aside className="sport-surface h-fit p-5"><p className="sport-eyebrow">Match summary</p><h2 className="mt-2 text-lg font-bold text-sportNavy">{teams.find((team) => team.id === teamId)?.name || "Your team"}</h2><p className="mt-1 text-sm text-slate-600">vs {targetTeam?.name || "an eligible team"}</p><div className="mt-5 space-y-3 border-t border-slate-100 pt-4 text-sm text-slate-600"><p><strong className="text-sportNavy">Format:</strong> {playersPerSide} a side</p><p><strong className="text-sportNavy">Schedule:</strong> {date ? `${formatDateLabel(date)}${startTime ? ` - ${formatTimeLabel(startTime)}${endTime ? `-${formatTimeLabel(endTime)}` : ""}` : " - Add a time"}` : "Add a proposed date and time"}</p><p><strong className="text-sportNavy">Court:</strong> {mode === "BOOKING_FIRST" ? selectedBooking?.venue_name || "Choose a booking" : "To be booked after agreement"}</p></div></aside>
    </div>
  </div></main>;
}

function Step({ active, label, number }: { active: boolean; label: string; number: number }) { return <div className={`flex items-center gap-2 ${active ? "text-sportGreen" : "text-slate-400"}`}><span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${active ? "bg-green-50" : "bg-slate-100"}`}>{number}</span><span className="hidden sm:inline">{label}</span></div>; }
function Choice({ active, description, label, onClick }: { active: boolean; description: string; label: string; onClick: () => void }) { return <button aria-pressed={active} className={`rounded-lg border p-4 text-left transition ${active ? "border-sportGreen bg-green-50/70 ring-2 ring-green-100" : "border-slate-200 bg-white hover:border-green-200"}`} onClick={onClick} type="button"><span className="block font-bold text-sportNavy">{label}</span><span className="mt-1 block text-sm text-slate-600">{description}</span></button>; }
function Field({ children, label }: { children: ReactNode; label: string }) { return <label className="block text-sm font-semibold text-sportNavy"><span className="mb-1.5 block">{label}</span>{children}</label>; }
function DateTimeField({ helper, label, minDate, onChange, options, value }: { helper: string; label: string; minDate: string; onChange: (value: string) => void; options: string[]; value: string }) {
  const [date, time] = splitDateTimeInput(value);
  return <fieldset className="min-w-0"><legend className="text-sm font-semibold text-sportNavy">{label}</legend><p className="mt-1 text-xs text-slate-500">{helper}</p><div className="mt-2 grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-2"><label className="sr-only" htmlFor={`${label}-date`}>{label} date</label><input aria-label={`${label} date`} className="sport-field min-w-0 w-full" id={`${label}-date`} min={minDate} onChange={(event) => onChange(joinDateTimeInput(event.target.value, time))} type="date" value={date} /><TimeSelect ariaLabel={`${label} time`} className="sport-field min-w-0 w-full" id={`${label}-time`} options={options} placeholder="Choose time" value={time} onChange={(nextTime) => onChange(joinDateTimeInput(date, nextTime))} /></div></fieldset>;
}
function localDateTime(date: string, time: string) { const iso = localDateTimeToIso(date, time); return iso ? new Date(iso) : null; }
function toIso(value: string) { const date = parseDateTimeInput(value); return date ? date.toISOString() : value; }
function formatDateLabel(value: string) { return formatDateOnly(value); }
