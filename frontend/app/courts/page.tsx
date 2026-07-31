"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getCurrentUser } from "@/lib/auth";
import { emitToast } from "@/lib/toast";
import { getLocalDateString } from "@/lib/dates";
import type { VenueDiscoveryFilters, VenueDiscoveryItem, VenueDiscoveryResponse } from "@/types/venue";
import type { WishlistSummary } from "@/types/wishlist";

const SORT_OPTIONS = [
  { value: "recommended", label: "Recommended" },
  { value: "earliest", label: "Earliest Availability" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
];

const TIME_WINDOWS = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
];

const EMPTY_FILTERS: VenueDiscoveryFilters = {
  areas_by_district: {},
  districts: [],
  durations: [],
  facilities: [],
  price_max: null,
  price_min: null,
  supports_nearest: false,
  supports_rating: false,
  time_periods: [],
  venue_types: [],
};

export default function CourtsPage() {
  return (
    <Suspense fallback={<DiscoveryShellSkeleton />}>
      <CourtDiscovery />
    </Suspense>
  );
}

function CourtDiscovery() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState<VenueDiscoveryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFilterUpdating, setIsFilterUpdating] = useState(false);
  const [error, setError] = useState("");
  const [searchText, setSearchText] = useState(searchParams.get("search") || "");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [reloadCounter, setReloadCounter] = useState(0);
  const [wishlistedVenueIds, setWishlistedVenueIds] = useState<Set<number>>(new Set());

  const queryString = searchParams.toString();
  const filters = data?.filters || EMPTY_FILTERS;
  const appliedDate = searchParams.get("date") || data?.applied.date || getLocalDateString();
  const activeChipList = useMemo(() => buildActiveChips(searchParams, filters), [searchParams, filters]);

  const updateQuery = useCallback(
    (updates: Record<string, string | string[] | null>, options: { keepPage?: boolean } = {}) => {
      const next = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        next.delete(key);
        if (Array.isArray(value)) {
          value.filter(Boolean).forEach((item) => next.append(key, item));
        } else if (value) {
          next.set(key, value);
        }
      });
      if (!options.keepPage) {
        next.delete("page");
      }
      const nextQuery = next.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    setSearchText(searchParams.get("search") || "");
  }, [queryString, searchParams]);

  useEffect(() => {
    let isActive = true;
    async function loadDiscovery() {
      setIsLoading(true);
      setIsFilterUpdating(true);
      setError("");
      try {
        const response = await api.get<VenueDiscoveryResponse>(`/api/venues/venues/${queryString ? `?${queryString}` : ""}`);
        if (isActive) {
          setData(response.data);
        }
      } catch (requestError) {
        if (isActive) {
          setError(getApiErrorMessage(requestError, "We could not load courts right now. Please try again."));
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
          setIsFilterUpdating(false);
        }
      }
    }
    loadDiscovery();
    return () => {
      isActive = false;
    };
  }, [queryString, reloadCounter]);

  useEffect(() => {
    const currentSearch = searchParams.get("search") || "";
    if (searchText === currentSearch) return;
    const timer = window.setTimeout(() => {
      updateQuery({ search: searchText.trim() || null });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [searchText, searchParams, updateQuery]);
  useEffect(() => {
    const user = getCurrentUser();
    if (user?.role !== "PLAYER") {
      setWishlistedVenueIds(new Set());
      return;
    }

    let isActive = true;
    api
      .get<WishlistSummary>("/api/wishlist/summary/")
      .then((response) => {
        if (isActive) setWishlistedVenueIds(new Set(response.data.venue_ids));
      })
      .catch(() => {
        if (isActive) setWishlistedVenueIds(new Set());
      });

    return () => {
      isActive = false;
    };
  }, [pathname]);

  async function toggleVenueWishlist(venueId: number) {
    const user = getCurrentUser();
    if (!user) {
      router.push("/login");
      return;
    }
    if (user.role !== "PLAYER") {
      emitToast({ message: "Only player accounts can save venues.", type: "warning" });
      return;
    }

    const wasSaved = wishlistedVenueIds.has(venueId);
    setWishlistedVenueIds((current) => {
      const next = new Set(current);
      if (wasSaved) next.delete(venueId);
      else next.add(venueId);
      return next;
    });

    try {
      const response = await api.post<{ saved: boolean }>("/api/wishlist/toggle/", { item_type: "VENUE", venue_id: venueId });
      setWishlistedVenueIds((current) => {
        const next = new Set(current);
        if (response.data.saved) next.add(venueId);
        else next.delete(venueId);
        return next;
      });
      emitToast({ message: response.data.saved ? "Saved to wishlist." : "Removed from wishlist.", type: response.data.saved ? "success" : "info", dedupeKey: `venue-wishlist-${venueId}` });
    } catch (requestError) {
      setWishlistedVenueIds((current) => {
        const next = new Set(current);
        if (wasSaved) next.add(venueId);
        else next.delete(venueId);
        return next;
      });
      emitToast({ message: getApiErrorMessage(requestError, "We could not update your wishlist."), type: "error" });
    }
  }

  function clearAllFilters() {
    setSearchText("");
    router.replace(pathname, { scroll: false });
  }

  function toggleMultiFilter(key: "facility" | "venue_type", value: string) {
    const currentValues = searchParams.getAll(key);
    const nextValues = currentValues.includes(value)
      ? currentValues.filter((item) => item !== value)
      : [...currentValues, value];
    updateQuery({ [key]: nextValues });
  }

  const resultCount = data?.count || 0;
  const totalPages = data?.total_pages || 1;
  const currentPage = data?.page || Number(searchParams.get("page") || 1);

  return (
    <main className="bg-[#f4f7fb] text-sportNavy">
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.16em] text-sportGreen">Cricksal Court Discovery</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Find the right venue for your next game</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Compare approved Cricksal venues by location, availability, facilities, and price before choosing a specific court and time slot.
            </p>
          </div>
          <Link className="inline-flex items-center justify-center rounded-md border border-green-200 bg-white px-4 py-3 text-sm font-black text-sportGreen shadow-sm hover:bg-green-50" href="/dashboard/player/bookings">
            My Bookings
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="hidden lg:block">
            <div className="sticky top-24 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <FilterPanel
                activeCount={activeChipList.length}
                appliedDate={appliedDate}
                filters={filters}
                isUpdating={isFilterUpdating}
                onClear={clearAllFilters}
                onToggleMulti={toggleMultiFilter}
                searchParams={searchParams}
                updateQuery={updateQuery}
              />
            </div>
          </aside>

          <section className="min-w-0">
            <div className="rounded-lg bg-sportNavy p-4 shadow-lg shadow-slate-200/70 sm:p-5">
              <div className="grid gap-3 md:grid-cols-[1fr_240px]">
                <label className="relative block">
                  <span className="sr-only">Search venues</span>
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg text-slate-400">⌕</span>
                  <input
                    className="h-14 w-full rounded-lg border border-transparent bg-white pl-11 pr-4 text-sm font-semibold text-sportNavy outline-none transition placeholder:text-slate-400 focus:border-sportGreen focus:ring-4 focus:ring-green-400/20"
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="Search venues, areas, or districts"
                    type="search"
                    value={searchText}
                  />
                </label>
                <label className="block">
                  <span className="sr-only">Sort courts</span>
                  <select
                    className="h-14 w-full rounded-lg border border-transparent bg-white px-4 text-sm font-black text-sportNavy outline-none transition focus:border-sportGreen focus:ring-4 focus:ring-green-400/20"
                    onChange={(event) => updateQuery({ sort: event.target.value })}
                    value={searchParams.get("sort") || "recommended"}
                  >
                    {SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p aria-live="polite" className="text-lg font-black text-sportNavy">
                  {isLoading ? "Finding venues" : `${resultCount} venue${resultCount === 1 ? "" : "s"} found`}
                </p>
                <p className="mt-1 text-sm text-slate-500">Only approved, active Cricksal venues are shown.</p>
              </div>
              <button
                className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-black text-sportNavy shadow-sm hover:border-sportGreen lg:hidden"
                onClick={() => setMobileFiltersOpen(true)}
                type="button"
              >
                Filters{activeChipList.length ? ` (${activeChipList.length})` : ""}
              </button>
            </div>

            <ActiveFilterChips chips={activeChipList} onClear={clearAllFilters} onRemove={(chip) => updateQuery({ [chip.key]: chip.nextValue })} />

            {error ? (
              <DiscoveryErrorState message={error} onRetry={() => setReloadCounter((value) => value + 1)} />
            ) : isLoading && !data ? (
              <section className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => <VenueCardSkeleton key={index} />)}
              </section>
            ) : data && data.venues.length === 0 ? (
              <DiscoveryEmptyState hasFilters={activeChipList.length > 0 || Boolean(searchParams.get("search"))} onClear={clearAllFilters} />
            ) : (
              <>
                <section className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {data?.venues.map((venue) => (
                    <VenueDiscoveryCard isWishlisted={wishlistedVenueIds.has(venue.id)} key={venue.id} onToggleWishlist={toggleVenueWishlist} queryString={queryString} venue={venue} />
                  ))}
                </section>
                <Pagination currentPage={currentPage} totalPages={totalPages} updateQuery={updateQuery} />
              </>
            )}
          </section>
        </div>
      </section>

      <MobileFilterDrawer isOpen={mobileFiltersOpen} onClose={() => setMobileFiltersOpen(false)}>
        <FilterPanel
          activeCount={activeChipList.length}
          appliedDate={appliedDate}
          filters={filters}
          isUpdating={isFilterUpdating}
          onClear={clearAllFilters}
          onToggleMulti={toggleMultiFilter}
          searchParams={searchParams}
          updateQuery={updateQuery}
        />
        <button className="mt-5 w-full rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" onClick={() => setMobileFiltersOpen(false)} type="button">
          Apply Filters
        </button>
      </MobileFilterDrawer>
    </main>
  );
}

function FilterPanel({ activeCount, appliedDate, filters, isUpdating, onClear, onToggleMulti, searchParams, updateQuery }: {
  activeCount: number;
  appliedDate: string;
  filters: VenueDiscoveryFilters;
  isUpdating: boolean;
  onClear: () => void;
  onToggleMulti: (key: "facility" | "venue_type", value: string) => void;
  searchParams: URLSearchParams;
  updateQuery: (updates: Record<string, string | string[] | null>, options?: { keepPage?: boolean }) => void;
}) {
  const [showAllFacilities, setShowAllFacilities] = useState(false);
  const selectedDistrict = searchParams.get("district") || "";
  const selectedFacilities = searchParams.getAll("facility");
  const selectedVenueTypes = searchParams.getAll("venue_type");
  const areaOptions = selectedDistrict ? filters.areas_by_district[selectedDistrict] || [] : [];
  const visibleFacilities = showAllFacilities ? filters.facilities : filters.facilities.slice(0, 6);
  const timePeriods = filters.time_periods;
  const selectedTimePeriod = searchParams.get("time_window") || "";

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">Filters</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">{activeCount ? `${activeCount} applied` : "Find a suitable venue"}</p>
        </div>
        <button className="text-sm font-black text-sportGreen hover:text-green-700" onClick={onClear} type="button">Clear All</button>
      </div>

      <div className="mt-6 space-y-5">
        <FilterGroup label="Location">
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-sportNavy outline-none transition focus:border-sportGreen focus:ring-4 focus:ring-green-400/20"
            onChange={(event) => updateQuery({ district: event.target.value || null, area: null })}
            value={selectedDistrict}
          >
            <option value="">All districts</option>
            {filters.districts.map((district) => (
              <option key={district.value} value={district.value}>
                {formatOptionWithCount(district)}
              </option>
            ))}
          </select>
          <select
            className="mt-3 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-sportNavy outline-none transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 focus:border-sportGreen focus:ring-4 focus:ring-green-400/20"
            disabled={!selectedDistrict}
            onChange={(event) => updateQuery({ area: event.target.value || null })}
            value={searchParams.get("area") || ""}
          >
            <option value="">{selectedDistrict ? "All areas" : "Select a district first"}</option>
            {areaOptions.map((area) => (
              <option key={area.value} value={area.value}>
                {formatOptionWithCount(area)}
              </option>
            ))}
          </select>
        </FilterGroup>

        <FilterGroup label="Preferred Date">
          <input className="w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-sportNavy outline-none transition focus:border-sportGreen focus:ring-4 focus:ring-green-400/20" min={getLocalDateString()} onChange={(event) => updateQuery({ date: event.target.value || null })} type="date" value={appliedDate} />
        </FilterGroup>

        <FilterGroup label="Preferred Time">
          <div className="grid grid-cols-2 gap-2">
            <button className={`rounded-md border px-3 py-2.5 text-xs font-black transition ${!selectedTimePeriod && !searchParams.get("start_time") ? "border-sportGreen bg-sportGreen text-white" : "border-slate-200 bg-white text-slate-600 hover:border-sportGreen"}`} onClick={() => updateQuery({ time_window: null, start_time: null })} type="button">
              Any time
            </button>
            {timePeriods.map((timeWindow) => {
              const active = selectedTimePeriod === timeWindow.value;
              return (
                <button className={`rounded-md border px-3 py-2.5 text-left text-xs font-black transition ${active ? "border-sportGreen bg-sportGreen text-white" : "border-slate-200 bg-white text-slate-600 hover:border-sportGreen"}`} key={timeWindow.value} onClick={() => updateQuery({ time_window: active ? null : timeWindow.value, start_time: null })} type="button">
                  <span className="block">{timeWindow.label}</span>
                  <span className={`mt-0.5 block text-[10px] font-semibold ${active ? "text-green-50" : "text-slate-400"}`}>{timeWindow.description}</span>
                </button>
              );
            })}
          </div>
          <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <summary className="cursor-pointer text-xs font-black text-sportGreen">Choose exact start time</summary>
            <input className="mt-3 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-sportNavy outline-none transition focus:border-sportGreen focus:ring-4 focus:ring-green-400/20" onChange={(event) => updateQuery({ start_time: event.target.value || null, time_window: null })} type="time" value={searchParams.get("start_time") || ""} />
          </details>
        </FilterGroup>

        <FilterGroup label="Duration">
          <div className="grid grid-cols-3 gap-2">
            {filters.durations.map((duration) => {
              const active = Number(searchParams.get("duration") || 60) === duration;
              return (
                <button className={`rounded-md border px-3 py-2.5 text-xs font-black transition ${active ? "border-sportGreen bg-sportGreen text-white" : "border-slate-200 bg-white text-slate-600 hover:border-sportGreen"}`} key={duration} onClick={() => updateQuery({ duration: String(duration) })} type="button">
                  {duration / 60} hr
                </button>
              );
            })}
          </div>
        </FilterGroup>

        <FilterGroup label="Price Range">
          <div className="grid grid-cols-2 gap-3">
            <input className="w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-sportNavy outline-none transition focus:border-sportGreen focus:ring-4 focus:ring-green-400/20" min="0" onChange={(event) => updateQuery({ min_price: event.target.value || null })} placeholder={filters.price_min ? `Min ${formatMoney(filters.price_min)}` : "Min NPR"} type="number" value={searchParams.get("min_price") || ""} />
            <input className="w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-sportNavy outline-none transition focus:border-sportGreen focus:ring-4 focus:ring-green-400/20" min="0" onChange={(event) => updateQuery({ max_price: event.target.value || null })} placeholder={filters.price_max ? `Max ${formatMoney(filters.price_max)}` : "Max NPR"} type="number" value={searchParams.get("max_price") || ""} />
          </div>
          {filters.price_min && filters.price_max ? <p className="mt-2 text-xs font-semibold text-slate-500">Current bookable rates range from {formatMoney(filters.price_min)} to {formatMoney(filters.price_max)} per hour.</p> : null}
        </FilterGroup>

        <FilterGroup label="Venue Type">
          <div className="space-y-2">
            {filters.venue_types.map((type) => <CheckboxRow checked={selectedVenueTypes.includes(type.value)} count={type.count} key={type.value} label={type.label} onChange={() => onToggleMulti("venue_type", type.value)} />)}
          </div>
        </FilterGroup>

        <FilterGroup label="Facilities">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            {visibleFacilities.map((facility) => <CheckboxRow checked={selectedFacilities.includes(facility.value)} count={facility.count} key={facility.value} label={facility.label} onChange={() => onToggleMulti("facility", facility.value)} />)}
          </div>
          {filters.facilities.length > 6 ? (
            <button className="mt-3 text-xs font-black text-sportGreen hover:text-green-700" onClick={() => setShowAllFacilities((value) => !value)} type="button">
              {showAllFacilities ? "Show fewer facilities" : `Show ${filters.facilities.length - 6} more facilities`}
            </button>
          ) : null}
        </FilterGroup>

        {isUpdating ? <p className="rounded-md bg-green-50 px-3 py-2 text-xs font-black text-sportGreen">Updating results...</p> : null}
      </div>
    </div>
  );
}
function FilterGroup({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-black text-sportNavy">{label}</h3>
      {children}
    </section>
  );
}

function CheckboxRow({ checked, count, label, onChange }: { checked: boolean; count?: number; label: string; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sportGreen">
      <span className="flex min-w-0 items-center gap-3">
        <input checked={checked} className="h-4 w-4 rounded border-slate-300 text-sportGreen focus:ring-sportGreen" onChange={onChange} type="checkbox" />
        <span className="truncate">{label}</span>
      </span>
      {typeof count === "number" ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-500">{count}</span> : null}
    </label>
  );
}

function VenueDiscoveryCard({ isWishlisted, onToggleWishlist, queryString, venue }: { isWishlisted: boolean; onToggleWishlist: (venueId: number) => void; queryString: string; venue: VenueDiscoveryItem }) {
  const href = queryString ? `/courts/${venue.id}?${queryString}` : `/courts/${venue.id}`;
  const location = [venue.area, venue.city].filter(Boolean).join(", ");
  const hasAvailability = venue.available_court_count > 0;
  const primaryType = venue.court_types[0]?.label || "Court";
  const priceAmount = venue.starting_price ? Number(venue.starting_price).toLocaleString("en-NP", { maximumFractionDigits: 0 }) : "--";
  const hasRating = venue.average_rating && venue.review_count > 0;
  const courtAvailabilityLabel = hasAvailability
    ? `${venue.available_court_count} court${venue.available_court_count === 1 ? "" : "s"} available`
    : `${venue.court_count} court${venue.court_count === 1 ? "" : "s"}`;
  const availabilityLabel = venue.next_available_time ? `Available: ${formatTime(venue.next_available_time)}` : venue.availability_label;
  const facilityLabels = venue.important_facilities.slice(0, 2);

  return (
    <article className="group flex h-full min-h-[365px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition duration-200 hover:-translate-y-1 hover:border-green-200 hover:shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
      <div className="relative h-44 overflow-hidden bg-sportNavy">
        <Link className="absolute inset-0 z-10" href={href} aria-label={`View courts at ${venue.name}`} />
        {venue.primary_image ? (
          <img alt={`${venue.name} venue`} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" src={venue.primary_image} />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_20%_15%,#15803d,#0b1b2b_64%)] text-4xl font-black text-white">{getInitials(venue.name)}</div>
        )}
        <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/35 to-transparent" />
        {venue.is_verified ? (
          <span className="absolute left-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-full bg-sportGreen px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-white shadow-sm">
            <CheckBadgeIcon /> Verified
          </span>
        ) : null}
        <button
          aria-label={isWishlisted ? `Remove ${venue.name} from wishlist` : `Save ${venue.name} to wishlist`}
          className={`absolute right-4 top-4 z-20 flex h-11 w-11 items-center justify-center rounded-full border shadow-sm backdrop-blur transition ${isWishlisted ? "border-green-200 bg-sportGreen text-white" : "border-white/60 bg-white/90 text-slate-700 hover:bg-white hover:text-sportGreen"}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleWishlist(venue.id);
          }}
          type="button"
        >
          <HeartIcon filled={isWishlisted} />
        </button>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <Link className="min-w-0 group/title" href={href}>
            <h2 className="line-clamp-2 text-[21px] font-black leading-tight text-sportNavy group-hover/title:text-sportGreen">{venue.name}</h2>
          </Link>
          {hasRating ? (
            <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-sm font-black text-sportGreen">
              <StarIcon /> {Number(venue.average_rating).toFixed(1)}
              <span className="font-semibold text-slate-400">({venue.review_count})</span>
            </span>
          ) : null}
        </div>

        <p className="mt-3 flex items-center gap-2 text-[15px] font-semibold text-slate-500">
          <LocationIcon />
          <span className="line-clamp-1">{location || "Location available in details"}</span>
        </p>

        <div className="mt-4 flex min-h-8 flex-wrap items-center gap-2">
          <CardPill icon={<VenueTypeIcon />} label={primaryType} />
          <span className="text-sm font-bold text-slate-500">· {courtAvailabilityLabel}</span>
        </div>

        <div className="mt-3 flex min-h-7 flex-wrap items-center gap-2">
          <AvailabilityBadge available={hasAvailability} label={availabilityLabel} />
          {facilityLabels.map((facility) => <CardPill key={facility} label={facility} />)}
        </div>

        <div className="mt-auto flex items-center justify-between gap-4 border-t border-slate-100 pt-5">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Starts from</p>
            <p className="mt-1 text-2xl font-black leading-none text-sportGreen">
              NPR {priceAmount}<span className="text-sm font-semibold text-slate-500">/hr</span>
            </p>
          </div>
          <Link className="inline-flex min-h-14 min-w-32 items-center justify-center rounded-lg bg-sportGreen px-6 py-3 text-center text-base font-black leading-tight text-white shadow-sm transition hover:bg-green-700 focus:outline-none focus:ring-4 focus:ring-green-300" href={href}>
            View Courts
          </Link>
        </div>
      </div>
    </article>
  );
}

function CardPill({ icon, label }: { icon?: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-sm font-black text-slate-700">
      {icon ? <span className="text-sportNavy">{icon}</span> : null}
      {label}
    </span>
  );
}

function AvailabilityBadge({ available, label }: { available: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-black ${available ? "bg-green-50 text-sportGreen" : "bg-slate-100 text-slate-500"}`}>
      <span className={`h-2 w-2 rounded-full ${available ? "bg-sportGreen" : "bg-slate-400"}`} />
      {label}
    </span>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill={filled ? "currentColor" : "none"} viewBox="0 0 24 24">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

function CheckBadgeIcon() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
      <path clipRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.7-9.7a1 1 0 0 0-1.4-1.4L9 10.2 7.7 8.9a1 1 0 0 0-1.4 1.4l2 2a1 1 0 0 0 1.4 0l4-4Z" fillRule="evenodd" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
      <path d="m10 1.8 2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6L5.1 17l.9-5.5-4-3.9 5.5-.8 2.5-5Z" />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" fill="none" viewBox="0 0 24 24">
      <path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <path d="M12 10.5h.01" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
    </svg>
  );
}

function VenueTypeIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="M4 20V9l8-5 8 5v11M8 20v-7h8v7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}
function ActiveFilterChips({ chips, onClear, onRemove }: { chips: FilterChip[]; onClear: () => void; onRemove: (chip: FilterChip) => void }) {
  if (!chips.length) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <button className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-white px-3 py-2 text-xs font-black text-sportNavy shadow-sm hover:border-sportGreen" key={`${chip.key}-${chip.label}`} onClick={() => onRemove(chip)} type="button">
          {chip.label}
          <span aria-hidden="true" className="text-slate-400">×</span>
        </button>
      ))}
      <button className="px-2 py-2 text-xs font-black text-sportGreen hover:text-green-700" onClick={onClear} type="button">Clear all</button>
    </div>
  );
}

function Pagination({ currentPage, totalPages, updateQuery }: { currentPage: number; totalPages: number; updateQuery: (updates: Record<string, string | string[] | null>, options?: { keepPage?: boolean }) => void }) {
  if (totalPages <= 1) return null;
  const pages = Array.from({ length: totalPages }).map((_, index) => index + 1).filter((page) => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1);
  return (
    <nav aria-label="Venue results pages" className="mt-8 flex items-center justify-center gap-2 border-t border-slate-200 pt-6">
      <button className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-black text-sportNavy hover:border-sportGreen disabled:cursor-not-allowed disabled:opacity-50" disabled={currentPage <= 1} onClick={() => updateQuery({ page: String(currentPage - 1) }, { keepPage: true })} type="button">Previous</button>
      {pages.map((page, index) => {
        const previousPage = pages[index - 1];
        return (
          <span className="flex items-center gap-2" key={page}>
            {previousPage && page - previousPage > 1 ? <span className="px-2 text-sm font-black text-slate-400">...</span> : null}
            <button className={`h-10 min-w-10 rounded-md px-3 text-sm font-black ${page === currentPage ? "bg-sportGreen text-white shadow-sm" : "border border-slate-200 bg-white text-sportNavy hover:border-sportGreen"}`} onClick={() => updateQuery({ page: String(page) }, { keepPage: true })} type="button">{page}</button>
          </span>
        );
      })}
      <button className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-black text-sportNavy hover:border-sportGreen disabled:cursor-not-allowed disabled:opacity-50" disabled={currentPage >= totalPages} onClick={() => updateQuery({ page: String(currentPage + 1) }, { keepPage: true })} type="button">Next</button>
    </nav>
  );
}

function MobileFilterDrawer({ children, isOpen, onClose }: { children: React.ReactNode; isOpen: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Court filters">
      <button className="absolute inset-0 bg-sportNavy/50" onClick={onClose} type="button" aria-label="Close filters" />
      <div className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-sportNavy">Filter Venues</h2>
          <button className="rounded-full border border-slate-200 px-3 py-1 text-sm font-black text-slate-600" onClick={onClose} type="button">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function VenueCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="aspect-[16/9] animate-pulse bg-slate-200" />
      <div className="space-y-4 p-5">
        <div className="h-5 w-2/3 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
        <div className="grid grid-cols-2 gap-3 border-y border-slate-100 py-4">
          {Array.from({ length: 4 }).map((_, index) => <div className="h-10 animate-pulse rounded bg-slate-100" key={index} />)}
        </div>
        <div className="h-11 animate-pulse rounded bg-slate-200" />
      </div>
    </div>
  );
}

function DiscoveryShellSkeleton() {
  return (
    <main className="bg-[#f4f7fb] px-4 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="h-48 animate-pulse rounded-lg bg-slate-200" />
      </div>
    </main>
  );
}

function DiscoveryEmptyState({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  return (
    <section className="mt-5 rounded-lg border border-slate-200 bg-white p-10 text-center shadow-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-xl font-black text-sportGreen">SS</div>
      <h2 className="mt-5 text-2xl font-black text-sportNavy">No courts match your current filters.</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
        {hasFilters ? "Try a different date, location, duration, or price range." : "Approved venues will appear here when court owners publish available slots."}
      </p>
      {hasFilters ? <button className="mt-5 rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" onClick={onClear} type="button">Clear Filters</button> : null}
    </section>
  );
}

function DiscoveryErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="mt-5 rounded-lg border border-red-100 bg-white p-8 text-center shadow-sm">
      <h2 className="text-xl font-black text-sportNavy">We could not load courts right now.</h2>
      <p className="mt-2 text-sm text-slate-600">{message}</p>
      <button className="mt-5 rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" onClick={onRetry} type="button">Try Again</button>
    </section>
  );
}

type FilterChip = {
  key: string;
  label: string;
  nextValue: string | string[] | null;
};

function buildActiveChips(searchParams: URLSearchParams, filters: VenueDiscoveryFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  const simpleLabels: Record<string, string> = {
    area: "Area",
    date: "Date",
    district: "District",
    duration: "Duration",
    max_price: "Max",
    min_price: "Min",
    search: "Search",
    start_time: "Start",
    time_window: "Time",
  };

  Object.entries(simpleLabels).forEach(([key, label]) => {
    const value = searchParams.get(key);
    if (!value) return;
    const displayValue = key === "duration" ? `${Number(value) / 60} hour${Number(value) === 60 ? "" : "s"}` : value;
    chips.push({ key, label: `${label}: ${displayValue}`, nextValue: null });
  });

  searchParams.getAll("facility").forEach((facility) => {
    chips.push({ key: "facility", label: facility, nextValue: searchParams.getAll("facility").filter((item) => item !== facility) });
  });

  searchParams.getAll("venue_type").forEach((venueType) => {
    const label = filters.venue_types.find((option) => option.value === venueType)?.label || formatChoice(venueType);
    chips.push({ key: "venue_type", label, nextValue: searchParams.getAll("venue_type").filter((item) => item !== venueType) });
  });

  return chips;
}

function formatOptionWithCount(option: { label: string; count?: number }) {
  return typeof option.count === "number" ? `${option.label} (${option.count})` : option.label;
}
function formatMoney(value: string | number) {
  return `NPR ${Number(value).toLocaleString("en-NP", { maximumFractionDigits: 0 })}`;
}

function formatTime(value: string) {
  const [hourValue, minuteValue] = value.split(":");
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatChoice(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "SS";
}


















