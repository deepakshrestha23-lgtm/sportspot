"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getCurrentUser } from "@/lib/auth";
import { formatDateTimeInNepal, localDateTimeToIso } from "@/lib/dates";
import type {
  ChallengeReferenceResponse,
  ChallengeFilterOption,
  ChallengeTeamListResponse,
  ChallengeTeamSummary,
  TeamChallenge,
  TeamChallengeListResponse,
} from "@/types/teamChallenge";

type ChallengeTab = "teams" | "open" | "mine";

type ChallengeFilters = {
  search: string;
  district: string;
  area: string;
  skill_level: string;
  date_from: string;
  date_to: string;
  intensity: string;
  court_mode: string;
  players_per_side: string;
  scope: string;
  status: string;
  sort: string;
};

const tabs: Array<{ key: ChallengeTab; label: string }> = [
  { key: "teams", label: "Find Teams" },
  { key: "open", label: "Open Challenges" },
  { key: "mine", label: "My Challenges" },
];

function normalizeTab(value: string | null): ChallengeTab {
  return tabs.some((tab) => tab.key === value) ? (value as ChallengeTab) : "teams";
}

function defaultSort(tab: ChallengeTab) {
  return tab === "teams" ? "recommended" : tab === "open" ? "recommended" : "updated_desc";
}

function emptyFilters(tab: ChallengeTab): ChallengeFilters {
  return {
    search: "",
    district: "",
    area: "",
    skill_level: "",
    date_from: "",
    date_to: "",
    intensity: "",
    court_mode: "",
    players_per_side: "",
    scope: "all",
    status: "",
    sort: defaultSort(tab),
  };
}

function filtersFromParams(params: { get: (name: string) => string | null }, tab: ChallengeTab): ChallengeFilters {
  const defaults = emptyFilters(tab);
  return {
    ...defaults,
    search: params.get("search") || "",
    district: params.get("district") || "",
    area: params.get("area") || "",
    skill_level: params.get("skill_level") || "",
    date_from: params.get("date_from") || "",
    date_to: params.get("date_to") || "",
    intensity: params.get("intensity") || "",
    court_mode: params.get("court_mode") || "",
    players_per_side: params.get("players_per_side") || "",
    scope: params.get("scope") || "all",
    status: params.get("status") || "",
    sort: params.get("sort") || defaults.sort,
  };
}

function queryKeysForTab(tab: ChallengeTab): Array<keyof ChallengeFilters> {
  if (tab === "teams") return ["search", "district", "area", "skill_level", "sort"];
  if (tab === "open") return ["search", "district", "area", "date_from", "date_to", "intensity", "court_mode", "players_per_side", "sort"];
  return ["search", "scope", "status", "date_from", "date_to", "sort"];
}

function countActiveFilters(filters: ChallengeFilters, tab: ChallengeTab) {
  const keys: Array<keyof ChallengeFilters> = tab === "teams"
    ? ["search", "district", "area", "skill_level"]
    : tab === "open"
      ? ["search", "district", "area", "date_from", "date_to", "intensity", "court_mode", "players_per_side"]
      : ["search", "scope", "status", "date_from", "date_to"];
  return keys.filter((key) => Boolean(filters[key]) && !(key === "scope" && filters[key] === "all")).length;
}

function apiParamsForTab(tab: ChallengeTab, filters: ChallengeFilters) {
  const params: Record<string, string> = { search: filters.search, sort: filters.sort };
  if (tab === "teams") {
    if (filters.district) params.district = filters.district;
    if (filters.area) params.area = filters.area;
    if (filters.skill_level) params.skill_level = filters.skill_level;
  } else if (tab === "open") {
    if (filters.district) params.district = filters.district;
    if (filters.area) params.area = filters.area;
    if (filters.date_from) params.date_from = filters.date_from;
    if (filters.date_to) params.date_to = filters.date_to;
    if (filters.intensity) params.intensity = filters.intensity;
    if (filters.court_mode) params.court_mode = filters.court_mode;
    if (filters.players_per_side) params.players_per_side = filters.players_per_side;
  } else {
    params.scope = filters.scope || "all";
    if (filters.status) params.status = filters.status;
    if (filters.date_from) params.date_from = filters.date_from;
    if (filters.date_to) params.date_to = filters.date_to;
  }
  return params;
}

export default function ChallengeTeamsPage() {
  return <Suspense fallback={<ChallengeSkeleton />}><ChallengeTeamsContent /></Suspense>;
}

function ChallengeTeamsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = getCurrentUser();
  const userId = user?.id ?? null;
  const requestedTab = normalizeTab(searchParams.get("tab"));
  const queryString = searchParams.toString();
  const [activeTab, setActiveTab] = useState<ChallengeTab>(requestedTab);
  const [filters, setFilters] = useState<ChallengeFilters>(() => filtersFromParams(searchParams, requestedTab));
  const [draftFilters, setDraftFilters] = useState<ChallengeFilters>(() => filtersFromParams(searchParams, requestedTab));
  const [teams, setTeams] = useState<ChallengeTeamSummary[]>([]);
  const [openChallenges, setOpenChallenges] = useState<TeamChallenge[]>([]);
  const [myChallenges, setMyChallenges] = useState<TeamChallenge[]>([]);
  const [teamCount, setTeamCount] = useState(0);
  const [openCount, setOpenCount] = useState(0);
  const [myCount, setMyCount] = useState(0);
  const [reference, setReference] = useState<ChallengeReferenceResponse["filters"] | null>(null);
  const [referenceError, setReferenceError] = useState("");
  const [isReferenceLoading, setIsReferenceLoading] = useState(true);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [loadedTabs, setLoadedTabs] = useState<Record<ChallengeTab, boolean>>({ teams: false, open: false, mine: false });
  const loadedTabsRef = useRef(loadedTabs);
  const requestVersion = useRef(0);
  const filterQueryKey = JSON.stringify(filters);

  useEffect(() => {
    if (activeTab === requestedTab) return;
    setActiveTab(requestedTab);
    setError("");
    setIsLoading(!loadedTabsRef.current[requestedTab]);
    setIsRefreshing(false);
  }, [activeTab, requestedTab]);

  useEffect(() => {
    const nextFilters = filtersFromParams(new URLSearchParams(queryString), requestedTab);
    setFilters(nextFilters);
    setDraftFilters(nextFilters);
  }, [requestedTab, queryString]);

  const loadReference = useCallback(async () => {
    setIsReferenceLoading(true);
    setReferenceError("");
    try {
      const response = await api.get<ChallengeReferenceResponse>("/api/team-challenges/reference/");
      setReference(response.data.filters);
    } catch (requestError) {
      setReferenceError(getApiErrorMessage(requestError, "We could not load the available filters.", { notify: false }));
    } finally {
      setIsReferenceLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReference();
  }, [loadReference]);

  const loadActiveTab = useCallback(async (tab: ChallengeTab, activeFilters: ChallengeFilters) => {
    if (tab === "mine" && !user) {
      setIsLoading(false);
      setIsRefreshing(false);
      setError("");
      return;
    }

    const version = ++requestVersion.current;
    const hasExistingData = loadedTabsRef.current[tab];
    setIsLoading(!hasExistingData);
    setIsRefreshing(true);
    setError("");

    try {
      const params = apiParamsForTab(tab, activeFilters);
      if (tab === "teams") {
        const response = await api.get<ChallengeTeamListResponse>("/api/team-challenges/teams/", { params });
        if (version !== requestVersion.current) return;
        setTeams(response.data.teams);
        setTeamCount(response.data.count ?? response.data.teams.length);
      } else if (tab === "open") {
        const response = await api.get<TeamChallengeListResponse>("/api/team-challenges/challenges/public/", { params });
        if (version !== requestVersion.current) return;
        setOpenChallenges(response.data.challenges);
        setOpenCount(response.data.count ?? response.data.challenges.length);
      } else {
        const response = await api.get<TeamChallengeListResponse>("/api/team-challenges/challenges/", { params });
        if (version !== requestVersion.current) return;
        setMyChallenges(response.data.challenges);
        setMyCount(response.data.count ?? response.data.challenges.length);
      }

      if (version !== requestVersion.current) return;
      loadedTabsRef.current = { ...loadedTabsRef.current, [tab]: true };
      setLoadedTabs(loadedTabsRef.current);
    } catch (requestError) {
      if (version !== requestVersion.current) return;
      setError(getApiErrorMessage(requestError, "We could not load team challenges right now.", { notify: false }));
    } finally {
      if (version === requestVersion.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadActiveTab(activeTab, filters), 220);
    return () => {
      window.clearTimeout(timer);
      requestVersion.current += 1;
    };
  }, [activeTab, filterQueryKey, loadActiveTab]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadActiveTab(activeTab, filters);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [activeTab, filterQueryKey, loadActiveTab]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  function changeTab(tab: ChallengeTab) {
    if (tab === activeTab) return;
    const nextFilters = emptyFilters(tab);
    nextFilters.search = filters.search;
    setFilters(nextFilters);
    setDraftFilters(nextFilters);
    setActiveTab(tab);
    setError("");
    setIsLoading(!loadedTabsRef.current[tab]);
    setIsRefreshing(false);
    setIsFilterOpen(false);
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (nextFilters.search) params.set("search", nextFilters.search);
    router.replace(`/challenge-teams?${params.toString()}`, { scroll: false });
  }

  function changeSearch(value: string) {
    updateUrl({ ...filters, search: value });
  }

  function updateUrl(nextFilters: ChallengeFilters) {
    setFilters(nextFilters);
    const params = new URLSearchParams();
    params.set("tab", activeTab);
    queryKeysForTab(activeTab).forEach((key) => {
      const value = nextFilters[key];
      if (value && !(key === "scope" && value === "all")) params.set(key, value);
    });
    router.replace(`/challenge-teams?${params.toString()}`, { scroll: false });
  }

  function changeFilter(key: keyof ChallengeFilters, value: string) {
    const nextFilters = { ...filters, [key]: value };
    if (key === "district") nextFilters.area = "";
    updateUrl(nextFilters);
  }

  function applyDraftFilters() {
    updateUrl(draftFilters);
    setIsFilterOpen(false);
  }

  function resetFilters() {
    const nextFilters = emptyFilters(activeTab);
    nextFilters.search = filters.search;
    setDraftFilters(nextFilters);
    updateUrl(nextFilters);
  }

  function clearAll() {
    const nextFilters = emptyFilters(activeTab);
    setDraftFilters(nextFilters);
    updateUrl(nextFilters);
  }

  function retry() {
    void loadActiveTab(activeTab, filters);
  }

  const activeTabLoaded = loadedTabs[activeTab];
  const activeItems = activeTab === "open" ? openChallenges : myChallenges;
  const resultCount = activeTab === "teams" ? teamCount : activeTab === "open" ? openCount : myCount;
  const activeCount = countActiveFilters(filters, activeTab);
  const sortOptions = reference?.sort_options[activeTab] || [];

  return (
    <main className="min-h-[calc(100vh-68px)] bg-[var(--sport-canvas)] px-4 py-7 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-5 border-b border-slate-200/80 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="sport-eyebrow">Challenge Teams</p>
            <h1 className="sport-page-title">Find your next Cricksal match</h1>
            <p className="sport-page-description">Challenge an available team or respond to a match proposal from your team captain.</p>
          </div>
          {user ? <Link className="sport-primary-button shrink-0" href="/challenge-teams/create">Create Challenge</Link> : <Link className="sport-secondary-button shrink-0" href="/login">Log in to challenge</Link>}
        </header>

        <section className="sport-surface p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <label className="relative block w-full lg:max-w-xl">
              <span className="sr-only">Search teams and challenges</span>
              <SearchIcon />
              <input className="min-h-11 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm outline-none focus:border-sportGreen focus:ring-2 focus:ring-green-100" onChange={(event) => changeSearch(event.target.value)} placeholder="Search teams, areas or venues" value={filters.search} />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button aria-expanded={isFilterOpen} className="sport-secondary-button" disabled={isReferenceLoading} onClick={() => { setDraftFilters(filters); setIsFilterOpen((current) => !current); }} type="button"><FilterIcon /> Filters{activeCount ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-sportGreen">{activeCount}</span> : null}</button>
              <label className="flex min-h-11 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-600"><span className="sr-only">Sort results</span><span className="hidden sm:inline">Sort</span><select aria-label="Sort results" className="bg-transparent font-semibold text-sportNavy outline-none" onChange={(event) => changeFilter("sort", event.target.value)} value={filters.sort}>{sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            </div>
          </div>
          {isFilterOpen ? <ChallengeFilterPanel activeTab={activeTab} draftFilters={draftFilters} onChange={(key, value) => { const next = { ...draftFilters, [key]: value }; if (key === "district") next.area = ""; setDraftFilters(next); }} onApply={applyDraftFilters} onReset={resetFilters} reference={reference} referenceError={referenceError} onRetryReference={loadReference} /> : null}
          <div aria-label="Challenge sections" className="mt-4 sport-tab-list overflow-x-auto" role="tablist">
            {tabs.map((tab) => <button aria-controls={`${tab.key}-challenge-panel`} aria-selected={activeTab === tab.key} className="sport-tab" id={`${tab.key}-challenge-tab`} key={tab.key} onClick={() => changeTab(tab.key)} role="tab" tabIndex={activeTab === tab.key ? 0 : -1} type="button">{tab.label}{tab.key === "open" && openCount > 0 ? <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-[11px] text-sportGreen">{openCount}</span> : null}</button>)}
          </div>
        </section>

        {!isLoading ? <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600"><p><span className="font-black text-sportNavy">{resultCount}</span> {activeTab === "teams" ? "teams" : "challenges"} found</p>{activeCount ? <button className="font-bold text-sportGreen underline-offset-2 hover:underline" onClick={clearAll} type="button">Clear all filters</button> : null}</div> : null}
        {activeCount ? <ActiveFilterChips activeTab={activeTab} filters={filters} reference={reference} onRemove={(key) => changeFilter(key, "")} onClear={clearAll} /> : null}

        {activeTab === "mine" && !user ? <section className="sport-surface p-10 text-center"><h2 className="text-xl font-bold text-sportNavy">Log in to manage team challenges</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-600">You can browse public teams without an account. Log in as a Player to send, accept and manage challenges.</p><Link className="sport-primary-button mt-5" href="/login">Log in</Link></section> : null}
        <section aria-busy={isRefreshing} aria-labelledby={`${activeTab}-challenge-tab`} className="space-y-4" id={`${activeTab}-challenge-panel`} role="tabpanel" tabIndex={0}>
          {isRefreshing && activeTabLoaded ? <p aria-live="polite" className="text-right text-xs font-semibold text-slate-500">Updating results...</p> : null}
          {isLoading ? <ChallengeSkeleton variant={activeTab} /> : error && !activeTabLoaded ? <ErrorState message={error} onRetry={retry} /> : activeTab === "mine" && !user ? null : error ? <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><div className="flex flex-wrap items-center justify-between gap-3"><p>We could not refresh these results. Showing the last available update.</p><button className="font-bold underline underline-offset-2" onClick={retry} type="button">Try again</button></div></section> : activeTab === "teams" ? teams.length === 0 ? <EmptyState hasFilters={Boolean(activeCount)} tab={activeTab} user={Boolean(user)} /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{teams.map((team) => <TeamCard key={team.id} team={team} onChallenge={() => router.push(`/challenge-teams/create?team=${team.id}`)} />)}</div> : activeItems.length === 0 ? <EmptyState hasFilters={Boolean(activeCount)} tab={activeTab} user={Boolean(user)} /> : <div className="grid gap-4 lg:grid-cols-2">{activeItems.map((challenge) => <ChallengeCard challenge={challenge} key={challenge.id} now={clock} />)}</div>}
        </section>
      </div>
    </main>
  );
}

function ChallengeFilterPanel({
  activeTab,
  draftFilters,
  onApply,
  onChange,
  onReset,
  onRetryReference,
  reference,
  referenceError,
}: {
  activeTab: ChallengeTab;
  draftFilters: ChallengeFilters;
  onApply: () => void;
  onChange: (key: keyof ChallengeFilters, value: string) => void;
  onReset: () => void;
  onRetryReference: () => void;
  reference: ChallengeReferenceResponse["filters"] | null;
  referenceError: string;
}) {
  if (!reference) {
    return <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><p>{referenceError || "Loading filter options..."}</p>{referenceError ? <button className="mt-2 font-bold underline underline-offset-2" onClick={onRetryReference} type="button">Try again</button> : null}</div>;
  }

  const areas = draftFilters.district ? reference.areas_by_district[draftFilters.district] || [] : [];
  return (
    <section aria-label="Challenge filters" className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:p-5">
      {activeTab === "teams" ? <div className="grid gap-4 sm:grid-cols-3">
        <FilterSelect label="District" value={draftFilters.district} onChange={(value) => onChange("district", value)} options={reference.districts} placeholder="All districts" />
        <FilterSelect disabled={!draftFilters.district} label="Area" value={draftFilters.area} onChange={(value) => onChange("area", value)} options={areas} placeholder={draftFilters.district ? "All areas" : "Choose a district first"} />
        <FilterSelect label="Skill level" value={draftFilters.skill_level} onChange={(value) => onChange("skill_level", value)} options={reference.skill_levels} placeholder="All skill levels" />
      </div> : null}
      {activeTab === "open" ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect label="District" value={draftFilters.district} onChange={(value) => onChange("district", value)} options={reference.districts} placeholder="All districts" />
        <FilterSelect disabled={!draftFilters.district} label="Area" value={draftFilters.area} onChange={(value) => onChange("area", value)} options={areas} placeholder={draftFilters.district ? "All areas" : "Choose a district first"} />
        <FilterSelect label="Match style" value={draftFilters.intensity} onChange={(value) => onChange("intensity", value)} options={reference.intensities} placeholder="All styles" />
        <FilterSelect label="Court status" value={draftFilters.court_mode} onChange={(value) => onChange("court_mode", value)} options={reference.court_modes} placeholder="Any court status" />
        <FilterDate label="Match date from" value={draftFilters.date_from} onChange={(value) => onChange("date_from", value)} />
        <FilterDate label="Match date to" value={draftFilters.date_to} onChange={(value) => onChange("date_to", value)} />
        <label className="block"><span className="text-xs font-black uppercase tracking-wide text-slate-500">Players per side</span><input className="sport-field mt-1 w-full" max={30} min={2} onChange={(event) => onChange("players_per_side", event.target.value)} placeholder="Any number" type="number" value={draftFilters.players_per_side} /></label>
      </div> : null}
      {activeTab === "mine" ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect label="Direction" value={draftFilters.scope} onChange={(value) => onChange("scope", value)} options={[{ value: "all", label: "Sent and received" }, { value: "sent", label: "Sent by my team" }, { value: "received", label: "Received by my team" }]} placeholder="All challenges" />
        <FilterSelect label="Status" value={draftFilters.status} onChange={(value) => onChange("status", value)} options={reference.statuses} placeholder="All statuses" />
        <FilterDate label="Match date from" value={draftFilters.date_from} onChange={(value) => onChange("date_from", value)} />
        <FilterDate label="Match date to" value={draftFilters.date_to} onChange={(value) => onChange("date_to", value)} />
      </div> : null}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4"><button className="sport-secondary-button" onClick={onReset} type="button">Reset</button><button className="sport-primary-button" onClick={onApply} type="button">Apply filters</button></div>
    </section>
  );
}

function FilterSelect({ disabled = false, label, onChange, options, placeholder, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; options: ChallengeFilterOption[]; placeholder: string; value: string }) {
  return <label className="block"><span className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</span><select className="sport-field mt-1 w-full" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}><option value="">{placeholder}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function FilterDate({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return <label className="block"><span className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</span><input className="sport-field mt-1 w-full" onChange={(event) => onChange(event.target.value)} type="date" value={value} /></label>;
}

function ActiveFilterChips({ activeTab, filters, onClear, onRemove, reference }: { activeTab: ChallengeTab; filters: ChallengeFilters; onClear: () => void; onRemove: (key: keyof ChallengeFilters) => void; reference: ChallengeReferenceResponse["filters"] | null }) {
  const labelFor = (options: ChallengeFilterOption[] | undefined, value: string) => options?.find((option) => option.value === value)?.label || value;
  const areas = filters.district ? reference?.areas_by_district[filters.district] || [] : [];
  const chips: Array<{ key: keyof ChallengeFilters; label: string }> = [];
  if (filters.search) chips.push({ key: "search", label: `Search: ${filters.search}` });
  if (activeTab !== "mine" && filters.district) chips.push({ key: "district", label: labelFor(reference?.districts, filters.district) });
  if (activeTab !== "mine" && filters.area) chips.push({ key: "area", label: labelFor(areas, filters.area) });
  if (activeTab === "teams" && filters.skill_level) chips.push({ key: "skill_level", label: labelFor(reference?.skill_levels, filters.skill_level) });
  if (activeTab === "open") {
    if (filters.intensity) chips.push({ key: "intensity", label: labelFor(reference?.intensities, filters.intensity) });
    if (filters.court_mode) chips.push({ key: "court_mode", label: labelFor(reference?.court_modes, filters.court_mode) });
    if (filters.date_from) chips.push({ key: "date_from", label: `From ${filters.date_from}` });
    if (filters.date_to) chips.push({ key: "date_to", label: `Until ${filters.date_to}` });
    if (filters.players_per_side) chips.push({ key: "players_per_side", label: `${filters.players_per_side} a side` });
  }
  if (activeTab === "mine") {
    if (filters.scope && filters.scope !== "all") chips.push({ key: "scope", label: labelFor([{ value: "sent", label: "Sent by my team" }, { value: "received", label: "Received by my team" }], filters.scope) });
    if (filters.status) chips.push({ key: "status", label: labelFor(reference?.statuses, filters.status) });
    if (filters.date_from) chips.push({ key: "date_from", label: `From ${filters.date_from}` });
    if (filters.date_to) chips.push({ key: "date_to", label: `Until ${filters.date_to}` });
  }
  if (!chips.length) return null;
  return <div aria-label="Applied filters" className="flex flex-wrap items-center gap-2"><span className="text-xs font-black uppercase tracking-wide text-slate-500">Applied</span>{chips.map((chip) => <button aria-label={`Remove ${chip.label} filter`} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3 text-xs font-bold text-green-900 hover:bg-green-100" key={chip.key} onClick={() => onRemove(chip.key)} type="button">{chip.label}<span aria-hidden="true" className="text-sm">×</span></button>)}<button className="ml-1 text-xs font-black text-sportGreen underline-offset-2 hover:underline" onClick={onClear} type="button">Clear all</button></div>;
}

function TeamCard({ onChallenge, team }: { team: ChallengeTeamSummary; onChallenge: () => void }) {
  return <article className="sport-surface flex min-h-[220px] flex-col p-5 transition hover:-translate-y-0.5 hover:border-green-200 hover:shadow-md">
    <div className="flex items-start justify-between gap-3"><Avatar image={team.team_photo} label={team.name} /><span className="sport-status border-green-200 bg-green-50 text-sportGreen">Open to challenges</span></div>
    <h2 className="mt-4 text-lg font-bold text-sportNavy">{team.name}</h2>
    <p className="mt-1 text-sm text-slate-600">{team.location || "Location not added"}</p>
    <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-600"><span className="rounded-full bg-slate-100 px-2.5 py-1">{formatLabel(team.skill_level)}</span><span className="rounded-full bg-slate-100 px-2.5 py-1">{team.members_count} active {team.members_count === 1 ? "player" : "players"}</span></div>
    <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="truncate text-xs text-slate-500">Captain: {team.captain_name || "Team captain"}</p><button className="sport-primary-button shrink-0" onClick={onChallenge} type="button">Challenge Team</button></div>
  </article>;
}

function ChallengeCard({ challenge, now }: { challenge: TeamChallenge; now: number }) {
  const proposal = challenge.current_proposal;
  const schedule = proposal.booking_summary ? `${proposal.booking_summary.venue_name} · ${proposal.booking_summary.court_name}` : [proposal.preferred_venue_name, proposal.preferred_area, proposal.preferred_district].filter(Boolean).join(" · ") || "Court details to be agreed";
  const date = proposal.booking_summary?.start_at || (proposal.proposed_date && proposal.proposed_start_time ? localDateTimeToIso(proposal.proposed_date, proposal.proposed_start_time) : null);
  return <article className="sport-surface flex min-h-[245px] flex-col p-5">
    <div className="flex items-start justify-between gap-3"><div className="flex flex-wrap gap-2"><span className="sport-status border-green-200 bg-green-50 text-sportGreen">{challenge.challenge_type === "OPEN" ? "Open challenge" : "Direct challenge"}</span><span className={`sport-status ${challenge.court_mode === "BOOKING_FIRST" ? "border-green-200 bg-green-50 text-sportGreen" : "border-blue-200 bg-blue-50 text-blue-700"}`}>{challenge.court_mode === "BOOKING_FIRST" ? "Verified booking" : "Planning"}</span></div><span className="sport-status border-slate-200 bg-slate-50 text-slate-600">{challenge.status_label}</span></div>
    <div className="mt-5 flex items-center gap-3"><div className="min-w-0 flex-1"><p className="truncate text-base font-bold text-sportNavy">{challenge.challenger_team.name}</p><p className="mt-0.5 text-xs text-slate-500">Challenger</p></div><span className="text-sm font-bold text-slate-400">vs</span><div className="min-w-0 flex-1 text-right"><p className="truncate text-base font-bold text-sportNavy">{challenge.challenged_team?.name || "Opponent wanted"}</p><p className="mt-0.5 text-xs text-slate-500">{challenge.challenged_team ? "Challenged team" : "Open to teams"}</p></div></div>
    <div className="mt-5 grid gap-2 text-sm text-slate-600 sm:grid-cols-2"><p><span className="font-semibold text-slate-800">When:</span> {formatDate(date)}</p><p><span className="font-semibold text-slate-800">Where:</span> {schedule}</p><p><span className="font-semibold text-slate-800">Format:</span> {proposal.players_per_side} a side · {formatLabel(proposal.intensity)}</p><p><span className="font-semibold text-slate-800">Response by:</span> {formatDate(challenge.response_deadline)}</p></div>
    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="text-xs font-semibold text-slate-500">{((challenge.challenge_type === "OPEN" ? challenge.is_open_for_opponent_response : challenge.is_open_for_response) && new Date(challenge.response_deadline).getTime() > now) ? `Closes ${relativeDeadline(challenge.response_deadline, now)}` : "No longer accepting responses"}</p><Link className="sport-primary-button" href={`/challenge-teams/${challenge.id}`}>View Details</Link></div>
  </article>;
}

function EmptyState({ hasFilters, tab, user }: { hasFilters: boolean; tab: ChallengeTab; user: boolean }) {
  const copy = hasFilters
    ? tab === "teams"
      ? ["No teams match your filters.", "Try removing a filter or choosing another district or skill level."]
      : tab === "open"
        ? ["No open challenges match your filters.", "Try widening the date range or removing a filter."]
        : ["No challenges match your filters.", "Try removing a filter to see more of your team challenge history."]
    : tab === "teams"
      ? ["No teams are accepting challenges right now.", "Try a different search or check back later."]
      : tab === "open"
        ? ["No open challenges are available right now.", "Open challenges appear here when a team is looking for an opponent."]
        : ["You have no team challenges yet.", user ? "Challenge a team to arrange a Cricksal match." : "Log in to manage your team challenges."];
  return <section className="sport-surface p-10 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-50 text-sportGreen"><SearchIcon className="h-5 w-5" /></div><h2 className="mt-4 text-xl font-bold text-sportNavy">{copy[0]}</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-600">{copy[1]}</p>{hasFilters ? <Link className="sport-secondary-button mt-5" href={`/challenge-teams?tab=${tab}`}>Clear filters</Link> : tab === "teams" ? <Link className="sport-secondary-button mt-5" href="/challenge-teams">Clear search</Link> : user ? <Link className="sport-primary-button mt-5" href="/challenge-teams/create">Create Challenge</Link> : null}</section>;
}

function SearchIcon({ className = "pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" }: { className?: string }) {
  return <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="m21 21-4.35-4.35m1.35-5.15a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}

function FilterIcon() {
  return <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M4 6h16M7 12h10m-6 6h2" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <section className="sport-error-state text-center"><h2 className="text-lg font-bold text-red-950">We could not load team challenges.</h2><p className="mt-2 text-sm text-red-800">{message}</p><button className="sport-primary-button mt-5 bg-red-600 hover:bg-red-700" onClick={onRetry} type="button">Try again</button></section>; }
function ChallengeSkeleton({ variant = "teams" }: { variant?: ChallengeTab }) { const count = variant === "teams" ? 6 : 4; return <div className={`grid gap-4 ${variant === "teams" ? "md:grid-cols-2 xl:grid-cols-3" : "lg:grid-cols-2"}`}>{Array.from({ length: count }, (_, index) => <div className={`animate-pulse rounded-xl bg-white ${variant === "teams" ? "h-60" : "h-64"}`} key={index} />)}</div>; }
function Avatar({ image, label }: { image: string; label: string }) { return image ? <img alt={`${label} logo`} className="h-14 w-14 rounded-xl border border-slate-200 object-cover" src={image} /> : <div aria-label={`${label} logo placeholder`} className="flex h-14 w-14 items-center justify-center rounded-xl bg-green-50 text-lg font-bold text-sportGreen">{label.charAt(0).toUpperCase()}</div>; }
function formatLabel(value: string) { return value ? value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Not specified"; }
function formatDate(value: string | null) { if (!value) return "To be agreed"; const formatted = formatDateTimeInNepal(value, { dateStyle: "medium", timeStyle: "short" }); return formatted === "Not set" ? "To be agreed" : formatted; }
function relativeDeadline(value: string, referenceNow = Date.now()) { const delta = new Date(value).getTime() - referenceNow; if (delta <= 0) return "now"; const hours = Math.floor(delta / 3600000); if (hours > 24) return `in ${Math.floor(hours / 24)}d`; if (hours > 0) return `in ${hours}h`; return `in ${Math.max(1, Math.floor(delta / 60000))}m`; }
