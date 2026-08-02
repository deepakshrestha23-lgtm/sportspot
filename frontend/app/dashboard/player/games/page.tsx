"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DashboardPageHeader } from "@/components/player-dashboard/DashboardPageHeader";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { emitToast } from "@/lib/toast";
import type { MyTeamsResponse, Team } from "@/types/team";

type GameTab = "upcoming" | "open" | "requests" | "challenges" | "completed";
type RequestView = "mine" | "captain";
type ChallengeView = "received" | "sent" | "countered" | "accepted" | "closed";

const tabs: { key: GameTab; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "open", label: "Open Games" },
  { key: "requests", label: "Join Requests" },
  { key: "challenges", label: "Challenges" },
  { key: "completed", label: "Completed" },
];

const challengeViews: { key: ChallengeView; label: string }[] = [
  { key: "received", label: "Received" },
  { key: "sent", label: "Sent" },
  { key: "countered", label: "Countered" },
  { key: "accepted", label: "Accepted" },
  { key: "closed", label: "Closed" },
];

export default function PlayerGamesPage() {
  const [activeTab, setActiveTab] = useState<GameTab>("upcoming");
  const [requestView, setRequestView] = useState<RequestView>("mine");
  const [challengeView, setChallengeView] = useState<ChallengeView>("received");
  const [teams, setTeams] = useState<Team[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadGameContext();
  }, []);

  async function loadGameContext() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<MyTeamsResponse>("/api/teams/my-teams/");
      setTeams(response.data.teams);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load your game activity right now. Please try again."));
    } finally {
      setIsLoading(false);
    }
  }

  const captainTeams = useMemo(() => teams.filter((team) => team.is_captain), [teams]);
  const memberTeams = teams.length - captainTeams.length;
  const canManageGames = captainTeams.length > 0;

  function handleUnavailableAction(action: string) {
    emitToast({
      message: `${action} will be available when games are opened for players.`,
      type: "info",
      dedupeKey: `games-action-${action}`,
    });
  }

  return (
    <div className="space-y-5">
      <DashboardPageHeader
        actions={
          canManageGames ? (
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-sportGreen px-5 text-sm font-black text-white shadow-sm transition hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-200"
              onClick={() => handleUnavailableAction("Open game creation")}
              type="button"
            >
              <PlusIcon /> Create Open Game
            </button>
          ) : null
        }
        eyebrow="Match activity"
        title="My Games"
        description="Track upcoming Cricksal games, open-game requests, team challenges, and completed match activity from one place."
      />

      {isLoading ? (
        <GamesSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={loadGameContext} />
      ) : (
        <>
          <section className="grid gap-3.5 md:grid-cols-3">
            <ContextCard
              icon={<ShieldIcon />}
              label="Captain Teams"
              value={captainTeams.length}
              helper={captainTeams.length > 0 ? "Can manage team games" : "Create or captain a team to manage games"}
              href="/dashboard/player/teams"
            />
            <ContextCard
              icon={<UsersIcon />}
              label="Member Teams"
              value={memberTeams}
              helper="Teams where you play as a member"
              href="/dashboard/player/teams"
            />
            <ContextCard
              icon={<CalendarIcon />}
              label="Active Teams"
              value={teams.length}
              helper="Teams connected to your game activity"
              href="/dashboard/player/teams"
            />
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 pt-4 sm:px-5 sm:pt-5">
              <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Game activity sections">
                {tabs.map((tab) => (
                  <TabButton
                    active={activeTab === tab.key}
                    key={tab.key}
                    label={tab.label}
                    onClick={() => setActiveTab(tab.key)}
                  />
                ))}
              </div>
            </div>

            <div className="p-4 sm:p-5">
              {activeTab === "upcoming" ? <UpcomingTab /> : null}
              {activeTab === "open" ? (
                <OpenGamesTab
                  captainTeams={captainTeams}
                  canManageGames={canManageGames}
                  onCreate={() => handleUnavailableAction("Open game creation")}
                />
              ) : null}
              {activeTab === "requests" ? (
                <JoinRequestsTab
                  canManageGames={canManageGames}
                  requestView={requestView}
                  setRequestView={setRequestView}
                />
              ) : null}
              {activeTab === "challenges" ? (
                <ChallengesTab
                  canManageGames={canManageGames}
                  challengeView={challengeView}
                  setChallengeView={setChallengeView}
                />
              ) : null}
              {activeTab === "completed" ? <CompletedTab /> : null}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function UpcomingTab() {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <EmptyPanel
        actionHref="/find-game"
        actionLabel="Find a Game"
        description="Confirmed games involving you or your teams will appear here with venue, court, time, status, and Game Room access when available."
        icon={<TrophyIcon />}
        title="You have no upcoming games."
      />
      <GuidanceCard
        title="How upcoming games appear"
        points={[
          "A game appears here only after it is confirmed.",
          "Game Room access is shown only for confirmed participants.",
          "Court bookings remain in My Bookings unless they are attached to a game.",
        ]}
      />
    </div>
  );
}

function OpenGamesTab({
  captainTeams,
  canManageGames,
  onCreate,
}: {
  captainTeams: Team[];
  canManageGames: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="space-y-4">
      {canManageGames ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-green-200 bg-green-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-black text-green-950">Create games for teams you captain</h2>
            <p className="mt-1 text-sm leading-6 text-green-800">
              {captainTeams.length === 1
                ? `${captainTeams[0].name} can host open games when the game workflow is available.`
                : `You captain ${captainTeams.length} teams that can host open games.`}
            </p>
          </div>
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-sportGreen px-4 text-sm font-black text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-200"
            onClick={onCreate}
            type="button"
          >
            Create Open Game
          </button>
        </div>
      ) : null}

      <EmptyPanel
        actionHref={canManageGames ? "/dashboard/player/teams" : "/dashboard/player/teams/create"}
        actionLabel={canManageGames ? "View Captain Teams" : "Create a Team"}
        description={
          canManageGames
            ? "Open games created by your captain teams will be listed here with requests, player needs, and management actions."
            : "You need to captain a team before creating open games for other players to join."
        }
        icon={<WhistleIcon />}
        title="You have not created any open games."
      />
    </div>
  );
}

function JoinRequestsTab({
  canManageGames,
  requestView,
  setRequestView,
}: {
  canManageGames: boolean;
  requestView: RequestView;
  setRequestView: (view: RequestView) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Join request views">
        <PillButton active={requestView === "mine"} label="My Requests" onClick={() => setRequestView("mine")} />
        {canManageGames ? (
          <PillButton active={requestView === "captain"} label="Requests to My Games" onClick={() => setRequestView("captain")} />
        ) : null}
      </div>

      {requestView === "captain" && canManageGames ? (
        <EmptyPanel
          description="Requests from players who want to join your open games will appear here with their SportSpot profile and reliability details."
          icon={<UsersIcon />}
          title="No players have requested to join your games."
        />
      ) : (
        <EmptyPanel
          actionHref="/find-game"
          actionLabel="Find a Game"
          description="Your requests to join open Cricksal games will appear here with pending, accepted, or declined status."
          icon={<SearchIcon />}
          title="You have no pending join requests."
        />
      )}
    </div>
  );
}

function ChallengesTab({
  canManageGames,
  challengeView,
  setChallengeView,
}: {
  canManageGames: boolean;
  challengeView: ChallengeView;
  setChallengeView: (view: ChallengeView) => void;
}) {
  const emptyCopy: Record<ChallengeView, { title: string; description: string }> = {
    received: {
      title: "You have no received challenges.",
      description: canManageGames
        ? "Challenges sent to teams you captain will appear here with accept, counter, or decline actions."
        : "Received team challenges are managed by captains of your teams.",
    },
    sent: {
      title: "You have no sent challenges.",
      description: "Challenges sent by your captain teams will appear here with their latest response status.",
    },
    countered: {
      title: "You have no counter-proposals.",
      description: "Countered challenges will appear here when a captain proposes a different time, venue, or court.",
    },
    accepted: {
      title: "You have no accepted challenges.",
      description: "Accepted challenges will appear here before they become confirmed games.",
    },
    closed: {
      title: "You have no closed challenges.",
      description: "Declined, cancelled, and expired challenges will appear here for reference.",
    },
  };

  const current = emptyCopy[challengeView];

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Challenge views">
        {challengeViews.map((view) => (
          <PillButton
            active={challengeView === view.key}
            key={view.key}
            label={view.label}
            onClick={() => setChallengeView(view.key)}
          />
        ))}
      </div>
      <EmptyPanel
        actionHref="/challenge-teams"
        actionLabel="Explore Teams"
        description={current.description}
        icon={<SwordsIcon />}
        title={current.title}
      />
    </div>
  );
}

function CompletedTab() {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <EmptyPanel
        actionHref="/dashboard/player/ratings"
        actionLabel="View Ratings"
        description="Completed games will appear here with result, attendance, and rating eligibility when match records are available."
        icon={<StarIcon />}
        title="You have no completed games yet."
      />
      <GuidanceCard
        title="Rating eligibility"
        points={[
          "Ratings are available only after a match is completed.",
          "Only participating players can rate.",
          "Already-rated or expired rating windows will not show a rating action.",
        ]}
      />
    </div>
  );
}

function ContextCard({
  helper,
  href,
  icon,
  label,
  value,
}: {
  helper: string;
  href: string;
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <Link
      className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-green-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-green-200"
      href={href}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-slate-600">{label}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-sportNavy">{value}</p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 text-sportGreen transition group-hover:bg-sportGreen group-hover:text-white">
          {icon}
        </span>
      </div>
      <p className="mt-3 text-sm leading-5 text-slate-500">{helper}</p>
    </Link>
  );
}

function EmptyPanel({
  actionHref,
  actionLabel,
  description,
  icon,
  title,
}: {
  actionHref?: string;
  actionLabel?: string;
  description: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-2xl border border-dashed border-green-300 bg-gradient-to-br from-green-50 to-white p-6 sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-sportGreen shadow-sm">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-black text-sportNavy">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
        </div>
        {actionHref && actionLabel ? (
          <Link
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-sportGreen px-5 text-sm font-black text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-200"
            href={actionHref}
          >
            {actionLabel}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function GuidanceCard({ points, title }: { points: string[]; title: string }) {
  return (
    <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-sportGreen">Good to know</p>
      <h2 className="mt-2 text-lg font-black text-sportNavy">{title}</h2>
      <ul className="mt-4 space-y-3">
        {points.map((point) => (
          <li className="flex gap-3 text-sm leading-6 text-slate-600" key={point}>
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sportGreen" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      aria-selected={active}
      className={`relative min-h-12 shrink-0 px-3 text-sm font-black transition focus:outline-none focus:ring-2 focus:ring-green-200 ${
        active ? "text-sportGreen" : "text-slate-600 hover:text-sportNavy"
      }`}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {label}
      {active ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-sportGreen" /> : null}
    </button>
  );
}

function PillButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      aria-pressed={active}
      className={`min-h-10 shrink-0 rounded-full border px-4 text-sm font-black transition focus:outline-none focus:ring-2 focus:ring-green-200 ${
        active
          ? "border-sportGreen bg-sportGreen text-white"
          : "border-slate-200 bg-white text-slate-600 hover:border-green-200 hover:text-sportGreen"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function GamesSkeleton() {
  return (
    <div className="space-y-5">
      <section className="grid gap-3.5 md:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div className="h-36 animate-pulse rounded-2xl bg-slate-100" key={item} />
        ))}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2, 3, 4].map((item) => (
            <div className="h-10 w-24 shrink-0 animate-pulse rounded-full bg-slate-100" key={item} />
          ))}
        </div>
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {[0, 1].map((item) => (
            <div className="h-56 animate-pulse rounded-2xl bg-slate-100" key={item} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="rounded-2xl border border-red-100 bg-red-50 p-6 shadow-sm">
      <p className="text-sm font-black uppercase tracking-wide text-red-600">Games unavailable</p>
      <h2 className="mt-2 text-2xl font-black text-red-950">We could not load your game activity.</h2>
      <p className="mt-2 max-w-xl text-sm font-semibold leading-6 text-red-700">{message}</p>
      <button
        className="mt-5 min-h-11 rounded-xl bg-red-600 px-5 text-sm font-black text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-200"
        onClick={onRetry}
        type="button"
      >
        Retry
      </button>
    </section>
  );
}

function PlusIcon() {
  return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" /></svg>;
}

function ShieldIcon() {
  return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.4 2.9 8.4 7 10 4.1-1.6 7-5.6 7-10V6l-7-3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" /></svg>;
}

function UsersIcon() {
  return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M16 11a4 4 0 1 0-8 0M4 20a6 6 0 0 1 12 0M18 8a3 3 0 0 1 0 6M19 20a5 5 0 0 0-3-4.6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
}

function CalendarIcon() {
  return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M7 3v4M17 3v4M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
}

function TrophyIcon() {
  return <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Zm10 2h3a3 3 0 0 1-3 3M7 6H4a3 3 0 0 0 3 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
}

function WhistleIcon() {
  return <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24"><path d="M5 10h8a4 4 0 0 1 0 8H9l-4-4v-4Zm12 1 3-3M18 14h3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
}

function SearchIcon() {
  return <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24"><path d="m21 21-4.3-4.3M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
}

function SwordsIcon() {
  return <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24"><path d="m14 7 3-3 3 3-3 3m0-6-5 5M4 20l6-6M4 4l16 16M8 16l-4 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
}

function StarIcon() {
  return <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
}

