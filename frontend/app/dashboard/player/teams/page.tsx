"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { MyTeamsResponse, Team } from "@/types/team";

export default function PlayerTeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadTeams();
  }, []);

  async function loadTeams() {
    setIsLoading(true);
    setError("");

    try {
      const response = await api.get<MyTeamsResponse>("/api/teams/my-teams/");
      setTeams(response.data.teams);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load your teams."));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-sportNavy p-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-wide text-green-300">Cricksal Teams</p>
            <h1 className="mt-2 text-3xl font-black">My Teams</h1>
            <p className="mt-3 max-w-2xl text-slate-300">
              Create and manage your Cricksal team identity, roster, and captain controls.
            </p>
          </div>
          <Link className="rounded-md bg-sportGreen px-4 py-3 text-center text-sm font-black text-white hover:bg-green-700" href="/dashboard/player/teams/create">
            Create Team
          </Link>
        </div>
      </section>


      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-slate-500">Loading teams...</p>
        </div>
      ) : teams.length === 0 ? (
        <section className="rounded-lg border border-dashed border-green-300 bg-green-50 p-8 text-center">
          <h2 className="text-2xl font-black text-sportNavy">You have not created or joined any team yet.</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-slate-600">
            Start a Cricksal team, add guest players, and keep the roster ready for future matches.
          </p>
          <Link className="mt-6 inline-flex rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" href="/dashboard/player/teams/create">
            Create Team
          </Link>
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((team) => (
            <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" key={team.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sportNavy text-sm font-black text-white">
                    {team.team_photo ? (
                      <Image alt={`${team.name} team photo`} className="object-cover" fill sizes="56px" src={getTeamPhotoSrc(team.team_photo)} unoptimized />
                    ) : (
                      getTeamInitials(team.name)
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-wide text-sportGreen">Cricksal Team</p>
                    <h2 className="mt-2 truncate text-xl font-black text-sportNavy">{team.name}</h2>
                  </div>
                </div>
                {team.is_captain ? (
                  <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-black text-sportGreen">Captain</span>
                ) : null}
              </div>

              <div className="mt-5 grid gap-3 text-sm">
                <TeamMeta label="Location" value={team.location} />
                <TeamMeta label="Skill Level" value={formatChoice(team.skill_level)} />
                <TeamMeta label="Captain" value={team.captain_name} />
                <TeamMeta label="Members" value={team.members_count} />
                <TeamMeta label="Reliability" value={`${team.team_reliability_score}/100`} />
                <TeamMeta label="Average Rating" value={formatRating(team.average_rating)} />
              </div>

              <Link className="mt-5 inline-flex w-full justify-center rounded-md border border-green-200 px-4 py-3 text-sm font-black text-sportGreen hover:bg-green-50" href={`/dashboard/player/teams/${team.id}`}>
                View Team
              </Link>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function TeamMeta({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md bg-slate-50 px-3 py-2">
      <span className="font-semibold text-slate-500">{label}</span>
      <span className="text-right font-black text-sportNavy">{value}</span>
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

function getTeamPhotoSrc(value: string) {
  if (!value) return "";
  if (value.startsWith("http")) return value;
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
  return `${apiBaseUrl}${value}`;
}

function getTeamInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}
