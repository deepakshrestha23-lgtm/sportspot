"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  DashboardSummaryCard,
  NextActivityCard,
  OverviewIcon,
  OverviewSkeleton,
  PendingActionsCard,
  QuickAction,
  RecentActivityList,
} from "@/components/player-dashboard/OverviewCards";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { PlayerDashboardOverviewResponse } from "@/types/playerDashboard";

const quickActions = [
  {
    label: "Find a Game",
    href: "/find-game",
    description: "Browse Cricksal games looking for players.",
    icon: <OverviewIcon name="search" />,
  },
  {
    label: "Book a Court",
    href: "/courts",
    description: "Find verified venues and available slots.",
    icon: <OverviewIcon name="bookings" />,
    primary: true,
  },
  {
    label: "Create a Team",
    href: "/dashboard/player/teams/create",
    description: "Start a Cricksal squad as captain.",
    icon: <OverviewIcon name="plus" />,
  },
  {
    label: "Challenge a Team",
    href: "/challenge-teams",
    description: "Find opponents for future matches.",
    icon: <OverviewIcon name="challenge" />,
  },
];

export default function PlayerDashboardPage() {
  const [overview, setOverview] = useState<PlayerDashboardOverviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadOverview();
  }, []);

  async function loadOverview() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<PlayerDashboardOverviewResponse>("/api/players/dashboard/overview/");
      setOverview(response.data);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load your dashboard right now."));
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) return <OverviewSkeleton />;

  if (error || !overview) {
    return (
      <section className="rounded-lg border border-red-100 bg-white p-6 shadow-sm">
        <p className="text-sm font-black uppercase tracking-wide text-red-600">Dashboard unavailable</p>
        <h1 className="mt-2 text-2xl font-black text-sportNavy">We could not load your dashboard.</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">{error || "Please try again in a moment."}</p>
        <button
          className="mt-5 rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700"
          onClick={loadOverview}
          type="button"
        >
          Retry
        </button>
      </section>
    );
  }

  const firstName = overview.player.full_name.split(" ").filter(Boolean)[0] || "Player";
  const reliabilityValue = overview.profile.exists
    ? overview.profile.completed_matches_count >= 3
      ? `${overview.profile.reliability_score}/100`
      : "New Player"
    : "Not set";
  const reliabilityMeta = overview.profile.exists
    ? overview.profile.reliability_label
    : "Complete your profile";

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-black uppercase tracking-wide text-sportGreen">Overview</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-sportNavy sm:text-3xl xl:text-4xl">
            Welcome back, {firstName}
          </h1>
          <p className="mt-2.5 max-w-2xl text-sm leading-6 text-slate-600">
            Keep your Cricksal teams, bookings, and match activity moving from one place.
          </p>
          {overview.player.sportspot_id ? (
            <p className="mt-1.5 text-xs font-semibold text-slate-500">SportSpot ID: {overview.player.sportspot_id}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-sportGreen px-4 py-2.5 text-sm font-black text-white shadow-sm hover:bg-green-700" href="/courts">
            <OverviewIcon name="plus" /> Book a Court
          </Link>
          <Link className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-sportNavy shadow-sm hover:border-green-300 hover:text-sportGreen" href="/find-game">
            <OverviewIcon name="search" /> Find a Game
          </Link>
        </div>
      </section>

      {!overview.profile.is_complete ? (
        <section className="rounded-lg border border-green-200 bg-green-50 p-3.5 shadow-sm sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div>
            <h2 className="font-black text-green-900">Complete your sports identity</h2>
            <p className="mt-1 text-xs leading-5 text-green-800">
              Your profile is {overview.profile.completion_percentage}% complete. Add the remaining details to improve team and game coordination.
            </p>
          </div>
          <Link className="mt-3 inline-flex rounded-md bg-sportGreen px-3.5 py-2 text-xs font-black text-white hover:bg-green-700 sm:mt-0" href="/dashboard/player/profile">
            Complete Profile
          </Link>
        </section>
      ) : null}

      <section className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardSummaryCard
          href="/dashboard/player/teams"
          icon={<OverviewIcon name="teams" />}
          label="My Teams"
          meta="Active Cricksal teams"
          value={overview.summary.team_count}
        />
        <DashboardSummaryCard
          href="/dashboard/player/games"
          icon={<OverviewIcon name="games" />}
          label="Upcoming Games"
          meta="Confirmed game rooms"
          value={overview.summary.upcoming_game_count}
        />
        <DashboardSummaryCard
          href="/dashboard/player/bookings"
          icon={<OverviewIcon name="bookings" />}
          label="Upcoming Bookings"
          meta={overview.summary.pending_payment_count > 0 ? `${overview.summary.pending_payment_count} awaiting payment` : "Confirmed court bookings"}
          value={overview.summary.upcoming_booking_count}
        />
        <DashboardSummaryCard
          href="/dashboard/player/ratings"
          icon={<OverviewIcon name="reliability" />}
          label="Reliability Score"
          meta={reliabilityMeta}
          value={reliabilityValue}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <NextActivityCard activity={overview.next_activity} />
        <PendingActionsCard actions={overview.pending_actions} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.72fr)_minmax(270px,0.28fr)]">
        <RecentActivityList activities={overview.recent_activity} />
        <section className="sport-card p-4">
          <h2 className="text-lg font-black text-sportNavy">Quick Actions</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {quickActions.map((action) => (
              <QuickAction
                description={action.description}
                href={action.href}
                icon={action.icon}
                key={action.label}
                label={action.label}
                primary={action.primary}
              />
            ))}
          </div>
        </section>
      </section>
    </div>
  );
}
