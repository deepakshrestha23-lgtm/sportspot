"use client";

import axios from "axios";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import LoadingIndicator from "@/components/LoadingIndicator";
import type { MapPosition } from "@/components/owner/VenueLocationPickerMap";
import { api } from "@/lib/api";

const LocationMap = dynamic(() => import("@/components/owner/VenueLocationPickerMap"), {
  ssr: false,
  loading: () => <div className="sport-loading-inline-panel min-h-[250px]"><LoadingIndicator label="Loading map" size="sm" /></div>,
});

type LocationResult = MapPosition & {
  area?: string;
  district?: string;
  display_name: string;
  place_type: string;
};

export type ServiceAreaSelection = {
  code: string;
  area: string;
  district: string;
};

type ResolvedServiceArea = MapPosition & {
  service_area_code: string;
  area: string;
  district: string;
  distance_from_center_km: number;
};

export default function ServiceAreaPicker({
  value,
  onChange,
  onClear,
  id = "service-area",
  compact = false,
  heading = "Match area",
  description = "Search a landmark, use your current location, or place a pin. SportSpot stores the resulting service area for this plan, not the exact pin.",
  searchLabel = "Search a place for this match",
  emptySelectionLabel = "Choose an area on the map",
}: {
  value: ServiceAreaSelection | null;
  onChange: (selection: ServiceAreaSelection) => void;
  onClear?: () => void;
  id?: string;
  compact?: boolean;
  heading?: string;
  description?: string;
  searchLabel?: string;
  emptySelectionLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LocationResult[]>([]);
  const [position, setPosition] = useState<MapPosition | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    const normalizedQuery = query.trim();
    setResults([]);
    if (normalizedQuery.length < 3) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await api.get<{ results: LocationResult[] }>("/api/players/location/search/", {
          params: { q: normalizedQuery },
          signal: controller.signal,
        });
        setResults(response.data.results || []);
        if (!response.data.results?.length) setMessage("No places found. Try a nearby landmark or place a pin on the map.");
      } catch (error) {
        if (!axios.isCancel(error)) setMessage("We could not search places right now. You can still place a pin on the map.");
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  async function resolvePosition(nextPosition: MapPosition, label = "Selected map point") {
    const currentRequest = ++requestId.current;
    setPosition(nextPosition);
    setSelectedLabel("Finding the SportSpot service area...");
    setMessage("");
    setIsResolving(true);
    try {
      const response = await api.get<ResolvedServiceArea>("/api/venues/service-areas/resolve/", {
        params: { lat: nextPosition.latitude, lng: nextPosition.longitude },
      });
      if (currentRequest !== requestId.current) return;
      const selection = response.data;
      onChange({ code: selection.service_area_code, area: selection.area, district: selection.district });
      setSelectedLabel(`${selection.area}, ${selection.district}`);
      setQuery("");
      setResults([]);
      if (selection.distance_from_center_km > 3) {
        setMessage(`This point is matched to the ${selection.area} service area.`);
      }
    } catch {
      if (currentRequest === requestId.current) {
        setSelectedLabel(label);
        setMessage("Choose a point within SportSpot's supported Kathmandu Valley service areas.");
      }
    } finally {
      if (currentRequest === requestId.current) setIsResolving(false);
    }
  }

  function useSearchResult(result: LocationResult) {
    void resolvePosition(
      { latitude: result.latitude, longitude: result.longitude },
      result.display_name,
    );
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setMessage("This browser cannot provide device location. Search for an area or place a pin on the map.");
      return;
    }
    setIsLocating(true);
    setMessage("");
    navigator.geolocation.getCurrentPosition(
      (current) => {
        void resolvePosition({ latitude: current.coords.latitude, longitude: current.coords.longitude }, "Current location");
        setIsLocating(false);
      },
      (error) => {
        setMessage(error.code === error.PERMISSION_DENIED ? "Location permission was denied. Search or place a pin instead." : "We could not access your location. Search or place a pin instead.");
        setIsLocating(false);
      },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 },
    );
  }

  function clear() {
    requestId.current += 1;
    setPosition(null);
    setSelectedLabel("");
    setMessage("");
    onClear?.();
  }

  const showResults = query.trim().length >= 3 && (isSearching || results.length > 0 || Boolean(message));
  const selectionText = value ? `${value.area}, ${value.district}` : emptySelectionLabel;

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-black text-sportNavy">{heading}</p>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
        </div>
        <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-black ${value ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
          {value ? "Area selected" : "Area required"}
        </span>
      </div>

      <div className="relative z-30 mt-4">
        <label className="sr-only" htmlFor={`${id}-search`}>{searchLabel}</label>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input aria-autocomplete="list" aria-expanded={showResults} className="sport-field min-w-0" id={`${id}-search`} onChange={(event) => setQuery(event.target.value)} placeholder="Search area, landmark, or address" type="search" value={query} />
          <button className="sport-secondary-button min-h-11 px-4 text-sm" disabled={isLocating || isResolving} onClick={useCurrentLocation} type="button">
            {isLocating ? <LoadingIndicator label="Locating" size="sm" /> : "Use current location"}
          </button>
        </div>
        {showResults ? <div className="absolute inset-x-0 top-full z-[60] mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl" role="listbox">
          {isSearching ? <div className="p-3"><LoadingIndicator label="Searching places" size="sm" /></div> : null}
          {results.map((result) => <button className="block w-full border-b border-slate-100 px-3 py-3 text-left last:border-0 hover:bg-green-50 focus:bg-green-50 focus:outline-none" key={`${result.latitude}-${result.longitude}-${result.display_name}`} onClick={() => useSearchResult(result)} role="option" type="button"><span className="block text-sm font-bold text-sportNavy">{result.display_name}</span><span className="mt-1 block text-xs font-semibold text-slate-500">{[result.area, result.district, result.place_type].filter(Boolean).join(" · ")}</span></button>)}
          {!isSearching && !results.length && message ? <p className="p-3 text-sm font-semibold text-amber-800">{message}</p> : null}
        </div> : null}
      </div>

      <div className="relative z-0 mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className={compact ? "h-[220px]" : "h-[250px] sm:h-[300px]"}><LocationMap onPositionChange={(next) => void resolvePosition(next)} position={position} /></div>
        <div className="grid gap-3 border-t border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div aria-live="polite" className="min-w-0"><p className="truncate text-sm font-bold text-sportNavy">{isResolving ? "Finding service area..." : selectedLabel || selectionText}</p><p className="mt-1 text-xs font-semibold text-slate-500">{value ? `${value.area} · ${value.district}` : "Exact pin is not shown to players."}</p></div>
          {value && onClear ? <button className="sport-secondary-button min-h-10 px-3 text-xs" onClick={clear} type="button">Choose another area</button> : null}
        </div>
      </div>
      {message && !showResults ? <p className="mt-3 text-sm font-semibold text-amber-800" role="status">{message}</p> : null}
    </section>
  );
}
