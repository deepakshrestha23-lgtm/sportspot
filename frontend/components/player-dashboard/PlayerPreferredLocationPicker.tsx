"use client";

import axios from "axios";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import LoadingIndicator from "@/components/LoadingIndicator";
import { api } from "@/lib/api";
import type { PlayerLocationSource } from "@/types/playerProfile";
import type { MapPosition } from "@/components/owner/VenueLocationPickerMap";

const LocationMap = dynamic(() => import("@/components/owner/VenueLocationPickerMap"), {
  ssr: false,
  loading: () => <div className="sport-loading-inline-panel min-h-[260px]"><LoadingIndicator label="Loading map" size="sm" /></div>,
});

type LocationResult = MapPosition & {
  area?: string;
  district?: string;
  display_name: string;
  place_type: string;
};

export type PlayerLocationChange = MapPosition & {
  area: string;
  district: string;
  displayName?: string;
  source: Exclude<PlayerLocationSource, "" | "LEGACY_DISTRICT">;
};

export default function PlayerPreferredLocationPicker({
  confirmed,
  district,
  latitude,
  longitude,
  preferredArea,
  travelRadiusKm,
  onChange,
  onClear,
  onConfirm,
  onRadiusChange,
}: {
  confirmed: boolean;
  district: string;
  latitude: number | null;
  longitude: number | null;
  preferredArea: string;
  travelRadiusKm: number;
  onChange: (location: PlayerLocationChange) => void;
  onClear: () => void;
  onConfirm: () => void;
  onRadiusChange: (radius: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LocationResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedLabel, setSelectedLabel] = useState([preferredArea, district].filter(Boolean).join(", "));
  const [isIdentified, setIsIdentified] = useState(confirmed);
  const reverseRequest = useRef(0);
  const position = latitude !== null && longitude !== null ? { latitude, longitude } : null;

  useEffect(() => {
    const normalizedQuery = query.trim();
    setResults([]);
    setMessage("");
    if (normalizedQuery.length < 3) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await api.get<{ results: LocationResult[] }>("/api/players/location/search/", {
          params: { q: normalizedQuery },
          signal: controller.signal,
        });
        setResults(response.data.results);
        if (!response.data.results.length) setMessage("No matching place found. Try a nearby landmark or place the pin on the map.");
      } catch (error) {
        if (!controller.signal.aborted) {
          const responseStatus = axios.isAxiosError(error) ? error.response?.status : undefined;
          setMessage(responseStatus === 401 || responseStatus === 403 ? "Your player session has expired. Please sign in again." : "Place search is temporarily unavailable. You can still choose a point on the map.");
        }
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 600);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query]);

  function useResult(result: LocationResult) {
    reverseRequest.current += 1;
    setQuery("");
    setResults([]);
    setMessage("");
    setSelectedLabel(result.display_name);
    setIsIdentified(Boolean(result.district));
    if (!result.district) setMessage("We found the point but could not identify its district. Try a nearby landmark.");
    onChange({
      area: result.area || "",
      district: result.district || "",
      latitude: result.latitude,
      longitude: result.longitude,
      source: "GEOCODED",
      displayName: result.display_name,
    });
  }

  async function resolvePosition(nextPosition: MapPosition, nextSource: "MANUAL_PIN" | "DEVICE_LOCATION") {
    const requestId = ++reverseRequest.current;
    setMessage("");
    setSelectedLabel("Identifying this area...");
    setIsIdentified(false);
    onChange({ ...nextPosition, area: preferredArea, district, source: nextSource });
    try {
      const response = await api.get<LocationResult>("/api/players/location/reverse/", {
        params: { lat: nextPosition.latitude, lng: nextPosition.longitude },
      });
      if (requestId !== reverseRequest.current) return;
      setSelectedLabel(response.data.display_name);
      setIsIdentified(Boolean(response.data.district));
      if (!response.data.district) setMessage("We found the point but could not identify its district. Try a nearby landmark.");
      onChange({
        ...nextPosition,
        area: response.data.area || "",
        district: response.data.district || "",
        source: nextSource,
        displayName: response.data.display_name,
      });
    } catch {
      if (requestId === reverseRequest.current) {
        setSelectedLabel("Pin selected");
        setIsIdentified(false);
        setMessage("We could not identify the district for this point. Search for a nearby place and select it from the results.");
      }
    }
  }

  function useCurrentLocation() {
    setMessage("");
    if (!navigator.geolocation) {
      setMessage("This browser cannot provide device location. Search or choose a point on the map.");
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (current) => {
        const nextPosition = { latitude: current.coords.latitude, longitude: current.coords.longitude };
        const inNepal = nextPosition.latitude >= 26.3 && nextPosition.latitude <= 30.5 && nextPosition.longitude >= 80 && nextPosition.longitude <= 88.3;
        if (!inNepal) {
          setMessage("Your current location is outside SportSpot's Nepal service area.");
          setIsLocating(false);
          return;
        }
        void resolvePosition(nextPosition, "DEVICE_LOCATION");
        setIsLocating(false);
      },
      (error) => {
        setMessage(error.code === error.PERMISSION_DENIED ? "Location permission was denied. Search for your preferred playing area instead." : "We could not access your location. Search or choose a point on the map.");
        setIsLocating(false);
      },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 },
    );
  }

  const showResults = query.trim().length >= 3 && (isSearching || results.length > 0 || Boolean(message));
  function clearPreciseLocation() {
    reverseRequest.current += 1;
    setSelectedLabel([preferredArea, district].filter(Boolean).join(", "));
    setIsIdentified(false);
    setMessage("");
    onClear();
  }

  const canConfirm = Boolean(position && district && isIdentified);

  return (
    <section className="border-t border-slate-200 pt-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Preferred playing area</p>
          <h3 className="mt-1 text-lg font-black text-sportNavy">Choose where you usually want to play</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">SportSpot uses this point to rank nearby confirmed courts. Only your area and district are shown to other people.</p>
        </div>
        <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-black ${confirmed ? "bg-green-100 text-green-800" : position ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
          {confirmed ? "Ready for distance matching" : position ? "Confirm your selection" : district ? "District matching active" : "Location needed"}
        </span>
      </div>

      <div className="relative z-30 mt-4">
        <label className="block text-sm font-black text-sportNavy" htmlFor="player-location-search">Search area, landmark, or address</label>
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input aria-autocomplete="list" aria-expanded={showResults} className="min-h-11 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm text-sportNavy outline-none focus:border-sportGreen focus:ring-2 focus:ring-green-100" id="player-location-search" onChange={(event) => setQuery(event.target.value)} placeholder="Example: Baneshwor, Kathmandu" type="search" value={query} />
          <button className="sport-secondary-button min-h-11 px-4 text-sm" disabled={isLocating} onClick={useCurrentLocation} type="button">{isLocating ? <LoadingIndicator label="Locating" size="sm" /> : "Use current location"}</button>
        </div>
        {showResults ? <div className="absolute inset-x-0 top-full z-[60] mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl" role="listbox">
          {isSearching ? <div className="p-3"><LoadingIndicator label="Searching places" size="sm" /></div> : null}
          {results.map((result) => <button className="block w-full border-b border-slate-100 px-3 py-3 text-left last:border-0 hover:bg-green-50 focus:bg-green-50 focus:outline-none" key={`${result.latitude}-${result.longitude}-${result.display_name}`} onClick={() => useResult(result)} role="option" type="button"><span className="block text-sm font-bold text-sportNavy">{result.display_name}</span><span className="mt-1 block text-xs font-semibold capitalize text-slate-500">{[result.area, result.district, result.place_type].filter(Boolean).join(" · ")}</span></button>)}
          {!isSearching && !results.length && message ? <p className="p-3 text-sm font-semibold text-amber-800" role="status">{message}</p> : null}
        </div> : null}
      </div>

      <div className="relative z-0 mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="h-[260px] sm:h-[310px]"><LocationMap onPositionChange={(next) => void resolvePosition(next, "MANUAL_PIN")} position={position} /></div>
        <div className="grid gap-3 border-t border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0" aria-live="polite"><p className="truncate text-sm font-bold text-sportNavy">{selectedLabel || "Search or click the map to choose an area"}</p><p className="mt-1 text-xs font-semibold text-slate-500">{[preferredArea, district].filter(Boolean).join(", ") || "District will be identified automatically"}</p></div>
          <div className="flex flex-wrap gap-2">{position ? <button className="sport-secondary-button min-h-10 px-3 text-xs" onClick={clearPreciseLocation} type="button">Use district only</button> : null}<button className="sport-primary-button min-h-10 px-3 text-xs" disabled={!canConfirm || confirmed} onClick={onConfirm} type="button">{confirmed ? "Location confirmed" : "Confirm location"}</button></div>
        </div>
      </div>
      {message && !showResults ? <p className="mt-2 text-sm font-semibold text-amber-800" role="alert">{message}</p> : null}

      <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-4"><div><label className="text-sm font-black text-sportNavy" htmlFor="travel-radius">Preferred travel radius</label><p className="mt-1 text-xs leading-5 text-slate-500">A ranking preference, not a filter. Games farther away remain discoverable.</p></div><span className="shrink-0 rounded-md bg-white px-3 py-2 text-sm font-black text-sportGreen shadow-sm">{travelRadiusKm} km</span></div>
        <input aria-valuetext={`${travelRadiusKm} kilometres`} className="mt-4 h-2 w-full cursor-pointer accent-green-700" id="travel-radius" max="50" min="2" onChange={(event) => onRadiusChange(Number(event.target.value))} step="1" type="range" value={travelRadiusKm} />
        <div className="mt-1 flex justify-between text-[11px] font-bold text-slate-400"><span>2 km</span><span>50 km</span></div>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">Privacy: your exact point is stored only for personalized distance calculations. SportSpot does not publish it on player cards or profiles.</p>
    </section>
  );
}
