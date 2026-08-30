"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DashboardPageHeader } from "@/components/player-dashboard/DashboardPageHeader";
import LoadingIndicator from "@/components/LoadingIndicator";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateTimeInNepal } from "@/lib/dates";
import { emitToast } from "@/lib/toast";
import type { JoinRequest, MatchmakingGame, MyGamesResponse, MyTeamMatch } from "@/types/matchmaking";

type Tab = "upcoming" | "hosted" | "requests" | "completed" | "cancelled";

const tabs: Array<{ key: Tab; label: string }> = [
  { key: "upcoming", label: "Upcoming" },
  { key: "hosted", label: "Hosting" },
  { key: "requests", label: "Join Requests" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

export default function PlayerGamesPage() {
  const [activeTab, setActiveTab] = useState<Tab>("upcoming");
  const [data, setData] = useState<MyGamesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const requestInFlight = useRef(false);

  const loadGames = useCallback(async (background = false) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    if (!background) {
      setIsLoading(true);
      setError("");
    }
    try {
      const response = await api.get<MyGamesResponse>("/api/matchmaking/games/my/");
      setData(response.data);
      setError("");
    } catch (requestError) {
      const message = getApiErrorMessage(requestError, "We could not load your game activity right now.", { notify: !background });
      if (!background) setError(message);
    } finally {
      requestInFlight.current = false;
      if (!background) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGames();
    const refreshInterval = window.setInterval(() => void loadGames(true), 60000);
    return () => window.clearInterval(refreshInterval);
  }, [loadGames]);

  const tabCounts = useMemo(() => {
    if (!data) return {} as Record<Tab, number>;
    return {
      upcoming: data.upcoming.length + (data.team_matches?.upcoming.length || 0),
      hosted: data.hosted.length,
      requests: data.requests.filter((item) => ["PENDING", "WAITLISTED", "INVITED"].includes(item.status)).length + data.incoming_requests.filter((item) => ["PENDING", "WAITLISTED", "INVITED"].includes(item.status)).length,
      completed: data.completed.length + (data.team_matches?.completed.length || 0),
      cancelled: data.cancelled.length + (data.team_matches?.cancelled.length || 0),
    };
  }, [data]);

  return (
    <div className="space-y-5">
      <DashboardPageHeader actions={<Link className="sport-primary-button" href="/dashboard/player/games/create">Create Game</Link>} eyebrow="Game activity" title="My Games" description="Track the games you host, join, and play, including Team Challenge fixtures." />
      {isLoading ? <GamesSkeleton /> : error ? <ErrorState message={error} onRetry={loadGames} /> : data ? (
        <section>
          <div className="border-b border-slate-200" role="tablist" aria-label="Game sections"><div className="flex gap-1 overflow-x-auto">{tabs.map((tab) => <button aria-selected={activeTab === tab.key} className={`relative min-h-11 shrink-0 px-3 text-sm font-bold transition ${activeTab === tab.key ? "text-sportGreen" : "text-slate-500 hover:text-sportNavy"}`} key={tab.key} onClick={() => setActiveTab(tab.key)} role="tab" type="button">{tab.label}{tabCounts[tab.key] ? <span className={`ml-2 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-black ${activeTab === tab.key ? "bg-green-50 text-sportGreen" : "bg-slate-100 text-slate-500"}`}>{tabCounts[tab.key]}</span> : null}{activeTab === tab.key ? <span className="absolute inset-x-2 bottom-0 h-0.5 bg-sportGreen" /> : null}</button>)}</div></div>
          <div className="pt-5">
            {activeTab === "upcoming" ? <UnifiedGameSection games={data.upcoming} teamMatches={data.team_matches?.upcoming || []} emptyTitle="You have no upcoming games." emptyAction="Find a Game" emptyHref="/find-game" /> : null}
            {activeTab === "hosted" ? <GameGrid games={data.hosted} emptyTitle="You have not created a game yet." emptyAction="Create Game" emptyHref="/dashboard/player/games/create" hostMode /> : null}
            {activeTab === "requests" ? <RequestsSection data={data} onRefresh={loadGames} /> : null}
            {activeTab === "completed" ? <UnifiedGameSection games={data.completed} teamMatches={data.team_matches?.completed || []} emptyTitle="You have no completed games yet." /> : null}
            {activeTab === "cancelled" ? <UnifiedGameSection games={data.cancelled} teamMatches={data.team_matches?.cancelled || []} emptyTitle="You have no cancelled games." /> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function GameGrid({ emptyAction, emptyHref, emptyTitle, games, hostMode = false }: { games: MatchmakingGame[]; emptyTitle: string; emptyAction?: string; emptyHref?: string; hostMode?: boolean }) {
  if (games.length === 0) return <EmptyState title={emptyTitle} action={emptyAction} href={emptyHref} />;
  return <div className="grid gap-3 xl:grid-cols-2">{games.map((game) => <GameActivityCard game={game} hostMode={hostMode} key={game.id} />)}</div>;
}

function GameActivityCard({ game, hostMode }: { game: MatchmakingGame; hostMode: boolean }) {
  const isHost = hostMode || game.user_state.is_host;
  const location = game.is_booking_verified ? [game.venue_name, game.court_name].filter(Boolean).join(" · ") : [game.preferred_area, game.preferred_district].filter(Boolean).join(", ") || "Location to be confirmed";
  const isActiveGame = ["RECRUITING", "FULL", "BOOKING_PENDING"].includes(game.status);
  const recruitmentCountdown = useCountdown(game.recruitment_deadline);
  const bookingCountdown = useCountdown(game.booking_deadline, "Booking deadline passed");
  return (
    <article className="group overflow-hidden rounded-lg border border-slate-200 bg-white transition-shadow hover:border-green-300 hover:shadow-[0_8px_24px_rgba(16,32,22,0.08)]">
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="text-[11px] font-black uppercase tracking-[0.14em] text-sportGreen">{game.game_type === "FILL_SQUAD" ? "Fill My Squad" : "Pickup game"}</span><Badge tone={game.is_booking_verified ? "green" : "blue"}>{game.is_booking_verified ? "Verified court" : "Planning"}</Badge></div><h2 className="mt-2 line-clamp-2 text-lg font-black leading-tight text-sportNavy">{game.title}</h2></div><StatusBadge status={game.status_label || game.status} /></div>
        <div className="mt-4 grid gap-3 border-y border-slate-100 py-3 text-sm sm:grid-cols-2"><GameMeta icon={<CalendarIcon />} label="When" value={game.start_at ? formatDateTimeInNepal(game.start_at, { weekday: "short", month: "short", day: "numeric" }) : "Date to be confirmed"} detail={game.booking_display_time} /><GameMeta icon={<MapPinIcon />} label="Where" value={location} detail={game.game_type === "FILL_SQUAD" && game.team_name ? game.team_name : `Hosted by ${game.host_name}`} /></div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500"><span className="text-sportNavy">{game.occupied_spots_count}/{game.total_capacity} players</span><span aria-hidden="true" className="text-slate-300">·</span><span>{game.available_spots} spots open</span>{game.waitlist_count ? <><span aria-hidden="true" className="text-slate-300">·</span><span>{game.waitlist_count} waitlisted</span></> : null}</div>
      </div>
      {game.requires_reconfirmation ? <div className="border-t border-amber-100 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800 sm:px-5">{game.user_state.requires_reconfirmation ? "The final booking changed. Confirm your spot before attending." : game.user_state.is_host ? `${game.registered_reconfirmation_pending_count} player response${game.registered_reconfirmation_pending_count === 1 ? "" : "s"} and ${game.guest_confirmation_pending_count} guest acknowledgement${game.guest_confirmation_pending_count === 1 ? "" : "s"} still pending.` : "The host is coordinating an updated game schedule."}</div> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5"><div className="min-w-0 text-xs font-bold text-slate-500">{isActiveGame && recruitmentCountdown ? <p className="flex items-center gap-1.5 truncate"><ClockIcon />{recruitmentCountdown}</p> : null}{isActiveGame && !game.is_booking_verified && bookingCountdown ? <p className="mt-1 truncate text-blue-700">Court booking: {bookingCountdown}</p> : null}</div><div className="flex flex-wrap gap-2"><Link className="sport-primary-button min-h-9 px-3 text-xs" href={isHost ? `/dashboard/player/games/${game.id}` : `/find-game/${game.id}`}>{isHost ? "Manage game" : "View game"}</Link>{game.user_state.room_access && game.user_state.room_access !== "NONE" ? <Link className="sport-secondary-button min-h-9 px-3 text-xs" href={`/dashboard/player/games/${game.id}/room`}>{roomLinkLabel(game)}</Link> : null}</div></div>
    </article>
  );
}

function GameMeta({ detail, icon, label, value }: { detail: string; icon: React.ReactNode; label: string; value: string }) {
  return <div className="flex min-w-0 gap-2"><span className="mt-0.5 shrink-0 text-slate-400">{icon}</span><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className="mt-0.5 truncate font-bold text-sportNavy">{value}</p><p className="truncate text-xs font-semibold text-slate-500">{detail}</p></div></div>;
}

function RequestsSection({ data, onRefresh }: { data: MyGamesResponse; onRefresh: () => void }) { return <div className="grid gap-5 xl:grid-cols-2"><RequestList title="My Requests" requests={data.requests} onRefresh={onRefresh} /><RequestList title="Requests to My Games" requests={data.incoming_requests} hostMode onRefresh={onRefresh} /></div>; }

function roomLinkLabel(game: MatchmakingGame) { if (game.user_state.room_access === "READ_ONLY") return "View Game Record"; if (game.user_state.room_access === "RECONFIRMATION") return "Review Schedule Change"; if (game.game_type === "FILL_SQUAD") return game.is_booking_verified ? "Squad Room" : "Squad Planning"; return game.is_booking_verified ? "Open Game Room" : "Planning Room"; }

function RequestList({ hostMode = false, onRefresh, requests, title }: { title: string; requests: JoinRequest[]; hostMode?: boolean; onRefresh: () => void }) {
  if (requests.length === 0) return <EmptyState title={hostMode ? "No players have requested to join your games." : "You have no join requests."} />;
  return <section className="sport-surface p-4"><h2 className="text-lg font-black text-sportNavy">{title}</h2><div className="mt-3 space-y-3">{requests.map((request) => <RequestCard hostMode={hostMode} key={request.id} onRefresh={onRefresh} request={request} />)}</div></section>;
}

function UnifiedGameSection({ emptyAction, emptyHref, emptyTitle, games, teamMatches }: { games: MatchmakingGame[]; teamMatches: MyTeamMatch[]; emptyTitle: string; emptyAction?: string; emptyHref?: string }) {
  if (games.length === 0 && teamMatches.length === 0) return <EmptyState title={emptyTitle} action={emptyAction} href={emptyHref} />;
  return (
    <div className="space-y-6">
      {games.length ? <section><h2 className="mb-3 text-lg font-black text-sportNavy">Pickup and squad games</h2><GameGrid games={games} emptyTitle={emptyTitle} /></section> : null}
      {teamMatches.length ? <section><div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><div><h2 className="text-lg font-black text-sportNavy">Team Challenge fixtures</h2><p className="mt-1 text-sm text-slate-500">Confirmed matches connected to your lineup or captain role.</p></div><Link className="text-sm font-black text-sportGreen hover:underline" href="/challenge-teams">View challenges</Link></div><TeamMatchGrid matches={teamMatches} /></section> : null}
    </div>
  );
}

function TeamMatchGrid({ matches }: { matches: MyTeamMatch[] }) {
  return <div className="grid gap-3 xl:grid-cols-2">{matches.map((match) => <TeamMatchCard key={match.id} match={match} />)}</div>;
}

function TeamMatchCard({ match }: { match: MyTeamMatch }) {
  const booking = match.booking_summary;
  const location = booking ? [booking.venue_name, booking.venue_area || booking.venue_city].filter(Boolean).join(" · ") : "Court details unavailable";
  const roomLabel = match.room_access === "READ_ONLY" ? "View Match Record" : match.room_access === "RECONFIRMATION" ? "Review Schedule Change" : match.room_access === "IN_PROGRESS" ? "Open Game Room" : "Open Game Room";
  const matchStatus = match.status_label || formatStatus(match.status);
  return (
    <article className="group overflow-hidden rounded-lg border border-slate-200 bg-white transition-shadow hover:border-green-300 hover:shadow-[0_8px_24px_rgba(16,32,22,0.08)]">
      <div className="p-4 pb-0 sm:p-5 sm:pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap gap-1.5"><Badge tone="green">Team Challenge</Badge><Badge tone={match.room_access === "RECONFIRMATION" ? "blue" : "green"}>Confirmed court</Badge></div>
        <StatusBadge status={matchStatus} />
      </div>
      <div className="mt-4 flex items-start gap-3 border-y border-slate-100 py-3">
        <div className="min-w-0 flex-1 text-center"><TeamMark name={match.team_name} photo={match.team_photo} /><p className="mt-2 truncate text-xs font-black text-sportNavy">{match.team_name}</p></div>
        <div className="flex shrink-0 items-center self-center text-xs font-black uppercase tracking-[0.14em] text-slate-400">vs</div>
        <div className="min-w-0 flex-1 text-center"><TeamMark name={match.opponent_team_name} photo={match.opponent_team_photo} /><p className="mt-2 truncate text-xs font-black text-sportNavy">{match.opponent_team_name}</p></div>
      </div>
      <div className="mt-4 grid gap-2 text-sm font-semibold text-slate-600 sm:grid-cols-2">
        <p>{booking?.court_name || "Court to be confirmed"}</p>
        <p>{booking?.start_at ? formatDate(booking.start_at) : "Date to be confirmed"}</p>
        <p>{booking ? formatTimeRange(booking.start_at, booking.end_at) : "Time to be confirmed"}</p>
        <p className="sm:col-span-2">{location}</p>
      </div>
      {match.room_access === "RECONFIRMATION" ? <p className="mt-4 border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">The match schedule changed. Review the proposal before you attend.</p> : null}
      {match.result ? <p className="mt-4 border-l-2 border-green-500 bg-green-50 px-3 py-2 text-xs font-bold text-green-800">Result: {match.result}</p> : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5">
        <Link className="sport-primary-button min-h-9 px-3 text-xs" href={`/challenge-teams/${match.challenge_id}`}>{match.is_captain ? "Manage match" : "View match"}</Link>
        {match.room_access !== "NONE" ? <Link className="sport-secondary-button min-h-9 px-3 text-xs" href={`/challenge-teams/${match.challenge_id}/room`}>{roomLabel}</Link> : null}
      </div>
    </article>
  );
}

function TeamMark({ name, photo }: { name: string; photo: string }) {
  return <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white text-xs font-black text-sportGreen">{photo ? <Image alt={`${name} team logo`} className="object-cover" fill sizes="44px" src={getMediaSrc(photo)} unoptimized /> : initials(name)}</div>;
}

function RequestCard({ hostMode, onRefresh, request }: { request: JoinRequest; hostMode: boolean; onRefresh: () => void }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  async function act(decision: string) {
    setIsSubmitting(true);
    try {
      if (hostMode) {
        await api.post(`/api/matchmaking/requests/${request.id}/decide/`, { decision });
        emitToast({ message: decision === "ACCEPT" ? "The player has been accepted." : decision === "WAITLIST" ? "The player has been waitlisted." : "The request has been declined.", type: "success", dedupeKey: `request-${request.id}-${decision}` });
      } else if (request.status === "INVITED") {
        await api.post(`/api/matchmaking/requests/${request.id}/respond-invitation/`, { response: decision });
        emitToast({ message: decision === "ACCEPT" ? "You have joined the game." : "The game invitation has been declined.", type: "success", dedupeKey: `request-${request.id}-invite-${decision}` });
      } else {
        await api.post(`/api/matchmaking/requests/${request.id}/withdraw/`);
        emitToast({ message: "Your request has been withdrawn.", type: "success", dedupeKey: `request-${request.id}-withdraw` });
      }
      onRefresh();
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not update this request."), type: "error", dedupeKey: `request-${request.id}-error` });
    } finally { setIsSubmitting(false); }
  }
  const isInvitation = request.status === "INVITED" && !hostMode;
  const canHostAct = hostMode && (request.status === "PENDING" || request.status === "WAITLISTED");
  const canWithdraw = !hostMode && (request.status === "PENDING" || request.status === "WAITLISTED");
  return <div className="rounded-xl bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-sportNavy">{hostMode ? request.player_name : request.game_title || `Game #${request.game}`}</p><p className="mt-1 text-sm font-semibold text-slate-600">{request.requested_role_label} - {isInvitation ? "invited" : formatStatus(request.status)}</p>{request.message ? <p className="mt-2 text-sm text-slate-600">{request.message}</p> : null}{hostMode ? <p className="mt-2 text-xs font-black text-sportGreen">{request.reliability_label || "New Player"}{request.average_rating ? ` - ${Number(request.average_rating).toFixed(1)}/5` : ""}</p> : null}</div><Badge>{isInvitation ? "invited" : formatStatus(request.status)}</Badge></div>{canHostAct || canWithdraw || isInvitation ? <div className="mt-3 flex flex-wrap gap-2">{canHostAct ? <><button className="rounded-lg bg-sportGreen px-3 py-2 text-xs font-black text-white disabled:opacity-60" disabled={isSubmitting} onClick={() => act("ACCEPT")} type="button">Accept</button><button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-60" disabled={isSubmitting} onClick={() => act("WAITLIST")} type="button">Waitlist</button><button className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-black text-red-600 disabled:opacity-60" disabled={isSubmitting} onClick={() => act("REJECT")} type="button">Decline</button></> : null}{canWithdraw ? <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-60" disabled={isSubmitting} onClick={() => act("WITHDRAW")} type="button">Withdraw</button> : null}{isInvitation ? <><button className="rounded-lg bg-sportGreen px-3 py-2 text-xs font-black text-white disabled:opacity-60" disabled={isSubmitting} onClick={() => act("ACCEPT")} type="button">Accept Invite</button><button className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-black text-red-600 disabled:opacity-60" disabled={isSubmitting} onClick={() => act("DECLINE")} type="button">Decline</button></> : null}</div> : null}</div>;
}

function EmptyState({ action, description, href, title }: { title: string; description?: string; action?: string; href?: string }) { return <section className="sport-empty-state border-green-200 bg-green-50"><h2 className="text-lg font-bold text-sportNavy">{title}</h2>{description ? <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">{description}</p> : null}{action && href ? <Link className="sport-primary-button mt-5" href={href}>{action}</Link> : null}</section>; }
function StatusBadge({ status }: { status: string }) { return <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black capitalize text-slate-600">{status.replace(/_/g, " ").toLowerCase()}</span>; }
function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "blue" }) { const classes = tone === "green" ? "border-green-200 bg-green-50 text-sportGreen" : tone === "blue" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600"; return <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${classes}`}>{children}</span>; }
function GamesSkeleton() { return <div className="sport-loading-inline-panel min-h-[20rem]"><LoadingIndicator label="Loading your games" /></div>; }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <section className="sport-error-state"><h2 className="text-lg font-bold text-red-950">We could not load your games.</h2><p className="mt-2 text-sm font-semibold text-red-700">{message}</p><button className="sport-primary-button mt-5 bg-red-600 hover:bg-red-700" onClick={onRetry} type="button">Retry</button></section>; }
function CalendarIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><rect height="15" rx="2" stroke="currentColor" strokeWidth="1.8" width="16" x="4" y="5" /><path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>; }
function MapPinIcon() { return <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.8" /></svg>; }
function ClockIcon() { return <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" /><path d="M12 7v5l3 2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>; }
function useCountdown(target: string | null, expiredLabel = "Recruitment closed") {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(id);
  }, []);
  if (!target || !now) return "";
  const ms = new Date(target).getTime() - now.getTime();
  if (ms <= 0) return expiredLabel;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return minutes <= 15 ? `Closing soon - ${minutes}m left` : `Closes in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `Closes in ${days}d ${hours % 24}h`;
  return `Closes in ${hours}h ${minutes % 60}m`;
}
function formatDate(value: string | null) { if (!value) return "Date to be confirmed"; return formatDateTimeInNepal(value, { dateStyle: "medium", timeStyle: "short" }); }
function formatTimeRange(start: string | null, end: string | null) { if (!start) return "Time to be confirmed"; const startLabel = formatDateTimeInNepal(start, { timeStyle: "short" }); const endLabel = end ? formatDateTimeInNepal(end, { timeStyle: "short" }) : ""; return endLabel ? `${startLabel} - ${endLabel}` : startLabel; }
function formatStatus(value: string) { return value.replace(/_/g, " ").toLowerCase(); }
function initials(value: string) { return value.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "TM"; }
function getMediaSrc(value: string) { if (!value) return ""; if (value.startsWith("blob:") || value.startsWith("http")) return value; const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"; return `${apiBaseUrl}${value}`; }
