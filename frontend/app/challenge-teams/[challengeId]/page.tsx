"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getCurrentUser } from "@/lib/auth";
import { emitToast } from "@/lib/toast";
import type { EligibleBookingsResponse, EligibleGameBooking } from "@/types/matchmaking";
import type { MyTeamsResponse, Team } from "@/types/team";
import type { OpenChallengeResponse, TeamChallenge, TeamChallengeResponse } from "@/types/teamChallenge";

type Action = "decision" | "counter" | "respond" | "select" | "withdraw" | "attach" | "cancel" | null;

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
  const [counterResponseDeadline, setCounterResponseDeadline] = useState("");
  const [counterBookingDeadline, setCounterBookingDeadline] = useState("");
  const [counterMessage, setCounterMessage] = useState("");
  const [showCounter, setShowCounter] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [action, setAction] = useState<Action>(null);
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
        const [teamsResult, bookingsResult] = await Promise.allSettled([
          api.get<MyTeamsResponse>("/api/teams/my-teams/"),
          api.get<EligibleBookingsResponse>("/api/matchmaking/games/eligible-bookings/"),
        ]);
        if (teamsResult.status === "fulfilled") {
          const captainTeams = teamsResult.value.data.teams.filter((team) => team.is_captain);
          setMyTeams(captainTeams);
          if (!selectedTeamId && captainTeams.length) setSelectedTeamId(captainTeams[0].id);
        }
        if (bookingsResult.status === "fulfilled") setEligibleBookings(bookingsResult.value.data.bookings);
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
    } catch (requestError) {
      getApiErrorMessage(requestError, "We could not update this team challenge. Please try again.");
    } finally {
      setAction(null);
    }
  }

  function decide(decision: "ACCEPT" | "DECLINE") {
    if (decision === "DECLINE" && !window.confirm("Decline this team challenge?")) return;
    void runAction("decision", `/api/team-challenges/challenges/${challengeId}/decision/`, { action: decision }, decision === "ACCEPT" ? "The team challenge has been accepted." : "The team challenge has been declined.");
  }

  function submitCounter() {
    if (action) return;
    if (!counterDate || !counterStart || !counterEnd || !counterResponseDeadline || !counterBookingDeadline) {
      emitToast({ message: "Add the proposed schedule and both deadlines.", type: "warning", dedupeKey: "challenge-counter-required" });
      return;
    }
    if (counterEnd <= counterStart) {
      emitToast({ message: "Choose an end time after the start time.", type: "warning", dedupeKey: "challenge-counter-time" });
      return;
    }
    if (new Date(counterBookingDeadline) <= new Date(counterResponseDeadline)) {
      emitToast({ message: "The court-booking deadline must be after the response deadline.", type: "warning", dedupeKey: "challenge-counter-deadlines" });
      return;
    }
    void runAction("counter", `/api/team-challenges/challenges/${challengeId}/counter/`, {
      court_mode: "PLAN_FIRST",
      proposed_date: counterDate,
      proposed_start_time: counterStart,
      proposed_end_time: counterEnd,
      preferred_district: challenge?.current_proposal.preferred_district || "",
      preferred_area: challenge?.current_proposal.preferred_area || "",
      preferred_venue_name: challenge?.current_proposal.preferred_venue_name || "",
      players_per_side: challenge?.current_proposal.players_per_side || 6,
      intensity: challenge?.current_proposal.intensity || "CASUAL",
      message: counterMessage,
      response_deadline: new Date(counterResponseDeadline).toISOString(),
      booking_deadline: new Date(counterBookingDeadline).toISOString(),
    }, "Your counter-proposal has been sent.");
  }

  if (isLoading && !challenge) return <ChallengeDetailSkeleton />;
  if (error || !challenge) return <ErrorState message={error || "This team challenge could not be found."} onRetry={() => void loadChallenge()} />;

  const proposal = challenge.current_proposal;
  const booking = challenge.booking_summary || proposal.booking_summary;
  const isOpen = challenge.is_open_for_opponent_response && new Date(challenge.response_deadline).getTime() > clock;
  const canRespond = challenge.permissions.can_respond && !challenge.my_open_response;
  const deadlineIsActive = challenge.is_open_for_response && new Date(challenge.response_deadline).getTime() > clock;
  const hasAvailableAction = challenge.permissions.can_accept || challenge.permissions.can_withdraw || challenge.permissions.can_cancel;
  const dateText = booking?.start_at || (proposal.proposed_date ? `${proposal.proposed_date}T${proposal.proposed_start_time || "00:00:00"}` : null);
  const placeText = booking ? `${booking.venue_name} · ${booking.court_name}` : [proposal.preferred_venue_name, proposal.preferred_area, proposal.preferred_district].filter(Boolean).join(" · ") || "Court details to be agreed";
  return (
    <main className="min-h-[calc(100vh-68px)] bg-[var(--sport-canvas)] px-4 py-7 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link className="text-sm font-bold text-slate-500 hover:text-sportGreen" href="/challenge-teams">Back to Challenge Teams</Link>
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
                {challenge.my_open_response ? <section className="rounded-lg border border-slate-200 bg-slate-50 p-5"><SectionTitle title="Your team response" description={`Your response is ${challenge.my_open_response.status_label.toLowerCase()}.`} />{challenge.my_open_response.message ? <p className="mt-3 text-sm text-slate-600">{challenge.my_open_response.message}</p> : null}</section> : null}

                {challenge.permissions.can_counter && !showCounter ? <button className="sport-secondary-button" onClick={() => setShowCounter(true)} type="button">Make a Counter-proposal</button> : null}
                {showCounter ? <CounterForm action={action} date={counterDate} end={counterEnd} message={counterMessage} onCancel={() => setShowCounter(false)} onDate={setCounterDate} onEnd={setCounterEnd} onMessage={setCounterMessage} onResponseDeadline={setCounterResponseDeadline} onStart={setCounterStart} onSubmit={submitCounter} onBookingDeadline={setCounterBookingDeadline} responseDeadline={counterResponseDeadline} start={counterStart} bookingDeadline={counterBookingDeadline} /> : null}
              </div>

              <aside className="space-y-4">
                <section className="rounded-lg border border-slate-200 bg-slate-50 p-5"><SectionTitle title="Actions" description="Only actions available to your role are shown." /><div className="mt-4 space-y-2">{challenge.permissions.can_accept ? <button className="sport-primary-button w-full" disabled={Boolean(action)} onClick={() => decide("ACCEPT")} type="button">{action === "decision" ? "Updating..." : "Accept Challenge"}</button> : null}{challenge.permissions.can_accept ? <button className="sport-secondary-button w-full border-red-200 text-red-700 hover:bg-red-50" disabled={Boolean(action)} onClick={() => decide("DECLINE")} type="button">Decline</button> : null}{challenge.permissions.can_withdraw ? <button className="sport-secondary-button w-full" disabled={Boolean(action)} onClick={() => { if (window.confirm("Withdraw this challenge?")) void runAction("withdraw", `/api/team-challenges/challenges/${challengeId}/withdraw/`, {}, "Your team challenge has been withdrawn."); }} type="button">Withdraw Challenge</button> : null}{challenge.permissions.can_cancel ? <button className="sport-secondary-button w-full border-red-200 text-red-700 hover:bg-red-50" disabled={Boolean(action)} onClick={() => { if (window.confirm("Cancel this team challenge? Any separate court booking remains managed through My Bookings.")) void runAction("cancel", `/api/team-challenges/challenges/${challengeId}/cancel/`, {}, "The team challenge has been cancelled."); }} type="button">Cancel Challenge</button> : null}{!hasAvailableAction ? <p className="rounded-lg bg-white px-3 py-3 text-sm leading-6 text-slate-600">{getActionHint(challenge, isOpen)}</p> : null}</div></section>
                {challenge.permissions.can_attach_booking ? <AttachBooking bookings={eligibleBookings} selectedBookingId={selectedBookingId} action={action} onChange={setSelectedBookingId} onAttach={() => { if (selectedBookingId) void runAction("attach", `/api/team-challenges/challenges/${challengeId}/attach-booking/`, { booking_id: selectedBookingId }, "The court booking is confirmed and the team match is scheduled."); }} /> : null}
                {challenge.status === "ACCEPTED_AWAITING_BOOKING" ? <Link className="sport-primary-button w-full justify-center" href="/courts">Choose a Court</Link> : null}
                {challenge.status === "CONFIRMED" ? <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold leading-6 text-green-900">The match is scheduled. Coordination details will appear when the confirmed game room is available.</p> : null}
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

function CounterForm({ action, bookingDeadline, date, end, message, onBookingDeadline, onCancel, onDate, onEnd, onMessage, onResponseDeadline, onStart, onSubmit, responseDeadline, start }: { action: Action; bookingDeadline: string; date: string; end: string; message: string; onBookingDeadline: (value: string) => void; onCancel: () => void; onDate: (value: string) => void; onEnd: (value: string) => void; onMessage: (value: string) => void; onResponseDeadline: (value: string) => void; onStart: (value: string) => void; onSubmit: () => void; responseDeadline: string; start: string }) {
  return <section className="rounded-lg border border-blue-200 bg-blue-50/50 p-5"><SectionTitle title="Counter-proposal" description="The other captain will respond to this new schedule." /><div className="mt-4 grid gap-3 sm:grid-cols-3"><label className="text-sm font-semibold text-sportNavy">Date<input className="sport-field mt-1 w-full" min={toLocalDate(new Date())} onChange={(event) => onDate(event.target.value)} type="date" value={date} /></label><label className="text-sm font-semibold text-sportNavy">Start<input className="sport-field mt-1 w-full" onChange={(event) => onStart(event.target.value)} type="time" value={start} /></label><label className="text-sm font-semibold text-sportNavy">End<input className="sport-field mt-1 w-full" onChange={(event) => onEnd(event.target.value)} type="time" value={end} /></label></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold text-sportNavy">Response deadline<input className="sport-field mt-1 w-full" min={toDateTimeInput(new Date())} onChange={(event) => onResponseDeadline(event.target.value)} type="datetime-local" value={responseDeadline} /></label><label className="text-sm font-semibold text-sportNavy">Court-booking deadline<input className="sport-field mt-1 w-full" min={toDateTimeInput(new Date())} onChange={(event) => onBookingDeadline(event.target.value)} type="datetime-local" value={bookingDeadline} /></label></div><textarea className="sport-field mt-3 min-h-24 w-full" maxLength={500} onChange={(event) => onMessage(event.target.value)} placeholder="Optional note" value={message} /><div className="mt-4 flex flex-wrap gap-2"><button className="sport-secondary-button" onClick={onCancel} type="button">Cancel</button><button className="sport-primary-button" disabled={action === "counter"} onClick={onSubmit} type="button">{action === "counter" ? "Sending..." : "Send Counter-proposal"}</button></div></section>;
}

function AttachBooking({ action, bookings, onAttach, onChange, selectedBookingId }: { action: Action; bookings: EligibleGameBooking[]; onAttach: () => void; onChange: (value: number) => void; selectedBookingId: number }) {
  return <section className="rounded-lg border border-green-200 bg-green-50/50 p-5"><SectionTitle title="Confirm the court" description="Both teams agreed. Attach your paid confirmed booking to schedule the match." /><select aria-label="Confirmed booking" className="sport-field mt-4 w-full" onChange={(event) => onChange(Number(event.target.value))} value={selectedBookingId}><option value={0}>Choose a confirmed booking</option>{bookings.map((booking) => <option key={booking.id} value={booking.id}>{booking.venue_name} - {booking.court_name} - {booking.booking_display_time}</option>)}</select>{bookings.length ? <button className="sport-primary-button mt-3 w-full justify-center" disabled={!selectedBookingId || action === "attach"} onClick={onAttach} type="button">{action === "attach" ? "Confirming..." : "Attach Booking"}</button> : <p className="mt-3 text-sm text-slate-600">No eligible paid confirmed bookings are available. Book a court first, then return here to confirm the match.</p>}</section>;
}

function ChallengeDetailSkeleton() { return <main className="min-h-screen bg-[var(--sport-canvas)] px-4 py-10 sm:px-6"><div className="mx-auto max-w-5xl animate-pulse space-y-5"><div className="h-5 w-40 rounded bg-white" /><div className="h-[620px] rounded-xl bg-white" /></div></main>; }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <main className="min-h-screen bg-[var(--sport-canvas)] px-4 py-10"><section className="mx-auto max-w-2xl rounded-xl border border-red-200 bg-red-50 p-7 text-center"><h1 className="text-xl font-black text-red-950">We could not open this team challenge.</h1><p className="mt-2 text-sm text-red-800">{message}</p><div className="mt-5 flex flex-wrap justify-center gap-2"><button className="inline-flex min-h-10 rounded-md bg-red-600 px-4 py-2.5 text-sm font-bold text-white" onClick={onRetry} type="button">Try again</button><Link className="inline-flex min-h-10 items-center rounded-md border border-red-200 bg-white px-4 py-2.5 text-sm font-bold text-red-800" href="/challenge-teams">Back to challenges</Link></div></section></main>; }
function Badge({ children, tone }: { children: string; tone: "blue" | "green" | "slate" }) { const classes = tone === "green" ? "border-green-200 bg-green-50 text-sportGreen" : tone === "blue" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600"; return <span className={`sport-status ${classes}`}>{children}</span>; }
function SectionTitle({ description, title }: { description: string; title: string }) { return <div><h2 className="text-lg font-black text-sportNavy">{title}</h2><p className="mt-1 text-sm text-slate-600">{description}</p></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-2 text-sm font-bold text-sportNavy">{value}</p></div>; }
function Decision({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-slate-50 p-3"><p className="truncate text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-sm font-bold text-sportNavy">{formatDecision(value)}</p></div>; }
function formatDecision(value: string) { return value === "ACCEPTED" ? "Accepted" : value === "DECLINED" ? "Declined" : "Awaiting response"; }
function formatLabel(value: string) { return value ? value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Not specified"; }
function formatDate(value: string | null) { if (!value) return "To be agreed"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-NP", { dateStyle: "medium", timeStyle: "short" }).format(date); }
function relativeDeadline(value: string, referenceNow = Date.now()) { const delta = new Date(value).getTime() - referenceNow; if (delta <= 0) return "Deadline passed"; const hours = Math.floor(delta / 3600000); if (hours >= 24) return `Closes in ${Math.floor(hours / 24)}d`; if (hours) return `Closes in ${hours}h`; return `Closes in ${Math.max(1, Math.floor(delta / 60000))}m`; }
function getActionHint(challenge: TeamChallenge, isOpen: boolean) { if (isOpen && challenge.permissions.is_challenger && !challenge.challenged_team) return "Your challenge is live. Another team can respond until the deadline, then you can select one opponent."; if (challenge.status === "OPEN" && challenge.challenged_team && !challenge.permissions.is_captain) return "This challenge is waiting for the team captains to respond."; if (challenge.status === "ACCEPTED_AWAITING_BOOKING") return "Both teams have accepted. The challenge creator must attach a matching paid court booking."; if (challenge.status === "CONFIRMED") return "This match is confirmed. The next updates will appear here as the match progresses."; return "There are no actions for your account at this stage."; }
function shortTime(value: string | null) { return value ? value.slice(0, 5) : ""; }
function toDateTimeInput(date: Date) { if (Number.isNaN(date.getTime())) return ""; const pad = (value: number) => String(value).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function toLocalDate(date: Date) { const pad = (value: number) => String(value).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
