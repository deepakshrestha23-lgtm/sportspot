"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { GameIntensity, GameListResponse, GameRole, GameType, MatchmakingGame } from "@/types/matchmaking";

const roles: Array<{ label: string; value: GameRole | "" }> = [
  { label: "Any role", value: "" },
  { label: "Batsman", value: "BATSMAN" },
  { label: "Bowler", value: "BOWLER" },
  { label: "All-rounder", value: "ALL_ROUNDER" },
  { label: "Wicketkeeper", value: "WICKETKEEPER" },
];

const bookingStates = [
  { label: "Any booking status", value: "" },
  { label: "Verified booking", value: "verified" },
  { label: "Planning", value: "planning" },
];

const gameTypes: Array<{ label: string; value: GameType | "" }> = [
  { label: "All game types", value: "" },
  { label: "Pickup Game", value: "PICKUP" },
  { label: "Fill My Squad", value: "FILL_SQUAD" },
];

const intensities: Array<{ label: string; value: GameIntensity | "" }> = [
  { label: "Any game mood", value: "" },
  { label: "Casual", value: "CASUAL" },
  { label: "Competitive", value: "COMPETITIVE" },
  { label: "Practice / Friendly", value: "PRACTICE" },
];

const skillLevels = [
  { label: "Any skill level", value: "" },
  { label: "Beginner and above", value: "BEGINNER" },
  { label: "Intermediate and above", value: "INTERMEDIATE" },
  { label: "Advanced", value: "ADVANCED" },
];

const timePeriods = [
  { label: "Any time", value: "" },
  { label: "Morning", value: "morning" },
  { label: "Afternoon", value: "afternoon" },
  { label: "Evening", value: "evening" },
];

const spotOptions = [
  { label: "Any number of spots", value: "" },
  { label: "At least 1 spot", value: "1" },
  { label: "At least 2 spots", value: "2" },
  { label: "At least 4 spots", value: "4" },
];

export default function FindGamePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-50 px-4 py-8"><div className="mx-auto h-72 max-w-7xl animate-pulse rounded-3xl bg-white" /></main>}>
      <FindGameContent />
    </Suspense>
  );
}

function FindGameContent() {
  const searchParams = useSearchParams();
  const [games, setGames] = useState<MatchmakingGame[]>([]);
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [bookingState, setBookingState] = useState(searchParams.get("booking_state") || "");
  const [gameType, setGameType] = useState(searchParams.get("game_type") || "");
  const [role, setRole] = useState(searchParams.get("role") || "");
  const [date, setDate] = useState(searchParams.get("date") || "");
  const [area, setArea] = useState(searchParams.get("area") || "");
  const [intensity, setIntensity] = useState(searchParams.get("intensity") || "");
  const [skill, setSkill] = useState(searchParams.get("skill") || "");
  const [timePeriod, setTimePeriod] = useState(searchParams.get("time_period") || "");
  const [minimumSpots, setMinimumSpots] = useState(searchParams.get("min_spots") || "");
  const [waitlistOnly, setWaitlistOnly] = useState(searchParams.get("waitlist") === "true");
  const [sort, setSort] = useState(searchParams.get("sort") || "soonest");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (bookingState) params.set("booking_state", bookingState);
    if (gameType) params.set("game_type", gameType);
    if (role) params.set("role", role);
    if (date) params.set("date", date);
    if (area.trim()) params.set("area", area.trim());
    if (intensity) params.set("intensity", intensity);
    if (skill) params.set("skill", skill);
    if (timePeriod) params.set("time_period", timePeriod);
    if (minimumSpots) params.set("min_spots", minimumSpots);
    if (waitlistOnly) params.set("waitlist", "true");
    if (sort) params.set("sort", sort);
    return params;
  }, [area, bookingState, date, gameType, intensity, minimumSpots, role, search, skill, timePeriod, waitlistOnly, sort]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadGames(query);
      const nextUrl = query.toString() ? `/find-game?${query.toString()}` : "/find-game";
      window.history.replaceState(null, "", nextUrl);
    }, 350);
    const refreshInterval = window.setInterval(() => loadGames(query), 60000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(refreshInterval);
    };
  }, [query]);

  useEffect(() => {
    const deadlineTimes = games
      .map((game) => game.recruitment_deadline)
      .filter((deadline): deadline is string => Boolean(deadline))
      .map((deadline) => new Date(deadline).getTime())
      .filter((timestamp) => Number.isFinite(timestamp) && timestamp > Date.now());
    if (deadlineTimes.length === 0) return;

    const nextDeadline = Math.min(...deadlineTimes);
    const timeout = window.setTimeout(() => loadGames(query), Math.max(nextDeadline - Date.now() + 250, 250));
    return () => window.clearTimeout(timeout);
  }, [games, query]);

  async function loadGames(params: URLSearchParams) {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<GameListResponse>(`/api/matchmaking/games/?${params.toString()}`);
      setGames(response.data.games);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load open games right now. Please try again."));
    } finally {
      setIsLoading(false);
    }
  }

  function clearFilters() {
    setSearch("");
    setBookingState("");
    setRole("");
    setGameType("");
    setDate("");
    setArea("");
    setIntensity("");
    setSkill("");
    setTimePeriod("");
    setMinimumSpots("");
    setWaitlistOnly(false);
  }

  const hasFilters = search || bookingState || gameType || role || date || area || intensity || skill || timePeriod || minimumSpots || waitlistOnly;

  return (
    <main className="min-h-screen bg-slate-50">
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sportGreen">Find Games</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-sportNavy sm:text-4xl">Find Cricksal games near you</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Join individual Pickup Games or help a permanent team Fill My Squad. Verified games already have a SportSpot booking; planning games recruit first and confirm the court later.
            </p>
          </div>
          <Link className="inline-flex min-h-11 items-center justify-center rounded-xl bg-sportGreen px-5 text-sm font-black text-white shadow-sm transition hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-200" href="/dashboard/player/games/create">Create Game</Link>
        </div>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_150px_160px_160px_170px_170px_150px]">
            <Field label="Search"><input className={inputClass} onChange={(event) => setSearch(event.target.value)} placeholder="Search game, host, venue or area" value={search} /></Field>
            <Field label="Area"><input className={inputClass} onChange={(event) => setArea(event.target.value)} placeholder="Any area" value={area} /></Field>
            <Select label="Game type" onChange={setGameType} options={gameTypes} value={gameType} />
            <Select label="Role" onChange={setRole} options={roles} value={role} />
            <Select label="Booking" onChange={setBookingState} options={bookingStates} value={bookingState} />
            <Select label="Mood" onChange={setIntensity} options={intensities} value={intensity} />
            <Select label="Skill" onChange={setSkill} options={skillLevels} value={skill} />
            <Select label="Time" onChange={setTimePeriod} options={timePeriods} value={timePeriod} />
            <Select label="Sort" onChange={setSort} options={[{ label: "Soonest", value: "soonest" }, { label: "Newest", value: "newest" }, { label: "Most spots", value: "spots" }]} value={sort} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[220px_220px_220px_auto] sm:items-end">
            <Field label="Date"><input className={inputClass} min={today()} onChange={(event) => setDate(event.target.value)} type="date" value={date} /></Field>
            <Select label="Open spots" onChange={setMinimumSpots} options={spotOptions} value={minimumSpots} />
            <label className="flex min-h-12 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-700"><input checked={waitlistOnly} className="h-4 w-4 accent-green-700" onChange={(event) => setWaitlistOnly(event.target.checked)} type="checkbox" /> Waitlist available</label>
            {hasFilters ? <button className="min-h-12 rounded-xl border border-slate-200 px-4 text-sm font-black text-sportGreen hover:bg-green-50" onClick={clearFilters} type="button">Clear filters</button> : null}
          </div>
        </section>

        <div className="mt-5 flex items-center justify-between">
          <p className="text-sm font-black text-slate-700">{isLoading ? "Loading games..." : `${games.length} game${games.length === 1 ? "" : "s"} found`}</p>
        </div>

        {isLoading ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((item) => <div className="h-80 animate-pulse rounded-2xl bg-white shadow-sm" key={item} />)}</div>
        ) : error ? (
          <StateCard title="Games unavailable" description={error} actionLabel="Retry" onAction={() => loadGames(query)} />
        ) : games.length === 0 ? (
          <StateCard title="No games match your filters." description="Try another date, role or area. You can also create your own game from a confirmed booking or start with a plan." actionLabel="Clear filters" onAction={clearFilters} />
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{games.map((game) => <GameCard game={game} key={game.id} />)}</div>
        )}
      </section>
    </main>
  );
}

function GameCard({ game }: { game: MatchmakingGame }) {
  const recruitmentCountdown = useCountdown(game.recruitment_deadline);
  const bookingCountdown = useCountdown(game.booking_deadline);
  const canJoin = !game.user_state.is_host && !game.user_state.is_participant && !game.user_state.request_status && game.status === "RECRUITING";
  const canWaitlist = !game.user_state.is_host && !game.user_state.is_participant && !game.user_state.request_status && game.status === "FULL" && game.waitlist_enabled;
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-green-200 hover:shadow-md">
      <div className="border-b border-slate-100 bg-gradient-to-br from-slate-900 to-slate-800 p-4 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-white">{game.game_type === "FILL_SQUAD" ? "Fill My Squad" : "Pickup Game"}</span>
            <h2 className="mt-3 line-clamp-2 text-xl font-black">{game.title}</h2>
          </div>
          <StatusBadge game={game} />
        </div>
        <p className="mt-3 text-sm font-semibold text-white/75">{formatDateTime(game.start_at)} - {game.booking_display_time}</p>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap gap-2">
          <Badge tone={game.is_booking_verified ? "green" : "blue"}>{game.is_booking_verified ? "Verified SportSpot Booking" : "Planning - Court Not Booked Yet"}</Badge>
          <Badge>{game.game_intensity_label}</Badge>
        </div>
        <div className="mt-4 space-y-2 text-sm font-semibold text-slate-600">
          <p className="font-black text-sportNavy">{game.venue_name}</p>
          <p>{game.is_booking_verified ? game.court_name : [game.preferred_area, game.preferred_district].filter(Boolean).join(", ")}</p>
          <p>{game.game_type === "FILL_SQUAD" && game.team_name ? `${game.team_name} captain: ${game.host_name}` : `Hosted by ${game.host_name}`}</p>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
          <MiniStat label="Players" value={`${game.occupied_spots_count}/${game.total_capacity}`} />
          <MiniStat label="Spots" value={game.available_spots} />
          <MiniStat label="Waitlist" value={game.waitlist_count} />
        </div>
        <div className="mt-4 min-h-16">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">Roles still needed</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {game.role_progress.filter((item) => item.available_count > 0).slice(0, 4).map((item) => <Badge key={item.role}>{item.role_label}: {item.filled_count}/{item.required_count}</Badge>)}
            {game.role_progress.every((item) => item.available_count === 0) ? <Badge tone="green">Roster target filled</Badge> : null}
          </div>
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs font-black text-slate-600">
          <p>{recruitmentCountdown || "Recruitment deadline not set"}</p>
          {!game.is_booking_verified && game.booking_deadline ? <p className="mt-1 text-blue-700">Court must be booked: {bookingCountdown}</p> : null}
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <p className="text-xs font-bold text-slate-500">{formatSkill(game.min_skill_level)}</p>
          <Link className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl bg-sportGreen px-4 text-sm font-black text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-200" href={`/find-game/${game.id}`}>{canJoin ? "Request to Join" : canWaitlist ? "Join Waitlist" : "View Details"}</Link>
        </div>
      </div>
    </article>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return <label className="block"><span className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</span><div className="mt-1">{children}</div></label>;
}

function Select({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }>; value: string }) {
  return <Field label={label}><select className={inputClass} onChange={(event) => onChange(event.target.value)} value={value}>{options.map((option) => <option key={option.value || option.label} value={option.value}>{option.label}</option>)}</select></Field>;
}

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "blue" }) {
  const classes = tone === "green" ? "border-green-200 bg-green-50 text-sportGreen" : tone === "blue" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600";
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${classes}`}>{children}</span>;
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-slate-50 p-2"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-black text-sportNavy">{value}</p></div>;
}

function StatusBadge({ game }: { game: MatchmakingGame }) {
  const label = game.status === "RECRUITING" ? "Recruiting" : game.status === "FULL" ? (game.waitlist_enabled ? "Waitlist open" : "Full") : game.status === "CLOSED" ? "Recruitment closed" : game.status_label;
  return <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-800">{label}</span>;
}

function StateCard({ actionLabel, description, onAction, title }: { actionLabel: string; description: string; onAction: () => void; title: string }) {
  return <section className="mt-4 rounded-2xl border border-dashed border-green-300 bg-white p-8 text-center shadow-sm"><h2 className="text-xl font-black text-sportNavy">{title}</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">{description}</p><button className="mt-5 rounded-xl bg-sportGreen px-5 py-3 text-sm font-black text-white" onClick={onAction} type="button">{actionLabel}</button></section>;
}

function useCountdown(target: string | null) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(id);
  }, []);
  if (!target || !now) return "";
  const ms = new Date(target).getTime() - now.getTime();
  if (ms <= 0) return "Recruitment closed";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return minutes <= 15 ? `Closing soon - ${minutes}m left` : `Closes in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `Closes in ${days}d ${hours % 24}h`;
  return `Closes in ${hours}h ${minutes % 60}m`;
}

function formatDateTime(value: string | null) {
  if (!value) return "Date to be confirmed";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatSkill(value: string) {
  if (value === "OPEN") return "Open to all skill levels";
  return `${value.charAt(0)}${value.slice(1).toLowerCase()}+`;
}

function today() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

const inputClass = "h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-sportNavy outline-none transition focus:border-sportGreen focus:ring-2 focus:ring-green-100";
