"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import type {
  PlayerNextActivity,
  PlayerPendingAction,
  PlayerRecentActivity,
} from "@/types/playerDashboard";

export function DashboardSummaryCard({
  href,
  icon,
  label,
  meta,
  value,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  meta: string;
  value: string | number;
}) {
  return (
    <Link
      className="group flex min-h-[118px] flex-col justify-between rounded-lg border border-green-100 bg-white p-4 shadow-sm outline-none transition hover:-translate-y-0.5 hover:border-green-300 hover:shadow-md focus-visible:ring-2 focus-visible:ring-sportGreen focus-visible:ring-offset-2"
      href={href}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        <span className="text-sportGreen transition group-hover:scale-105">{icon}</span>
      </div>
      <div>
        <p className="text-2xl font-black tracking-tight text-sportNavy sm:text-3xl">{value}</p>
        <p className="mt-1.5 text-xs font-semibold text-slate-500">{meta}</p>
      </div>
    </Link>
  );
}

export function QuickAction({
  description,
  href,
  icon,
  label,
  primary = false,
}: {
  description: string;
  href: string;
  icon: ReactNode;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      className={`group flex min-h-[78px] items-center gap-3 rounded-lg border p-3.5 shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-sportGreen focus-visible:ring-offset-2 ${
        primary
          ? "border-green-700 bg-sportGreen text-white hover:bg-green-700"
          : "border-slate-200 bg-white text-sportNavy hover:border-green-300 hover:bg-green-50"
      }`}
      href={href}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${primary ? "bg-white/15" : "bg-green-50 text-sportGreen"}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-black">{label}</span>
        <span className={`mt-0.5 block text-xs leading-5 ${primary ? "text-green-50" : "text-slate-500"}`}>{description}</span>
      </span>
    </Link>
  );
}

export function NextActivityCard({ activity }: { activity: PlayerNextActivity | null }) {
  if (!activity) {
    return (
      <section className="flex min-h-[250px] flex-col justify-center rounded-lg border border-dashed border-green-200 bg-white p-5 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-50 text-sportGreen">
          <CalendarIcon />
        </div>
        <h2 className="mt-3 text-lg font-black text-sportNavy">No upcoming activity yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">You have no upcoming games or confirmed court bookings.</p>
        <div className="mt-5 flex flex-col justify-center gap-2.5 sm:flex-row">
          <Link className="rounded-md bg-sportGreen px-4 py-2.5 text-sm font-black text-white hover:bg-green-700" href="/courts">Book a Court</Link>
          <Link className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-sportNavy hover:border-green-300 hover:text-sportGreen" href="/find-game">Find a Game</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-[255px] rounded-lg bg-sportGreen p-5 text-white shadow-sm sm:p-6">
      <div className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-black uppercase tracking-wide text-green-50">
        <SparkIcon /> Next Activity • {formatStatus(activity.status)}
      </div>
      <h2 className="mt-5 text-2xl font-black tracking-tight sm:text-4xl">{activity.title}</h2>
      <div className="mt-6 grid gap-4 text-green-50 sm:grid-cols-2">
        <ActivityMeta icon={<ClockIcon />} label="Time" value={`${formatDate(activity.start_at)} • ${activity.display_time}`} />
        <ActivityMeta icon={<LocationIcon />} label="Location" value={`${activity.venue_name} • ${activity.court_name}`} />
      </div>
      <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
        <Link className="rounded-md bg-white px-4 py-2.5 text-center text-sm font-black text-green-800 hover:bg-green-50" href={activity.action_url}>View Details</Link>
        {activity.game_room_url ? (
          <Link className="rounded-md border border-white/30 px-4 py-2.5 text-center text-sm font-black text-white hover:bg-white/10" href={activity.game_room_url}>Open Game Room</Link>
        ) : null}
      </div>
    </section>
  );
}

export function PendingActionsCard({ actions }: { actions: PlayerPendingAction[] }) {
  return (
    <section className="rounded-lg border border-green-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-black text-sportNavy">Pending Actions</h2>
        {actions.length > 0 ? <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-black text-red-600">{actions.length} new</span> : null}
      </div>
      {actions.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-600">
          No actions need your attention right now.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {actions.map((action) => (
            <article className="rounded-lg border border-green-100 bg-green-50/60 p-3.5" key={action.id}>
              <div className="flex gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 text-sportGreen">
                  {action.type === "TEAM_INVITATION" ? <UsersIcon /> : <MoneyIcon />}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-black text-sportNavy">{action.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{action.message}</p>
                  <Link className="mt-3 inline-flex rounded-md bg-sportGreen px-3.5 py-2 text-xs font-black text-white hover:bg-green-700" href={action.action_url}>Review</Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function RecentActivityList({ activities }: { activities: PlayerRecentActivity[] }) {
  return (
    <section className="overflow-hidden rounded-lg border border-green-100 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-green-100 px-4 py-3.5 sm:px-5">
        <h2 className="text-lg font-black text-sportNavy">Recent Activity</h2>
      </div>
      {activities.length === 0 ? (
        <div className="p-5 text-sm font-semibold text-slate-600">Recent booking, team, and game updates will appear here.</div>
      ) : (
        <div className="divide-y divide-green-100">
          {activities.map((activity) => (
            <Link
              className="flex flex-col gap-3 px-4 py-3 outline-none transition hover:bg-green-50/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sportGreen sm:flex-row sm:items-center sm:justify-between sm:px-5"
              href={activity.action_url || "/dashboard/player"}
              key={activity.id}
            >
              <div className="flex min-w-0 items-center gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                  {getActivityIcon(activity.category)}
                </span>
                <span className="min-w-0">
                  <span className="block font-black text-sportNavy">{activity.title}</span>
                  <span className="mt-1 block truncate text-sm text-slate-600">{activity.message}</span>
                </span>
              </div>
              <time className="shrink-0 text-sm font-semibold text-slate-500" dateTime={activity.created_at}>{relativeTime(activity.created_at)}</time>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function ActivityMeta({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-green-100">{icon}</span>
      <span>
        <span className="block text-sm font-semibold text-green-100">{label}</span>
        <span className="mt-1 block text-base font-black text-white">{value}</span>
      </span>
    </div>
  );
}

export function OverviewSkeleton() {
  return (
    <div className="space-y-5" aria-label="Loading player overview">
      <div className="h-24 animate-pulse rounded-lg bg-white" />
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <div className="h-[118px] animate-pulse rounded-lg bg-white" key={item} />)}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="h-[255px] animate-pulse rounded-lg bg-white" />
        <div className="h-[255px] animate-pulse rounded-lg bg-white" />
      </div>
      <div className="h-56 animate-pulse rounded-lg bg-white" />
    </div>
  );
}

export function OverviewIcon({ name }: { name: "teams" | "games" | "bookings" | "reliability" | "search" | "plus" | "challenge" }) {
  if (name === "teams") return <UsersIcon />;
  if (name === "games") return <BallIcon />;
  if (name === "bookings") return <CalendarIcon />;
  if (name === "reliability") return <TrendIcon />;
  if (name === "search") return <SearchIcon />;
  if (name === "plus") return <PlusIcon />;
  return <ChallengeIcon />;
}

function formatStatus(value: string) {
  return value.toLowerCase().replace(/_/g, " ");
}

function formatDate(value: string | null) {
  if (!value) return "Date pending";
  return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(new Date(value));
}

function relativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function getActivityIcon(category: string) {
  if (category === "BOOKINGS") return <MoneyIcon />;
  if (category === "TEAMS") return <UsersIcon />;
  if (category === "MATCHES") return <BallIcon />;
  return <SparkIcon />;
}

function UsersIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 2a5 5 0 0 1 5 5M3 20a5 5 0 0 1 10 0" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
function BallIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-18v18M4.5 7.5c2.5 2 5 3 7.5 3s5-1 7.5-3M4.5 16.5c2.5-2 5-3 7.5-3s5 1 7.5 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
function CalendarIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M7 3v3m10-3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
function TrendIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="m4 17 6-6 4 4 6-8m0 0v6m0-6h-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
function SearchIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
function PlusIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></svg>; }
function ChallengeIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Zm10 2h3a3 3 0 0 1-3 3M7 6H4a3 3 0 0 0 3 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
function ClockIcon() { return <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24"><path d="M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
function LocationIcon() { return <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24"><path d="M12 21s7-4.8 7-11a7 7 0 1 0-14 0c0 6.2 7 11 7 11Zm0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
function SparkIcon() { return <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24"><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm6 12 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
function MoneyIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M4 7h16v10H4V7Zm3 3h.01M17 14h.01M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
