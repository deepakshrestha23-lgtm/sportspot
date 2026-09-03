"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getCurrentUser } from "@/lib/auth";
import { formatDateTimeInNepal } from "@/lib/dates";
import LoadingIndicator, { LoadingScreen } from "@/components/LoadingIndicator";
import type { User } from "@/types/auth";
import type { GameIntensity, GameListResponse, GameRecommendationMeta, GameRole, GameType, MatchmakingGame } from "@/types/matchmaking";

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
    <Suspense fallback={<main className="min-h-screen bg-[var(--sport-canvas)] px-4 py-8"><LoadingScreen label="Loading games" /></main>}>
      <FindGameContent />
    </Suspense>
  );
}

function FindGameContent() {
  const searchParams = useSearchParams();
  const [games, setGames] = useState<MatchmakingGame[]>([]);
  const [viewer, setViewer] = useState<User | null>(null);
  const [recommendationMeta, setRecommendationMeta] = useState<GameRecommendationMeta | null>(null);
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
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const isFirstQueryRef = useRef(true);

  useEffect(() => { setViewer(getCurrentUser()); }, []);

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
      isFirstQueryRef.current = false;
      void loadGames(query);
      const nextUrl = query.toString() ? `/find-game?${query.toString()}` : "/find-game";
      window.history.replaceState(null, "", nextUrl);
    }, isFirstQueryRef.current ? 0 : 250);
    const refreshInterval = window.setInterval(() => void loadGames(query, true), 60000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(refreshInterval);
      requestRef.current?.abort();
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
    const timeout = window.setTimeout(() => void loadGames(query, true), Math.max(nextDeadline - Date.now() + 250, 250));
    return () => window.clearTimeout(timeout);
  }, [games, query]);

  async function loadGames(params: URLSearchParams, background = false) {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const hasExistingResults = games.length > 0;
    setIsLoading(!background && !hasExistingResults);
    setIsRefreshing(!background && hasExistingResults);
    setError("");
    try {
      const response = await api.get<GameListResponse>(`/api/matchmaking/games/?${params.toString()}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setGames(response.data.games);
      setRecommendationMeta(response.data.recommendation || null);
    } catch (requestError) {
      if (controller.signal.aborted) return;
      setError(getApiErrorMessage(requestError, "We could not load open games right now. Please try again."));
    } finally {
      if (!controller.signal.aborted && requestRef.current === controller) {
        setIsLoading(false);
        setIsRefreshing(false);
        requestRef.current = null;
      }
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

  function clearFilter(filter: string) {
    if (filter === "search") setSearch("");
    if (filter === "booking") setBookingState("");
    if (filter === "type") setGameType("");
    if (filter === "role") setRole("");
    if (filter === "date") setDate("");
    if (filter === "area") setArea("");
    if (filter === "intensity") setIntensity("");
    if (filter === "skill") setSkill("");
    if (filter === "time") setTimePeriod("");
    if (filter === "spots") setMinimumSpots("");
    if (filter === "waitlist") setWaitlistOnly(false);
  }

  const hasFilters = search || bookingState || gameType || role || date || area || intensity || skill || timePeriod || minimumSpots || waitlistOnly;
  const activeFilterCount = [search, bookingState, gameType, role, date, area, intensity, skill, timePeriod, minimumSpots, waitlistOnly].filter(Boolean).length;
  const advancedFilterCount = [bookingState, role, intensity, skill, timePeriod, minimumSpots, waitlistOnly].filter(Boolean).length;

  return (
    <main className="min-h-screen bg-[var(--sport-canvas)]">
      <section className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
        <header className="flex flex-col gap-5 border-b border-slate-200/80 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <p className="sport-eyebrow">Find Games</p>
            <h1 className="sport-page-title">Find your next game</h1>
            <p className="sport-page-description">Discover open Cricksal games, choose a role that suits you, and join with confidence. Verified games already have a SportSpot court booking.</p>
          </div>
          <Link className="sport-primary-button shrink-0" href="/dashboard/player/games/create">Create Game</Link>
        </header>

        <section aria-label="Find game filters" className="sport-surface mt-6 p-3 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative block min-w-0 flex-1">
              <span className="sr-only">Search games</span>
              <SearchIcon />
              <input className={`${inputClass} pl-10`} onChange={(event) => setSearch(event.target.value)} placeholder="Search games, hosts, venues or areas" value={search} />
            </label>
            <div className="grid w-full gap-2 sm:flex sm:flex-wrap lg:w-auto">
              <button aria-controls="advanced-game-filters" aria-expanded={isFilterOpen} className="sport-secondary-button w-full sm:w-auto" onClick={() => setIsFilterOpen((current) => !current)} type="button"><FilterIcon /> More filters{advancedFilterCount ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-sportGreen">{advancedFilterCount}</span> : null}</button>
              <label className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 sm:w-auto"><span className="hidden sm:inline">Sort</span><span className="sr-only sm:hidden">Sort results</span><select aria-label="Sort results" className="min-w-0 max-w-full bg-transparent font-bold text-sportNavy outline-none" onChange={(event) => setSort(event.target.value)} value={sort}><option value="recommended">Recommended for you</option><option value="soonest">Soonest</option><option value="newest">Newest</option><option value="spots">Most spots</option></select></label>
            </div>
          </div>

          <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 lg:flex lg:items-center lg:justify-between">
            <fieldset className="grid min-w-0 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 lg:flex lg:w-auto lg:flex-1">
              <legend className="sr-only">Game type</legend>
              <span className="shrink-0 text-xs font-black uppercase tracking-wide text-slate-500">Show</span>
              <div className="grid min-w-0 grid-cols-3 rounded-lg border border-slate-200 bg-slate-50 p-1 sm:inline-flex sm:w-max sm:min-w-max">
                {gameTypes.map((option) => <button aria-pressed={gameType === option.value} className={`min-h-10 min-w-0 rounded-md px-2 text-center text-[11px] font-bold leading-tight transition sm:min-h-9 sm:px-3 sm:text-sm ${gameType === option.value ? "bg-white text-sportGreen shadow-sm" : "text-slate-600 hover:text-sportNavy"}`} key={option.value || "all"} onClick={() => setGameType(option.value)} type="button">{option.label === "All game types" ? "All games" : option.label}</button>)}
              </div>
            </fieldset>
            <div className="grid w-full gap-2 sm:grid-cols-2 lg:w-auto lg:flex-none">
              <label className="flex min-h-11 min-w-0 w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600"><CalendarIcon /><span className="sr-only">Game date</span><input aria-label="Game date" className="min-w-0 w-full bg-transparent font-bold text-sportNavy outline-none" min={today()} onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label>
              <label className="flex min-h-11 min-w-0 w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600"><MapPinIcon /><span className="sr-only">Area</span><input aria-label="Area" className="min-w-0 w-full bg-transparent font-bold text-sportNavy outline-none placeholder:font-semibold placeholder:text-slate-400" onChange={(event) => setArea(event.target.value)} placeholder="Any area" value={area} /></label>
            </div>
          </div>

          {isFilterOpen ? <div className="mt-4 border-t border-slate-200 pt-4" id="advanced-game-filters">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <Select label="Role needed" onChange={setRole} options={roles} value={role} />
              <Select label="Court status" onChange={setBookingState} options={bookingStates} value={bookingState} />
              <Select label="Game mood" onChange={setIntensity} options={intensities} value={intensity} />
              <Select label="Skill level" onChange={setSkill} options={skillLevels} value={skill} />
              <Select label="Time of day" onChange={setTimePeriod} options={timePeriods} value={timePeriod} />
              <Select label="Open spots" onChange={setMinimumSpots} options={spotOptions} value={minimumSpots} />
              <label className="flex min-h-11 items-center gap-2 self-end rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700"><input checked={waitlistOnly} className="h-4 w-4 accent-green-700" onChange={(event) => setWaitlistOnly(event.target.checked)} type="checkbox" /> Waitlist available</label>
            </div>
          </div> : null}

          {hasFilters ? <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <span className="mr-1 text-xs font-black uppercase tracking-wide text-slate-500">Active</span>
            {search ? <FilterChip label={`Search: ${search}`} onRemove={() => clearFilter("search")} /> : null}
            {gameType ? <FilterChip label={gameTypes.find((item) => item.value === gameType)?.label || gameType} onRemove={() => clearFilter("type")} /> : null}
            {date ? <FilterChip label={`Date: ${date}`} onRemove={() => clearFilter("date")} /> : null}
            {area ? <FilterChip label={`Area: ${area}`} onRemove={() => clearFilter("area")} /> : null}
            {role ? <FilterChip label={roles.find((item) => item.value === role)?.label || role} onRemove={() => clearFilter("role")} /> : null}
            {bookingState ? <FilterChip label={bookingStates.find((item) => item.value === bookingState)?.label || bookingState} onRemove={() => clearFilter("booking")} /> : null}
            {intensity ? <FilterChip label={intensities.find((item) => item.value === intensity)?.label || intensity} onRemove={() => clearFilter("intensity")} /> : null}
            {skill ? <FilterChip label={skillLevels.find((item) => item.value === skill)?.label || skill} onRemove={() => clearFilter("skill")} /> : null}
            {timePeriod ? <FilterChip label={timePeriods.find((item) => item.value === timePeriod)?.label || timePeriod} onRemove={() => clearFilter("time")} /> : null}
            {minimumSpots ? <FilterChip label={`At least ${minimumSpots} spot${minimumSpots === "1" ? "" : "s"}`} onRemove={() => clearFilter("spots")} /> : null}
            {waitlistOnly ? <FilterChip label="Waitlist available" onRemove={() => clearFilter("waitlist")} /> : null}
            <button className="ml-auto text-xs font-bold text-sportGreen underline-offset-2 hover:underline" onClick={clearFilters} type="button">Clear all</button>
          </div> : null}
        </section>

        {sort === "recommended" ? <section className="mt-5 border-l-2 border-sportGreen bg-emerald-50/70 px-4 py-3.5 sm:px-5" aria-live="polite">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-sportGreen shadow-sm"><SparkIcon /></span>
            <div className="min-w-0">
              <p className="text-sm font-black text-sportNavy">Recommended for you</p>
              {recommendationMeta?.available ? <p className="mt-1 text-sm leading-6 text-slate-600">Ranked from your availability, district, skill level and preferred role. You decide which game to request.</p> : <p className="mt-1 text-sm leading-6 text-slate-600">Log in as a player to see matches ranked around your profile.</p>}
              {recommendationMeta?.available && !recommendationMeta.profile_complete ? <Link className="mt-2 inline-flex items-center gap-1 text-sm font-black text-sportGreen underline-offset-2 hover:underline" href="/dashboard/player/profile">Complete your profile <ArrowIcon /></Link> : null}
              {(!viewer || viewer.role !== "PLAYER") && !recommendationMeta?.available ? <Link className="mt-2 inline-flex items-center gap-1 text-sm font-black text-sportGreen underline-offset-2 hover:underline" href="/login">Log in to personalize <ArrowIcon /></Link> : null}
              {viewer?.role === "PLAYER" && !recommendationMeta?.available ? <Link className="mt-2 inline-flex items-center gap-1 text-sm font-black text-sportGreen underline-offset-2 hover:underline" href="/dashboard/player/profile">Set up your player profile <ArrowIcon /></Link> : null}
            </div>
          </div>
        </section> : null}

        <div className="mt-7 flex items-end justify-between gap-4">
          <div><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{sort === "recommended" ? "Recommended games" : "Open games"}</p><p aria-live="polite" className="mt-1 text-sm font-bold text-slate-700">{isLoading ? <LoadingIndicator label="Finding games" size="sm" /> : <><span className="text-lg font-black text-sportNavy">{games.length}</span> game{games.length === 1 ? "" : "s"} found</>}{isRefreshing ? <span className="ml-2 inline-flex align-middle"><LoadingIndicator label="Updating games" size="sm" /></span> : null}</p></div>
          <p className="hidden text-xs font-semibold text-slate-500 sm:block">New openings appear automatically.</p>
        </div>

        {isLoading && games.length === 0 ? (
          <div className="sport-loading-inline-panel mt-4 min-h-[18rem]"><LoadingIndicator label="Loading games" /></div>
        ) : error && games.length === 0 ? (
          <StateCard title="Games unavailable" description={error} actionLabel="Retry" onAction={() => loadGames(query)} />
        ) : games.length === 0 ? (
          <StateCard title={sort === "recommended" ? "No recommended games yet." : "No games match your filters."} description={sort === "recommended" ? "Try a different filter or view all open games. Your profile preferences will keep improving future matches." : "Try another date, role or area. You can also create your own game from a confirmed booking or start with a plan."} actionLabel={sort === "recommended" ? "See all games" : "Clear filters"} onAction={sort === "recommended" ? () => setSort("soonest") : clearFilters} />
        ) : (
          <>
            {error ? <p className="mt-3 text-sm font-semibold text-red-700" role="alert">{error}</p> : null}
            <div className={`mt-4 grid gap-3 xl:grid-cols-2 transition-opacity ${isRefreshing ? "opacity-70" : "opacity-100"}`}>{games.map((game) => <GameCard game={game} key={game.id} />)}</div>
          </>
        )}
      </section>
    </main>
  );
}

function GameCard({ game }: { game: MatchmakingGame }) {
  const recruitmentCountdown = useCountdown(game.recruitment_deadline);
  const bookingCountdown = useCountdown(game.booking_deadline, "Booking deadline passed");
  const canJoin = !game.user_state.is_host && !game.user_state.is_participant && !game.user_state.request_status && game.status === "RECRUITING";
  const canWaitlist = !game.user_state.is_host && !game.user_state.is_participant && !game.user_state.request_status && game.status === "FULL" && game.waitlist_enabled;
  const location = game.is_booking_verified ? [game.venue_name, game.court_name].filter(Boolean).join(" · ") : [game.preferred_area, game.preferred_district].filter(Boolean).join(", ") || "Location to be confirmed";
  const progress = Math.min((game.occupied_spots_count / Math.max(game.total_capacity, 1)) * 100, 100);
  const openRoles = game.role_progress.filter((item) => item.available_count > 0);
  return (
    <article className="group overflow-hidden rounded-lg border border-slate-200 bg-white transition-shadow hover:border-green-300 hover:shadow-[0_8px_24px_rgba(16,32,22,0.08)]">
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="text-[11px] font-black uppercase tracking-[0.14em] text-sportGreen">{game.game_type === "FILL_SQUAD" ? "Fill My Squad" : "Pickup game"}</span><Badge tone={game.is_booking_verified ? "green" : "blue"}>{game.is_booking_verified ? "Verified court" : "Planning"}</Badge></div>
            <h2 className="mt-2 line-clamp-2 text-lg font-black leading-tight text-sportNavy">{game.title}</h2>
            {game.recommendation ? <div className="mt-3 border-l-2 border-sportGreen bg-emerald-50/70 px-3 py-2.5"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="inline-flex items-center gap-1.5 text-xs font-black text-sportGreen"><SparkIcon /> Recommended for you</span><span className="text-xs font-black text-slate-500">{game.recommendation.fit_label}</span></div><p className="mt-1.5 text-xs font-semibold leading-5 text-slate-600">{game.recommendation.reasons.join(" · ")}</p></div> : null}
          </div>
          <StatusBadge game={game} />
        </div>

        <div className="mt-4 grid gap-3 border-y border-slate-100 py-3 sm:grid-cols-2">
          <MetaItem icon={<CalendarIcon />} label="When" value={game.start_at ? formatDateTimeInNepal(game.start_at, { weekday: "short", month: "short", day: "numeric" }) : "Date to be confirmed"} detail={game.booking_display_time} />
          <MetaItem icon={<MapPinIcon />} label="Where" value={location} detail={game.game_type === "FILL_SQUAD" && game.team_name ? game.team_name : `Hosted by ${game.host_name}`} />
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between gap-3 text-sm"><span className="font-black text-sportNavy">{game.occupied_spots_count}/{game.total_capacity} players confirmed</span><span className={game.available_spots > 0 ? "font-black text-sportGreen" : "font-bold text-slate-500"}>{game.available_spots > 0 ? `${game.available_spots} open` : "Full"}</span></div>
          <div aria-label={`${game.occupied_spots_count} of ${game.total_capacity} players`} className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${game.is_booking_verified ? "bg-sportGreen" : "bg-blue-500"}`} style={{ width: `${progress}%` }} /></div>
          <p className="mt-2 truncate text-xs font-bold text-slate-500">{openRoles.length ? `Needs ${openRoles.slice(0, 2).map((item) => `${item.role_label} (${item.available_count})`).join(" · ")}${openRoles.length > 2 ? " · more" : ""}` : "All requested roles are covered"}</p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-slate-500"><span>{game.game_intensity_label}</span><span aria-hidden="true" className="text-slate-300">·</span><span>{formatSkill(game.min_skill_level)}</span>{game.host_reliability_label ? <><span aria-hidden="true" className="text-slate-300">·</span><span className="text-sportGreen">{game.host_reliability_label}</span></> : null}</div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5">
        <div className="min-w-0 text-xs font-bold text-slate-500"><p className="flex items-center gap-1.5 truncate"><ClockIcon />{recruitmentCountdown || "Recruitment deadline not set"}</p>{!game.is_booking_verified && game.booking_deadline ? <p className="mt-1 truncate text-blue-700">Court booking: {bookingCountdown}</p> : null}</div>
        <Link className="sport-primary-button min-h-9 shrink-0 px-3 text-xs" href={`/find-game/${game.id}`}>{canJoin ? "Request to join" : canWaitlist ? "Join waitlist" : "View details"}</Link>
      </div>
    </article>
  );
}

function MetaItem({ detail, icon, label, value }: { detail: string; icon: React.ReactNode; label: string; value: string }) {
  return <div className="flex min-w-0 gap-2"><span className="mt-0.5 shrink-0 text-slate-400">{icon}</span><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className="mt-0.5 truncate font-bold text-sportNavy">{value}</p><p className="truncate text-xs font-semibold text-slate-500">{detail}</p></div></div>;
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return <label className="block"><span className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</span><div className="mt-1">{children}</div></label>;
}

function Select({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }>; value: string }) {
  return <Field label={label}><select className={inputClass} onChange={(event) => onChange(event.target.value)} value={value}>{options.map((option) => <option key={option.value || option.label} value={option.value}>{option.label}</option>)}</select></Field>;
}

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "blue" }) {
  const classes = tone === "green" ? "border-green-200 bg-green-50 text-sportGreen" : tone === "blue" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black ${classes}`}>{children}</span>;
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-green-200 bg-green-50 py-1 pl-2.5 pr-1 text-xs font-bold text-sportGreen"><span className="max-w-[15rem] truncate">{label}</span><button aria-label={`Remove ${label} filter`} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-sm leading-none hover:bg-green-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400" onClick={onRemove} type="button"><CloseIcon /></button></span>;
}

function StatusBadge({ game }: { game: MatchmakingGame }) {
  const label = game.status === "RECRUITING" ? "Recruiting" : game.status === "FULL" ? (game.waitlist_enabled ? "Waitlist open" : "Full") : game.status === "CLOSED" ? "Recruitment closed" : game.status_label;
  const isClosed = game.status === "CLOSED" || game.status === "CANCELLED";
  return <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-black ${isClosed ? "border-red-200 bg-red-50 text-red-700" : game.status === "FULL" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-green-200 bg-green-50 text-sportGreen"}`}>{label}</span>;
}

function StateCard({ actionLabel, description, onAction, title }: { actionLabel: string; description: string; onAction: () => void; title: string }) {
  return <section className="sport-empty-state mt-4 border-green-200 bg-green-50"><h2 className="text-xl font-bold text-sportNavy">{title}</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">{description}</p><button className="sport-primary-button mt-5" onClick={onAction} type="button">{actionLabel}</button></section>;
}

function SearchIcon() {
  return <svg aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" /><path d="m16 16 4.5 4.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
}

function FilterIcon() {
  return <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24"><path d="M4 7h16M7 12h10M10 17h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
}

function CalendarIcon({ className = "h-4 w-4" }: { className?: string }) {
  return <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24"><rect height="15" rx="2" stroke="currentColor" strokeWidth="1.8" width="16" x="4" y="5" /><path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
}

function MapPinIcon({ className = "h-4 w-4" }: { className?: string }) {
  return <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.8" /></svg>;
}

function ClockIcon() {
  return <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" /><path d="M12 7v5l3 2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
}

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

function formatSkill(value: string) {
  if (value === "OPEN") return "Open to all skill levels";
  return `${value.charAt(0)}${value.slice(1).toLowerCase()}+`;
}

function today() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

const inputClass = "sport-input";

function SparkIcon() {
  return <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24"><path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4L12 3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /><path d="m19 16 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" /></svg>;
}

function ArrowIcon() {
  return <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><path d="M5 12h13m-5-5 5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}
