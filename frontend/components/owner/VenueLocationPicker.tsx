"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import axios from "axios";

import { api } from "@/lib/api";

import type { MapPosition } from "./VenueLocationPickerMap";

const VenueLocationPickerMap = dynamic(() => import("./VenueLocationPickerMap"), {
  ssr: false,
  loading: () => <div className="flex min-h-[290px] items-center justify-center rounded-xl bg-slate-100 text-sm font-semibold text-slate-500">Loading map...</div>,
});

type LocationResult = MapPosition & {
  area?: string;
  district?: string;
  display_name: string;
  place_type: string;
};

export type VenueLocationChange = MapPosition & {
  area?: string;
  district?: string;
  source: "GEOCODED" | "MANUAL_PIN";
  displayName?: string;
};

export default function VenueLocationPicker({
  address,
  confirmed,
  latitude,
  longitude,
  onChange,
  onConfirm,
  onClear,
}: {
  address: string;
  confirmed: boolean;
  latitude: number | string | null;
  longitude: number | string | null;
  onChange: (location: VenueLocationChange) => void;
  onConfirm: () => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LocationResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState(address);
  const [searchMessage, setSearchMessage] = useState("");
  const reverseRequest = useRef(0);

  useEffect(() => {
    if (!selectedLabel && address) setSelectedLabel(address);
  }, [address, selectedLabel]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    setResults([]);
    setSearchMessage("");
    if (normalizedQuery.length < 3) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      setSearchMessage("");
      try {
        const response = await api.get<{ results: LocationResult[] }>("/api/venues/owner/location/search/", {
          params: { q: normalizedQuery },
          signal: controller.signal,
        });
        setResults(response.data.results);
        if (response.data.results.length === 0) setSearchMessage("No matching places found. You can place the pin manually.");
    } catch (error) {
      if (!controller.signal.aborted) {
        setResults([]);
        const responseStatus = axios.isAxiosError(error) ? error.response?.status : undefined;
        setSearchMessage(
          responseStatus === 401 || responseStatus === 403
            ? "Your owner session has expired. Please sign in again."
            : "Location search is temporarily unavailable. You can place the pin manually.",
        );
      }
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 650);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  const parsedLatitude = latitude === null || latitude === "" ? null : Number(latitude);
  const parsedLongitude = longitude === null || longitude === "" ? null : Number(longitude);
  const position = Number.isFinite(parsedLatitude) && Number.isFinite(parsedLongitude)
    ? { latitude: parsedLatitude as number, longitude: parsedLongitude as number }
    : null;
  const showSearchPanel = query.trim().length >= 3 && (isSearching || results.length > 0 || Boolean(searchMessage));

  function selectResult(result: LocationResult) {
    setQuery("");
    setResults([]);
    setSearchMessage("");
    setSelectedLabel(result.display_name);
    onChange({
      area: result.area,
      district: result.district,
      latitude: result.latitude,
      longitude: result.longitude,
      source: "GEOCODED",
      displayName: result.display_name,
    });
  }

  async function handleMapPositionChange(nextPosition: MapPosition) {
    setSelectedLabel("Pin selected. Confirm this location to save it.");
    onChange({ ...nextPosition, source: "MANUAL_PIN" });

    const requestId = reverseRequest.current + 1;
    reverseRequest.current = requestId;
    try {
      const response = await api.get<LocationResult>("/api/venues/owner/location/reverse/", {
        params: { lat: nextPosition.latitude, lng: nextPosition.longitude },
      });
      if (reverseRequest.current === requestId) {
        setSelectedLabel(response.data.display_name);
        onChange({
          ...nextPosition,
          area: response.data.area,
          district: response.data.district,
          source: "MANUAL_PIN",
          displayName: response.data.display_name,
        });
      }
    } catch {
      // Manual pin selection remains valid even when reverse lookup is unavailable.
    }
  }

  function clearLocation() {
    setSelectedLabel("");
    setQuery("");
    setResults([]);
    onClear();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-black text-sportNavy">Venue location</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">Help players find the correct entrance. Search for the venue, then move the pin if needed.</p>
        </div>
        {position ? (
          <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-black ${confirmed ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
            {confirmed ? "Location confirmed" : "Confirmation needed"}
          </span>
        ) : (
          <span className="inline-flex w-fit items-center rounded-full bg-slate-200 px-3 py-1 text-xs font-black text-slate-600">Not set</span>
        )}
      </div>

      <div className="relative z-30 mt-4">
        <label className="block text-sm font-black text-sportNavy" htmlFor="venue-location-search">Search for your venue or address</label>
        <input
          aria-controls="venue-location-search-results"
          aria-expanded={showSearchPanel}
          aria-autocomplete="list"
          aria-label="Search for your venue or address"
          className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-sportNavy outline-none focus:border-sportGreen focus:ring-2 focus:ring-green-100"
          id="venue-location-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="For example, NCS Indoor Cricksal, Baneshwor"
          type="search"
          value={query}
        />
        {showSearchPanel ? (
          <div className="absolute inset-x-0 top-full z-[60] mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl" id="venue-location-search-results" role="listbox">
            {isSearching ? <p className="px-3 py-3 text-sm font-semibold text-slate-500" role="status">Searching locations...</p> : null}
            {results.map((result) => (
              <button aria-label={`Use ${result.display_name} as the venue location`} className="block w-full border-b border-slate-100 px-3 py-3 text-left last:border-0 hover:bg-green-50 focus:bg-green-50 focus:outline-none" key={`${result.latitude}-${result.longitude}-${result.display_name}`} onClick={() => selectResult(result)} role="option" type="button">
                <span className="block text-sm font-bold text-sportNavy">{result.display_name}</span>
                <span className="mt-1 block text-xs font-semibold capitalize text-slate-500">{result.place_type}</span>
              </button>
            ))}
            {!isSearching && results.length === 0 && searchMessage ? <p className="px-3 py-3 text-sm font-semibold text-amber-800" role="status">{searchMessage}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="relative z-0 mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="h-[290px] sm:h-[330px]">
          <VenueLocationPickerMap onPositionChange={handleMapPositionChange} position={position} />
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold leading-5 text-slate-600" aria-live="polite">
            {selectedLabel || (position ? "Pin selected. Confirm this location to save it." : "Click the map to place the venue pin.")}
          </p>
          <div className="flex flex-wrap gap-2">
            {position ? <button className="sport-secondary-button min-h-10 px-3 text-xs" onClick={clearLocation} type="button">Clear pin</button> : null}
            <button className="sport-primary-button min-h-10 px-3 text-xs" disabled={!position || confirmed} onClick={onConfirm} type="button">
              {confirmed ? "Location confirmed" : "Confirm location"}
            </button>
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">The map pin is used for public directions. Your personal device location is never saved.</p>
    </div>
  );
}
