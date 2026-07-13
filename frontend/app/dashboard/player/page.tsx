"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getCurrentUser } from "@/lib/auth";
import type { PlayerProfile, PlayerProfileResponse } from "@/types/playerProfile";
import type { User } from "@/types/auth";

const quickActions = [
  { label: "Find Game", href: "/find-game", description: "Browse open Cricksal player slots." },
  { label: "Book Court", href: "/courts", description: "Find available Cricksal courts." },
  { label: "Create Team", href: "/dashboard/player/teams", description: "Cricksal team setup starts in a later phase." },
  { label: "Challenge Team", href: "/challenge-teams", description: "Cricksal challenge flow starts in a later phase." },
];

export default function PlayerDashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setUser(getCurrentUser());
    loadProfile();
  }, []);

  async function loadProfile() {
    setIsLoading(true);
    setError("");

    try {
      const response = await api.get<PlayerProfileResponse>("/api/players/profile/");
      setProfile(response.data.profile);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load player profile."));
    } finally {
      setIsLoading(false);
    }
  }

  const isComplete = Boolean(profile?.is_profile_complete);
  const reliabilityText =
    profile && profile.completed_matches_count >= 3
      ? `${profile.reliability_score}/100`
      : "New Player / Provisional Reliability";

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-sportNavy p-6 text-white shadow-sm">
        <p className="text-sm font-black uppercase tracking-wide text-green-300">Overview</p>
        <h1 className="mt-2 text-3xl font-black">Welcome back{user?.full_name ? `, ${user.full_name}` : ""}</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Your sports identity powers matchmaking, team trust, and future Game Room coordination.
        </p>
      </section>

      {error ? <p className="rounded-md bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : null}

      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-slate-500">Loading player profile...</p>
        </div>
      ) : (
        <section className="grid gap-4 lg:grid-cols-[1.4fr_0.6fr]">
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-black uppercase tracking-wide text-sportGreen">
                  {isComplete ? "Profile Complete" : "Profile Incomplete"}
                </p>
                <h2 className="mt-2 text-2xl font-black text-sportNavy">
                  {isComplete ? "Edit your sports identity" : "Complete your sports identity"}
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  {isComplete
                    ? "Your key profile details are filled. Keep them updated as your game changes."
                    : "Add availability, playing style, and role preference to make your profile useful."}
                </p>
              </div>
              <Link
                className="rounded-md bg-sportGreen px-4 py-3 text-center text-sm font-black text-white hover:bg-green-700"
                href="/dashboard/player/profile"
              >
                {isComplete ? "Edit Profile" : "Complete Profile"}
              </Link>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard label="SportSpot ID" value={profile?.sportspot_id || "Not created yet"} />
              <StatCard label="Sport" value="Cricksal" />
              <StatCard label="Skill Level" value={formatChoice(profile?.skill_level)} />
              <StatCard label="Location" value={profile?.location || "Not set"} />
              <StatCard label="Preferred Cricksal Role" value={formatChoice(profile?.preferred_cricksal_role)} />
              <StatCard label="Completed Matches" value={profile?.completed_matches_count ?? 0} />
              <StatCard label="No-shows" value={profile?.no_show_count ?? 0} />
              <StatCard label="Average Rating" value={formatRating(profile?.average_rating)} />
              <StatCard label="Reliability" value={reliabilityText} wide />
            </div>
            {profile && profile.completed_matches_count < 3 ? (
              <p className="mt-4 rounded-md bg-green-50 p-3 text-sm font-semibold text-green-800">
                Reliability becomes meaningful after a few completed matches.
              </p>
            ) : null}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-black uppercase tracking-wide text-sportGreen">Profile Completion</p>
            <div className="mt-4 flex items-end gap-2">
              <span className="text-4xl font-black text-sportNavy">{profile?.profile_completion_percentage ?? 0}%</span>
              <span className="pb-1 text-sm font-semibold text-slate-500">complete</span>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-sportGreen"
                style={{ width: `${profile?.profile_completion_percentage ?? 0}%` }}
              />
            </div>
          </div>
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Link
          className="rounded-lg border border-green-200 bg-green-50 p-5 shadow-sm hover:border-sportGreen"
          href="/dashboard/player/profile"
        >
          <h3 className="font-black text-sportNavy">{isComplete ? "Edit Profile" : "Complete Profile"}</h3>
          <p className="mt-2 text-sm text-slate-600">Manage your sports identity.</p>
        </Link>
        {quickActions.map((action) => (
          <Link
            className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-green-200 hover:bg-green-50"
            href={action.href}
            key={action.label}
          >
            <h3 className="font-black text-sportNavy">{action.label}</h3>
            <p className="mt-2 text-sm text-slate-600">{action.description}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}

function StatCard({ label, value, wide = false }: { label: string; value: string | number; wide?: boolean }) {
  return (
    <div className={`rounded-md bg-slate-50 p-4 ${wide ? "sm:col-span-2" : ""}`}>
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 font-black text-sportNavy">{value}</p>
    </div>
  );
}

function formatChoice(value?: string) {
  if (!value) return "Not set";
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatRating(value?: string) {
  if (!value) return "0.00";
  return Number(value).toFixed(2);
}
