"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getCurrentUser } from "@/lib/auth";
import { buildTimeOptions, formatDateTimeInNepal, formatTimeValue, joinDateTimeInput, localDateTimeToIso, parseDateTimeInput, splitDateTimeInput, toDateTimeInput, toNepalDate } from "@/lib/dates";
import { emitToast } from "@/lib/toast";
import BackButton from "@/components/BackButton";
import TimeSelect from "@/components/TimeSelect";
import type { EligibleBookingsResponse, EligibleGameBooking } from "@/types/matchmaking";
import type { MyTeamsResponse, Team } from "@/types/team";
import type { OpenChallengeResponse, TeamChallenge, TeamChallengeResponse } from "@/types/teamChallenge";

type Action = "decision" | "counter" | "respond" | "select" | "withdraw" | "withdraw-response" | "reconfirm" | "attach" | "reschedule" | "cancel" | null;
type ReferenceOption = { value: string; label: string };
type DiscoveryReferenceResponse = { filters?: { districts?: ReferenceOption[]; areas_by_district?: Record<string, ReferenceOption[]> }; districts?: ReferenceOption[]; areas_by_district?: Record<string, ReferenceOption[]> };
const toLocalDate = toNepalDate;
const formatTimeLabel = formatTimeValue;
const splitLocalDateTime = splitDateTimeInput;
const joinLocalDateTime = joinDateTimeInput;

function localDateTime(date: string, time: string) {
  return parseDateTimeInput(joinDateTimeInput(date, time));
}

function parseLocalDateTimeInput(value: string) {
  return parseDateTimeInput(value);
}

export default function TeamChallengeDetailsPage() {
  const params = useParams<{ challengeId: string }>();
  const router = useRouter();
  const user = getCurrentUser();
  const challengeId = Number(params.challengeId);
  const [challenge, setChallenge] = useState<TeamChallenge | null>(null);
  const [myTeams, setMyTeams] = useState<Team[]>([]);
  const [eligibleBookings, setEligibleBookings] = useState<EligibleGameBooking[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState(0);
  const [selectedBookingId, setSelectedBookingId] = useState(0);
  const [responseMessage, setResponseMessage] = useState("");
  const [counterDate, setCounterDate] = useState("");
  const [counterStart, setCounterStart] = useState("");
  const [counterEnd, setCounterEnd] = useState("");
  const [counterDistrict, setCounterDistrict] = useState("");
  const [counterArea, setCounterArea] = useState("");
  const [counterVenue, setCounterVenue] = useState("");
  const [counterResponseDeadline, setCounterResponseDeadline] = useState("");
  const [counterBookingDeadline, setCounterBookingDeadline] = useState("");
  const [counterMessage, setCounterMessage] = useState("");
  const [showCounter, setShowCounter] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleBookingId, setRescheduleBookingId] = useState(0);
  const [rescheduleResponseDeadline, setRescheduleResponseDeadline] = useState("");
  const [rescheduleMessage, setRescheduleMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [action, setAction] = useState<Action>(null);
  const [districts, setDistricts] = useState<ReferenceOption[]>([]);
  const [areasByDistrict, setAreasByDistrict] = useState<Record<string, ReferenceOption[]>>({});
  const [clock, setClock] = useState(() => Date.now());
  const captainTeams = useMemo(() => myTeams.filter((team) => team.is_captain), [myTeams]);

  useEffect(() => {
    if (!Number.isInteger(challengeId) || challengeId < 1) {
      setError("This team challenge could not be found.");
      setIsLoading(false);
      return;
    }
    void loadChallenge();
  }, [challengeId]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!Number.isInteger(challengeId) || challengeId < 1) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadChallenge();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [challengeId]);

  useEffect(() => {
    if (!challenge?.current_proposal) return;
    const proposal = challenge.current_proposal;
    setCounterDate(proposal.proposed_date || "");
    setCounterStart(shortTime(proposal.proposed_start_time));
    setCounterEnd(shortTime(proposal.proposed_end_time));
    setCounterDistrict(proposal.preferred_district || "");
    setCounterArea(proposal.preferred_area || "");
    setCounterVenue(proposal.preferred_venue_name || "");
    setCounterResponseDeadline(toDateTimeInput(new Date(proposal.response_deadline)));
    setCounterBookingDeadline(proposal.booking_deadline ? toDateTimeInput(new Date(proposal.booking_deadline)) : "");
    setCounterMessage(proposal.message || "");
  }, [challenge?.current_proposal]);

  async function loadChallenge() {
    setIsLoading(!challenge);
    setIsRefreshing(true);
    setError("");
    try {
      const response = await api.get<TeamChallengeResponse>(`/api/team-challenges/challenges/${challengeId}/`);
      setChallenge(response.data.challenge);
      if (user) {
        const [teamsResult, bookingsResult, referenceResult] = await Promise.allSettled([
          api.get<MyTeamsResponse>("/api/teams/my-teams/"),
          api.get<EligibleBookingsResponse>("/api/matchmaking/games/eligible-bookings/"),
          api.get<DiscoveryReferenceResponse>("/api/venues/discovery/reference/"),
        ]);
        if (teamsResult.status === "fulfilled") {
          const captainTeams = teamsResult.value.data.teams.filter((team) => team.is_captain);
          setMyTeams(captainTeams);
          if (!selectedTeamId && captainTeams.length) setSelectedTeamId(captainTeams[0].id);
        }
        if (bookingsResult.status === "fulfilled") setEligibleBookings(bookingsResult.value.data.bookings);
        if (referenceResult.status === "fulfilled") {
          const reference = referenceResult.value.data;
          setDistricts(reference.filters?.districts || reference.districts || []);
          setAreasByDistrict(reference.filters?.areas_by_district || reference.areas_by_district || {});
        }
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load this team challenge right now.", { notify: false }));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  async function runAction(kind: Exclude<Action, null>, url: string, body: Record<string, unknown>, successMessage: string) {
    if (action) return;
    setAction(kind);
    try {
      await api.post<TeamChallengeResponse>(url, body);
      emitToast({ message: successMessage, type: "success", dedupeKey: `team-challenge-${kind}-${challengeId}` });
      await loadChallenge();
      setShowCounter(false);
      setShowReschedule(false);
    } catch (requestError) {
      emitToast({
        message: getApiErrorMessage(requestError, "We could not update this team challenge. Please try again."),
        type: "error",
        dedupeKey: `team-challenge-${kind}-error-${challengeId}`,
      });
    } finally {
      setAction(null);
    }
  }

  function decide(decision: "ACCEPT" | "DECLINE") {
    if (decision === "DECLINE" && !window.confirm("Decline this team challenge?")) return;
    void runAction("decision", `/api/team-challenges/challenges/${challengeId}/decision/`, { action: decision }, decision === "ACCEPT" ? "The team challenge has been accepted." : "The team challenge has been declined.");
  }

  function reconfirm(decision: "ACCEPT" | "DECLINE") {
    if (decision === "DECLINE" && !window.confirm("Decline the updated team match schedule?")) return;
    void runAction(
      "reconfirm",
      `/api/team-challenges/challenges/${challengeId}/reconfirm/`,
      { action: decision },
      decision === "ACCEPT" ? "Your team has confirmed the updated match schedule." : "Your team cannot attend the updated match schedule.",
    );
  }

  function submitCounter() {
    if (action) return;
    if (!counterDate || !counterStart || !counterEnd || !counterDistrict || !counterArea || !counterResponseDeadline || !counterBookingDeadline) {
      emitToast({ message: "Add the proposed schedule, location and both deadlines.", type: "warning", dedupeKey: "challenge-counter-required" });
      return;
    }
    const startAt = localDateTime(counterDate, counterStart);
    const endAt = localDateTime(counterDate, counterEnd);
    const responseAt = parseLocalDateTimeInput(counterResponseDeadline);
    const bookingAt = parseLocalDateTimeInput(counterBookingDeadline);
    if (!startAt || !endAt || counterEnd <= counterStart) {
      emitToast({ message: "Choose an end time after the start time.", type: "warning", dedupeKey: "challenge-counter-time" });
      return;
    }
    if (startAt.getTime() <= Date.now()) {
      emitToast({ message: "Choose a future date and time for the match.", type: "warning", dedupeKey: "challenge-counter-past" });
      return;
    }
    if (!responseAt || responseAt.getTime() <= Date.now() || responseAt >= startAt) {
      emitToast({ message: "Set a future response deadline before the match starts.", type: "warning", dedupeKey: "challenge-counter-response-deadline" });
      return;
    }
    if (!bookingAt || bookingAt >= startAt) {
      emitToast({ message: "Set the court-booking deadline before the match starts.", type: "warning", dedupeKey: "challenge-counter-booking-deadline" });
      return;
    }
    if (bookingAt <= responseAt) {
      emitToast({ message: "The court-booking deadline must be after the response deadline.", type: "warning", dedupeKey: "challenge-counter-deadlines" });
      return;
    }
    void runAction("counter", `/api/team-challenges/challenges/${challengeId}/counter/`, {
      court_mode: "PLAN_FIRST",
      proposed_date: counterDate,
      proposed_start_time: counterStart,
      proposed_end_time: counterEnd,
      preferred_district: counterDistrict,
      preferred_area: counterArea,
      preferred_venue_name: counterVenue,
      players_per_side: challenge?.current_proposal.players_per_side || 6,
      intensity: challenge?.current_proposal.intensity || "CASUAL",
      message: counterMessage,
      response_deadline: responseAt.toISOString(),
      booking_deadline: bookingAt.toISOString(),
    }, "Your counter-proposal has been sent.");
  }

  if (isLoading && !challenge) return <ChallengeDetailSkeleton />;
  if (error || !challenge) return <ErrorState message={error || "This team challenge could not be found."} onRetry={() => void loadChallenge()} />;

  const proposal = challenge.current_proposal;
  const booking = challenge.booking_summary || proposal.booking_summary;
  const isOpen = challenge.is_open_for_opponent_response && new Date(challenge.response_deadline).getTime() > clock;
  const canRespond = challenge.permissions.can_respond && !challenge.my_open_response;
  const deadlineIsActive = challenge.is_open_for_response && new Date(challenge.response_deadline).getTime() > clock;
  const hasAvailableAction = challenge.permissions.can_accept || challenge.permissions.can_withdraw || challenge.permissions.can_cancel || challenge.permissions.can_counter || challenge.permissions.can_attach_booking || challenge.permissions.can_withdraw_response || challenge.permissions.can_reconfirm || challenge.permissions.can_reschedule;
  const dateText = booking?.start_at || (proposal.proposed_date && proposal.proposed_start_time ? localDateTimeToIso(proposal.proposed_date, proposal.proposed_start_time) : null);
  const placeText = booking ? `${booking.venue_name} · ${booking.court_name}` : [proposal.preferred_venue_name, proposal.preferred_area, proposal.preferred_district].filter(Boolean).join(" · ") || "Court details to be agreed";
  const counterAreaOptions = counterDistrict ? areasByDistrict[counterDistrict] || [] : [];
  return (
    <main className="min-h-[calc(100vh-68px)] bg-[var(--sport-canvas)] px-4 py-7 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <BackButton href="/challenge-teams" label="Back to challenges" />
          <div className="flex items-center gap-3"><span aria-live="polite" className="text-xs font-semibold text-slate-500">{isRefreshing ? "Updating..." : null}</span><span className="text-sm text-slate-500">Challenge #{challenge.id}</span></div>
        </div>

        <section className="sport-surface overflow-hidden">
          <div className="border-b border-slate-200 p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="sport-eyebrow">Team challenge</p>
                <h1 className="mt-2 text-2xl font-black tracking-tight text-sportNavy sm:text-3xl">{challenge.challenger_team.name} <span className="text-slate-400">vs</span> {challenge.challenged_team?.name || "Open opponent search"}</h1>
                <div className="mt-3 flex flex-wrap gap-2"><Badge tone="green">{challenge.status_label}</Badge><Badge tone={challenge.court_mode === "BOOKING_FIRST" ? "green" : "blue"}>{challenge.court_mode === "BOOKING_FIRST" ? "Verified SportSpot Booking" : "Planning - Court Not Booked Yet"}</Badge>{challenge.challenge_type === "OPEN" ? <Badge tone="slate">Open challenge</Badge> : null}</div>
              </div>
              <div className="text-right text-sm text-slate-500"><p>Respond by</p><p className="mt-1 font-bold text-sportNavy">{formatDate(challenge.response_deadline)}</p>{deadlineIsActive ? <p className="mt-1 font-semibold text-sportGreen">{relativeDeadline(challenge.response_deadline, clock)}</p> : null}</div>
            </div>
            <div className="mt-7 grid gap-4 sm:grid-cols-3"><Info label="When" value={formatDate(dateText)} /><Info label="Where" value={placeText} /><Info label="Format" value={`${proposal.players_per_side} a side · ${formatLabel(proposal.intensity)}`} /></div>
            {proposal.message ? <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-700">{proposal.message}</p> : null}
          </div>

          <div className="p-5 sm:p-7">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-6">
                <section><SectionTitle title="Proposal" description="The latest proposal is the version both captains are responding to." /><div className="mt-4 rounded-lg border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span className="font-bold text-sportNavy">Version {proposal.version}</span><span className="text-slate-500">Created by {proposal.created_by_team_name}</span></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><Decision label={challenge.challenger_team.name} value={proposal.challenger_decision} /><Decision label={challenge.challenged_team?.name || "Responding team"} value={proposal.challenged_decision} /></div>{proposal.booking_deadline ? <p className="mt-4 text-sm text-slate-600">Court booking deadline: <strong className="text-sportNavy">{formatDate(proposal.booking_deadline)}</strong></p> : null}</div></section>

                {isOpen && challenge.permissions.can_select_opponent ? <OpenResponses responses={challenge.open_responses} action={action} onSelect={(responseId) => void runAction("select", `/api/team-challenges/challenges/${challengeId}/select-opponent/`, { response_id: responseId }, "The opposing team has been selected.")} /> : null}

                {canRespond ? <section className="rounded-lg border border-green-200 bg-green-50/50 p-5"><SectionTitle title="Respond to this open challenge" description="Choose one of your captain-led teams before sending interest." /><select aria-label="Team responding to the challenge" className="sport-field mt-4 w-full" onChange={(event) => setSelectedTeamId(Number(event.target.value))} value={selectedTeamId}><option value={0}>Choose a team</option>{captainTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select><textarea className="sport-field mt-3 min-h-24 w-full" maxLength={500} onChange={(event) => setResponseMessage(event.target.value)} placeholder="Optional message to the host captain" value={responseMessage} /><button className="sport-primary-button mt-4" disabled={!selectedTeamId || action === "respond"} onClick={() => void runAction("respond", `/api/team-challenges/challenges/${challengeId}/open-response/`, { team_id: selectedTeamId, message: responseMessage }, "Your team has responded to the open challenge.")} type="button">{action === "respond" ? "Sending..." : "Respond to Challenge"}</button></section> : null}
                {challenge.my_open_response ? <section className="rounded-lg border border-slate-200 bg-slate-50 p-5"><SectionTitle title="Your team response" description={`Your response is ${challenge.my_open_response.status_label.toLowerCase()}.`} />{challenge.my_open_response.message ? <p className="mt-3 text-sm text-slate-600">{challenge.my_open_response.message}</p> : null}{challenge.permissions.can_withdraw_response ? <button className="sport-secondary-button mt-4 border-red-200 text-red-700 hover:bg-red-50" disabled={Boolean(action)} onClick={() => { if (window.confirm("Withdraw your team response?")) void runAction("withdraw-response", `/api/team-challenges/challenges/${challengeId}/open-response/withdraw/`, { response_id: challenge.my_open_response?.id }, "Your team response has been withdrawn."); }} type="button">Withdraw Response</button> : null}</section> : null}

                {challenge.status === "RECONFIRMATION_REQUIRED" && challenge.permissions.can_reconfirm ? <section className="rounded-lg border border-amber-200 bg-amber-50 p-5"><SectionTitle title="Confirm the updated schedule" description="The court or match time changed. Both team captains must respond before the deadline." /><p className="mt-3 text-sm font-semibold text-amber-900">Respond by {formatDate(challenge.reconfirmation_deadline || challenge.response_deadline)}. If your team cannot attend, the match will not remain scheduled.</p><div className="mt-4 flex flex-wrap gap-2"><button className="sport-primary-button" disabled={Boolean(action)} onClick={() => reconfirm("ACCEPT")} type="button">Confirm Schedule</button><button className="sport-secondary-button border-amber-300 text-amber-900 hover:bg-amber-100" disabled={Boolean(action)} onClick={() => reconfirm("DECLINE")} type="button">Cannot Attend</button></div></section> : null}

                {challenge.permissions.can_counter && !showCounter ? <button className="sport-secondary-button" onClick={() => setShowCounter(true)} type="button">Make a Counter-proposal</button> : null}
                {showCounter ? <CounterForm action={action} area={counterArea} areaOptions={counterAreaOptions} bookingDeadline={counterBookingDeadline} date={counterDate} district={counterDistrict} districts={districts} end={counterEnd} message={counterMessage} onArea={(value) => setCounterArea(value)} onBookingDeadline={setCounterBookingDeadline} onCancel={() => setShowCounter(false)} onDate={setCounterDate} onDistrict={(value) => { setCounterDistrict(value); setCounterArea(""); }} onEnd={setCounterEnd} onMessage={setCounterMessage} onResponseDeadline={setCounterResponseDeadline} onStart={setCounterStart} onSubmit={submitCounter} onVenue={setCounterVenue} responseDeadline={counterResponseDeadline} start={counterStart} venue={counterVenue} /> : null}
              </div>

              <aside className="space-y-4">
                <section className="rounded-lg border border-slate-200 bg-slate-50 p-5"><SectionTitle title="Actions" description="Only actions available to your role are shown." /><div className="mt-4 space-y-2">{challenge.permissions.can_accept ? <button className="sport-primary-button w-full" disabled={Boolean(action)} onClick={() => decide("ACCEPT")} type="button">{action === "decision" ? "Updating..." : "Accept Challenge"}</button> : null}{challenge.permissions.can_accept ? <button className="sport-secondary-button w-full border-red-200 text-red-700 hover:bg-red-50" disabled={Boolean(action)} onClick={() => decide("DECLINE")} type="button">Decline</button> : null}{challenge.permissions.can_withdraw ? <button className="sport-secondary-button w-full" disabled={Boolean(action)} onClick={() => { if (window.confirm("Withdraw this challenge?")) void runAction("withdraw", `/api/team-challenges/challenges/${challengeId}/withdraw/`, {}, "Your team challenge has been withdrawn."); }} type="button">Withdraw Challenge</button> : null}{challenge.permissions.can_cancel ? <button className="sport-secondary-button w-full border-red-200 text-red-700 hover:bg-red-50" disabled={Boolean(action)} onClick={() => { if (window.confirm("Cancel this team challenge? Any separate court booking remains managed through My Bookings.")) void runAction("cancel", `/api/team-challenges/challenges/${challengeId}/cancel/`, {}, "The team challenge has been cancelled."); }} type="button">Cancel Challenge</button> : null}{!hasAvailableAction ? <p className="rounded-lg bg-white px-3 py-3 text-sm leading-6 text-slate-600">{getActionHint(challenge, isOpen)}</p> : null}</div></section>
                {challenge.permissions.can_attach_booking ? <AttachBooking bookings={eligibleBookings} selectedBookingId={selectedBookingId} action={action} onChange={setSelectedBookingId} onAttach={() => { if (selectedBookingId) void runAction("attach", `/api/team-challenges/challenges/${challengeId}/attach-booking/`, { booking_id: selectedBookingId }, "The court booking is confirmed and the team match is scheduled."); }} /> : null}
                {challenge.permissions.can_reschedule && !showReschedule ? <button className="sport-secondary-button w-full" onClick={() => { setRescheduleResponseDeadline(toDateTimeInput(new Date(Date.now() + 2 * 60 * 60 * 1000))); setShowReschedule(true); }} type="button">Reschedule Match</button> : null}
                {showReschedule ? <RescheduleForm action={action} bookings={eligibleBookings} message={rescheduleMessage} onBookingChange={setRescheduleBookingId} onCancel={() => setShowReschedule(false)} onMessage={setRescheduleMessage} onResponseDeadline={setRescheduleResponseDeadline} onSubmit={() => { if (!rescheduleBookingId || !rescheduleResponseDeadline) { emitToast({ message: "Choose a new booking and response deadline.", type: "warning", dedupeKey: "challenge-reschedule-required" }); return; } void runAction("reschedule", `/api/team-challenges/challenges/${challengeId}/reschedule/`, { booking_id: rescheduleBookingId, response_deadline: new Date(rescheduleResponseDeadline).toISOString(), message: rescheduleMessage }, "The new schedule has been sent to both team captains for confirmation."); }} responseDeadline={rescheduleResponseDeadline} selectedBookingId={rescheduleBookingId} /> : null}
                {challenge.status === "ACCEPTED_AWAITING_BOOKING" ? <Link className="sport-primary-button w-full justify-center" href="/courts">Choose a Court</Link> : null}
                {challenge.permissions.can_view_room ? <Link className="sport-primary-button w-full justify-center" href={`/challenge-teams/${challengeId}/room`}>{challenge.fixture?.room_state === "PLANNING" ? "Open Planning Room" : challenge.fixture?.room_state === "RECONFIRMATION" ? "Review Schedule Change" : challenge.fixture?.room_state === "READ_ONLY" ? "View Match Record" : "Open Game Room"}</Link> : null}
                {challenge.fixture && !challenge.permissions.can_view_room && ["PLANNING", "RECONFIRMATION", "CONFIRMED", "IN_PROGRESS"].includes(challenge.fixture.room_state) ? <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold leading-6 text-green-900">The room is available to team captains and selected participants.</p> : null}
              </aside>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function OpenResponses({ responses, action, onSelect }: { responses: OpenChallengeResponse[]; action: Action; onSelect: (id: number) => void }) {
  return <section><SectionTitle title="Interested teams" description="Review the teams that responded before selecting one opponent." /><div className="mt-4 space-y-3">{responses.length ? responses.filter((response) => response.status === "PENDING").map((response) => <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between" key={response.id}><div className="min-w-0"><p className="font-bold text-sportNavy">{response.responding_team.name}</p><p className="mt-1 text-sm text-slate-500">{response.responding_team.location || "Location not added"} · {formatLabel(response.responding_team.skill_level)}</p>{response.message ? <p className="mt-2 text-sm text-slate-600">{response.message}</p> : null}</div><button className="sport-primary-button shrink-0" disabled={action === "select"} onClick={() => onSelect(response.id)} type="button">Select Team</button></div>) : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No teams have responded yet.</p>}</div></section>;
}

function CounterForm({ action, area, areaOptions, bookingDeadline, date, district, districts, end, message, onArea, onBookingDeadline, onCancel, onDate, onDistrict, onEnd, onMessage, onResponseDeadline, onStart, onSubmit, onVenue, responseDeadline, start, venue }: { action: Action; area: string; areaOptions: ReferenceOption[]; bookingDeadline: string; date: string; district: string; districts: ReferenceOption[]; end: string; message: string; onArea: (value: string) => void; onBookingDeadline: (value: string) => void; onCancel: () => void; onDate: (value: string) => void; onDistrict: (value: string) => void; onEnd: (value: string) => void; onMessage: (value: string) => void; onResponseDeadline: (value: string) => void; onStart: (value: string) => void; onSubmit: () => void; onVenue: (value: string) => void; responseDeadline: string; start: string; venue: string }) {
  const timeOptions = buildTimeOptions();
  return <section className="rounded-lg border border-blue-200 bg-blue-50/50 p-5"><SectionTitle title="Counter-proposal" description="The other captain will respond to this complete new plan." /><div className="mt-4 grid gap-3 sm:grid-cols-3"><label className="text-sm font-semibold text-sportNavy">Date<input className="sport-field mt-1 w-full" min={toLocalDate(new Date())} onChange={(event) => onDate(event.target.value)} type="date" value={date} /></label><label className="text-sm font-semibold text-sportNavy">Start<TimeSelect ariaLabel="Counter-proposal start time" className="sport-field mt-1 w-full" options={timeOptions.filter((time) => timeOptions.some((endTime) => endTime > time))} placeholder="Choose time" value={start} onChange={(value) => { onStart(value); if (end && value >= end) onEnd(""); }} /></label><label className="text-sm font-semibold text-sportNavy">End<TimeSelect ariaLabel="Counter-proposal end time" className="sport-field mt-1 w-full" disabled={!start} options={timeOptions.filter((time) => !start || time > start)} placeholder={start ? "Choose time" : "Choose start first"} value={end} onChange={onEnd} /></label></div><div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="text-sm font-semibold text-sportNavy">District<select className="sport-field mt-1 w-full" onChange={(event) => onDistrict(event.target.value)} value={district}><option value="">Choose district</option>{districts.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="text-sm font-semibold text-sportNavy">Area<select className="sport-field mt-1 w-full" disabled={!district} onChange={(event) => onArea(event.target.value)} value={area}><option value="">{district ? "Choose area" : "Choose district first"}</option>{areaOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="text-sm font-semibold text-sportNavy">Preferred venue <span className="font-normal text-slate-500">(optional)</span><input className="sport-field mt-1 w-full" maxLength={120} onChange={(event) => onVenue(event.target.value)} placeholder="Any suitable venue" value={venue} /></label></div><p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-sm leading-6 text-slate-700">Changing the location creates a new proposal. The other captain must accept the updated district and area before a matching booking can be attached.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><DeadlineField helper="When the other captain must decide" label="Response deadline" onChange={onResponseDeadline} options={timeOptions} value={responseDeadline} /><DeadlineField helper="When a paid court must be secured" label="Court-booking deadline" onChange={onBookingDeadline} options={timeOptions} value={bookingDeadline} /></div><textarea className="sport-field mt-3 min-h-24 w-full" maxLength={500} onChange={(event) => onMessage(event.target.value)} placeholder="Optional note" value={message} /><div className="mt-4 flex flex-wrap gap-2"><button className="sport-secondary-button" onClick={onCancel} type="button">Cancel</button><button className="sport-primary-button" disabled={action === "counter"} onClick={onSubmit} type="button">{action === "counter" ? "Sending..." : "Send Counter-proposal"}</button></div></section>;
}

function AttachBooking({ action, bookings, onAttach, onChange, selectedBookingId }: { action: Action; bookings: EligibleGameBooking[]; onAttach: () => void; onChange: (value: number) => void; selectedBookingId: number }) {
  return <section className="rounded-lg border border-green-200 bg-green-50/50 p-5"><SectionTitle title="Confirm the court" description="Both teams agreed. Attach your paid confirmed booking to schedule the match." /><select aria-label="Confirmed booking" className="sport-field mt-4 w-full" onChange={(event) => onChange(Number(event.target.value))} value={selectedBookingId}><option value={0}>Choose a confirmed booking</option>{bookings.map((booking) => <option key={booking.id} value={booking.id}>{booking.venue_name} - {booking.court_name} - {booking.booking_display_time}</option>)}</select>{bookings.length ? <button className="sport-primary-button mt-3 w-full justify-center" disabled={!selectedBookingId || action === "attach"} onClick={onAttach} type="button">{action === "attach" ? "Confirming..." : "Attach Booking"}</button> : <p className="mt-3 text-sm text-slate-600">No eligible paid confirmed bookings are available. Book a court first, then return here to confirm the match.</p>}</section>;
}

function RescheduleForm({ action, bookings, message, onBookingChange, onCancel, onMessage, onResponseDeadline, onSubmit, responseDeadline, selectedBookingId }: { action: Action; bookings: EligibleGameBooking[]; message: string; onBookingChange: (value: number) => void; onCancel: () => void; onMessage: (value: string) => void; onResponseDeadline: (value: string) => void; onSubmit: () => void; responseDeadline: string; selectedBookingId: number }) {
  const timeOptions = buildTimeOptions();
  return <section className="rounded-lg border border-amber-200 bg-amber-50/60 p-5"><SectionTitle title="Reschedule the match" description="Choose a different paid booking. Both captains must confirm the new schedule before the deadline." /><p className="mt-3 text-sm leading-6 text-amber-950">Your current court booking is not cancelled by this action. Handle it separately through your bookings.</p><label className="mt-4 block text-sm font-semibold text-sportNavy">New confirmed booking<select aria-label="New confirmed booking" className="sport-field mt-1 w-full" onChange={(event) => onBookingChange(Number(event.target.value))} value={selectedBookingId}><option value={0}>Choose a paid confirmed booking</option>{bookings.map((booking) => <option key={booking.id} value={booking.id}>{booking.venue_name} - {booking.court_name} - {booking.booking_display_time}</option>)}</select></label>{bookings.length ? <><DeadlineField helper="When both captains must confirm the change" label="Response deadline" onChange={onResponseDeadline} options={timeOptions} value={responseDeadline} /><textarea className="sport-field mt-3 min-h-20 w-full" maxLength={500} onChange={(event) => onMessage(event.target.value)} placeholder="Optional note about the schedule change" value={message} /><div className="mt-4 flex flex-wrap gap-2"><button className="sport-secondary-button" disabled={action === "reschedule"} onClick={onCancel} type="button">Cancel</button><button className="sport-primary-button" disabled={!selectedBookingId || !responseDeadline || action === "reschedule"} onClick={onSubmit} type="button">{action === "reschedule" ? "Sending..." : "Send for Confirmation"}</button></div></> : <p className="mt-3 text-sm text-slate-600">No other paid confirmed bookings are available. Book a new court first, then return here to propose the change.</p>}</section>;
}

function DeadlineField({ helper, label, onChange, options, value }: { helper: string; label: string; onChange: (value: string) => void; options: string[]; value: string }) {
  const [date, time] = splitLocalDateTime(value);
  return <fieldset className="min-w-0"><legend className="text-sm font-semibold text-sportNavy">{label}</legend><p className="mt-1 text-xs text-slate-500">{helper}</p><div className="mt-1 grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-2"><input aria-label={`${label} date`} className="sport-field min-w-0 w-full" min={toLocalDate(new Date())} onChange={(event) => onChange(joinLocalDateTime(event.target.value, time))} type="date" value={date} /><TimeSelect ariaLabel={`${label} time`} className="sport-field min-w-0 w-full" options={options} placeholder="Choose time" value={time} onChange={(nextTime) => onChange(joinLocalDateTime(date, nextTime))} /></div></fieldset>;
}

function ChallengeDetailSkeleton() { return <main className="min-h-screen bg-[var(--sport-canvas)] px-4 py-10 sm:px-6"><div className="mx-auto max-w-5xl animate-pulse space-y-5"><div className="h-5 w-40 rounded bg-white" /><div className="h-[620px] rounded-xl bg-white" /></div></main>; }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <main className="min-h-screen bg-[var(--sport-canvas)] px-4 py-10"><section className="sport-error-state mx-auto max-w-2xl text-center"><h1 className="text-xl font-bold text-red-950">We could not open this team challenge.</h1><p className="mt-2 text-sm text-red-800">{message}</p><div className="mt-5 flex flex-wrap justify-center gap-2"><button className="sport-primary-button min-h-10 bg-red-600 hover:bg-red-700" onClick={onRetry} type="button">Try again</button><Link className="sport-secondary-button min-h-10 border-red-200 text-red-800 hover:bg-red-50" href="/challenge-teams">Back to challenges</Link></div></section></main>; }
function Badge({ children, tone }: { children: string; tone: "blue" | "green" | "slate" }) { const classes = tone === "green" ? "border-green-200 bg-green-50 text-sportGreen" : tone === "blue" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600"; return <span className={`sport-status ${classes}`}>{children}</span>; }
function SectionTitle({ description, title }: { description: string; title: string }) { return <div><h2 className="text-lg font-black text-sportNavy">{title}</h2><p className="mt-1 text-sm text-slate-600">{description}</p></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-2 text-sm font-bold text-sportNavy">{value}</p></div>; }
function Decision({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-slate-50 p-3"><p className="truncate text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-sm font-bold text-sportNavy">{formatDecision(value)}</p></div>; }
function formatDecision(value: string) { return value === "ACCEPTED" ? "Accepted" : value === "DECLINED" ? "Declined" : "Awaiting response"; }
function formatLabel(value: string) { return value ? value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Not specified"; }
function formatDate(value: string | null) { if (!value) return "To be agreed"; const formatted = formatDateTimeInNepal(value, { dateStyle: "medium", timeStyle: "short" }); return formatted === "Not set" ? "To be agreed" : formatted; }
function relativeDeadline(value: string, referenceNow = Date.now()) { const delta = new Date(value).getTime() - referenceNow; if (delta <= 0) return "Deadline passed"; const hours = Math.floor(delta / 3600000); if (hours >= 24) return `Closes in ${Math.floor(hours / 24)}d`; if (hours) return `Closes in ${hours}h`; return `Closes in ${Math.max(1, Math.floor(delta / 60000))}m`; }
function getActionHint(challenge: TeamChallenge, isOpen: boolean) { if (isOpen && challenge.permissions.is_challenger && !challenge.challenged_team) return "Your challenge is live. Another team can respond until the deadline, then you can select one opponent."; if (challenge.status === "OPEN" && challenge.challenged_team && !challenge.permissions.is_captain) return "This challenge is waiting for the team captains to respond."; if (challenge.status === "ACCEPTED_AWAITING_BOOKING") return "Both team captains can attach a matching paid court booking."; if (challenge.status === "RECONFIRMATION_REQUIRED") return "Both team captains must confirm the updated match schedule before the deadline."; if (challenge.status === "CONFIRMED") return "This match is confirmed. The next updates will appear here as the match progresses."; return "There are no actions for your account at this stage."; }
function shortTime(value: string | null) { return value ? value.slice(0, 5) : ""; }
