"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DashboardPageHeader } from "@/components/player-dashboard/DashboardPageHeader";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { emitToast } from "@/lib/toast";
import type { JoinRequest, MatchmakingGame, MyGamesResponse } from "@/types/matchmaking";

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

  useEffect(() => { loadGames(); }, []);

  async function loadGames() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<MyGamesResponse>("/api/matchmaking/games/my/");
      setData(response.data);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load your game activity right now."));
    } finally {
      setIsLoading(false);
    }
  }

  const tabCounts = useMemo(() => {
    if (!data) return {} as Record<Tab, number>;
    return {
      upcoming: data.upcoming.length,
      hosted: data.hosted.length,
      requests: data.requests.filter((item) => ["PENDING", "WAITLISTED", "INVITED"].includes(item.status)).length + data.incoming_requests.filter((item) => ["PENDING", "WAITLISTED", "INVITED"].includes(item.status)).length,
      completed: data.completed.length,
      cancelled: data.cancelled.length,
    };
  }, [data]);

  return (
    <div className="space-y-5">
      <DashboardPageHeader actions={<Link className="inline-flex min-h-11 items-center justify-center rounded-xl bg-sportGreen px-5 text-sm font-black text-white shadow-sm hover:bg-green-700" href="/dashboard/player/games/create">Create Game</Link>} eyebrow="Find Games" title="My Games" description="Manage Pickup Games, Fill My Squad listings, requests and game rooms." />
      {isLoading ? <GamesSkeleton /> : error ? <ErrorState message={error} onRetry={loadGames} /> : data ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 pt-4 sm:px-5"><div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Game sections">{tabs.map((tab) => <button aria-selected={activeTab === tab.key} className={`relative min-h-12 shrink-0 px-3 text-sm font-black transition ${activeTab === tab.key ? "text-sportGreen" : "text-slate-600 hover:text-sportNavy"}`} key={tab.key} onClick={() => setActiveTab(tab.key)} role="tab" type="button">{tab.label}{tabCounts[tab.key] ? <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-xs text-sportGreen">{tabCounts[tab.key]}</span> : null}{activeTab === tab.key ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-sportGreen" /> : null}</button>)}</div></div>
          <div className="p-4 sm:p-5">
            {activeTab === "upcoming" ? <GameGrid games={data.upcoming} emptyTitle="You have no upcoming games." emptyAction="Find a Game" emptyHref="/find-game" /> : null}
            {activeTab === "hosted" ? <GameGrid games={data.hosted} emptyTitle="You have not created a game yet." emptyAction="Create Game" emptyHref="/dashboard/player/games/create" hostMode /> : null}
            {activeTab === "requests" ? <RequestsSection data={data} onRefresh={loadGames} /> : null}
            {activeTab === "completed" ? <GameGrid games={data.completed} emptyTitle="You have no completed games yet." /> : null}
            {activeTab === "cancelled" ? <GameGrid games={data.cancelled} emptyTitle="You have no cancelled games." /> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function GameGrid({ emptyAction, emptyHref, emptyTitle, games, hostMode = false }: { games: MatchmakingGame[]; emptyTitle: string; emptyAction?: string; emptyHref?: string; hostMode?: boolean }) {
  if (games.length === 0) return <EmptyState title={emptyTitle} action={emptyAction} href={emptyHref} />;
  return <div className="grid gap-4 lg:grid-cols-2">{games.map((game) => <GameActivityCard game={game} hostMode={hostMode} key={game.id} />)}</div>;
}

function GameActivityCard({ game, hostMode }: { game: MatchmakingGame; hostMode: boolean }) {
  const isHost = hostMode || game.user_state.is_host;
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div><div className="flex flex-wrap gap-2"><Badge tone="green">{game.game_type === "FILL_SQUAD" ? "Fill My Squad" : "Pickup"}</Badge><Badge tone={game.is_booking_verified ? "green" : "blue"}>{game.is_booking_verified ? "Verified Booking" : "Planning"}</Badge></div><h2 className="mt-3 text-xl font-black text-sportNavy">{game.title}</h2></div>
        <StatusBadge status={game.status_label || game.status} />
      </div>
      <div className="mt-4 grid gap-2 text-sm font-semibold text-slate-600 sm:grid-cols-2"><p>{game.venue_name}</p><p>{game.is_booking_verified ? game.court_name : game.preferred_area}</p><p>{formatDate(game.start_at)}</p><p>{game.booking_display_time}</p></div>
      <div className="mt-4 flex flex-wrap gap-2"><span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-black text-slate-600">{game.occupied_spots_count}/{game.total_capacity} occupied</span><span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-black text-slate-600">{game.available_spots} spots left</span>{game.waitlist_count ? <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">{game.waitlist_count} waitlisted</span> : null}</div>
      {game.user_state.requires_reconfirmation ? <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">Your spot needs reconfirmation.</p> : null}
      <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4"><Link className="rounded-xl bg-sportGreen px-4 py-2.5 text-sm font-black text-white" href={isHost ? `/dashboard/player/games/${game.id}` : `/find-game/${game.id}`}>{isHost ? "Manage Game" : "View Game"}</Link>{game.user_state.is_participant || game.user_state.is_host ? <Link className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-700" href={`/dashboard/player/games/${game.id}/room`}>{game.game_type === "FILL_SQUAD" ? (game.is_booking_verified ? "Squad Room" : "Squad Planning") : (game.is_booking_verified ? "Open Game Room" : "Planning Room")}</Link> : null}</div>
    </article>
  );
}

function RequestsSection({ data, onRefresh }: { data: MyGamesResponse; onRefresh: () => void }) { return <div className="grid gap-5 xl:grid-cols-2"><RequestList title="My Requests" requests={data.requests} onRefresh={onRefresh} /><RequestList title="Requests to My Games" requests={data.incoming_requests} hostMode onRefresh={onRefresh} /></div>; }

function RequestList({ hostMode = false, onRefresh, requests, title }: { title: string; requests: JoinRequest[]; hostMode?: boolean; onRefresh: () => void }) {
  if (requests.length === 0) return <EmptyState title={hostMode ? "No players have requested to join your games." : "You have no join requests."} />;
  return <section className="rounded-2xl border border-slate-200 p-4"><h2 className="text-lg font-black text-sportNavy">{title}</h2><div className="mt-3 space-y-3">{requests.map((request) => <RequestCard hostMode={hostMode} key={request.id} onRefresh={onRefresh} request={request} />)}</div></section>;
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

function EmptyState({ action, description, href, title }: { title: string; description?: string; action?: string; href?: string }) { return <section className="rounded-2xl border border-dashed border-green-300 bg-green-50 p-8 text-center"><h2 className="text-xl font-black text-sportNavy">{title}</h2>{description ? <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">{description}</p> : null}{action && href ? <Link className="mt-5 inline-flex rounded-xl bg-sportGreen px-5 py-3 text-sm font-black text-white" href={href}>{action}</Link> : null}</section>; }
function StatusBadge({ status }: { status: string }) { return <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black capitalize text-slate-600">{status.replace(/_/g, " ").toLowerCase()}</span>; }
function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "blue" }) { const classes = tone === "green" ? "border-green-200 bg-green-50 text-sportGreen" : tone === "blue" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600"; return <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${classes}`}>{children}</span>; }
function GamesSkeleton() { return <div className="space-y-4"><div className="h-14 animate-pulse rounded-2xl bg-white" /><div className="grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map((item) => <div className="h-56 animate-pulse rounded-2xl bg-white" key={item} />)}</div></div>; }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <section className="rounded-2xl border border-red-100 bg-red-50 p-6"><h2 className="text-xl font-black text-red-950">We could not load your games.</h2><p className="mt-2 text-sm font-semibold text-red-700">{message}</p><button className="mt-5 rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white" onClick={onRetry} type="button">Retry</button></section>; }
function formatDate(value: string | null) { if (!value) return "Date to be confirmed"; return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function formatStatus(value: string) { return value.replace(/_/g, " ").toLowerCase(); }
