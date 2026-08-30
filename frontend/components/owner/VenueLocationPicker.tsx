"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import axios from "axios";

import LoadingIndicator from "@/components/LoadingIndicator";
import { api } from "@/lib/api";
import { isVenueMapUrl } from "@/lib/maps";

import type { MapPosition } from "./VenueLocationPickerMap";

const VenueLocationPickerMap = dynamic(() => import("./VenueLocationPickerMap"), {
  ssr: false,
  loading: () => <div className="sport-loading-inline-panel min-h-[290px] rounded-xl"><LoadingIndicator label="Loading map" size="sm" /></div>,
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
  source: "GEOCODED" | "MANUAL_PIN" | "DEVICE_LOCATION";
  displayName?: string;
};

export default function VenueLocationPicker({
  address,
  confirmed,
  latitude,
  longitude,
  source,
  mapLocation,
  onChange,
  onMapLocationChange,
  onConfirm,
  onClear,
}: {
  address: string;
  confirmed: boolean;
  latitude: number | string | null;
  longitude: number | string | null;
  source?: string;
  mapLocation: string;
  onChange: (location: VenueLocationChange) => void;
  onMapLocationChange: (value: string) => void;
  onConfirm: () => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LocationResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState(address);
  const [searchMessage, setSearchMessage] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const reverseRequest = useRef(0);

  useEffect(() => {
    if (!selectedLabel && address) setSelectedLabel(address);
  }, [address, selectedLabel]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    setResults([]);
    setSearchMessage("");
    setIsSearching(false);
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

  async function reverseGeocodePosition(nextPosition: MapPosition, nextSource: VenueLocationChange["source"], fallbackLabel: string) {
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
          source: nextSource,
          displayName: response.data.display_name,
        });
      }
    } catch {
      if (reverseRequest.current === requestId) setSelectedLabel(fallbackLabel);
    }
  }

  function selectResult(result: LocationResult) {
    reverseRequest.current += 1;
    setQuery("");
    setResults([]);
    setSearchMessage("");
    setLocationError("");
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
    setLocationError("");
    setSelectedLabel("Pin selected. Confirm this location to save it.");
    onChange({ ...nextPosition, source: "MANUAL_PIN" });
    await reverseGeocodePosition(nextPosition, "MANUAL_PIN", "Pin selected. Confirm this location to save it.");
  }

  function useCurrentLocation() {
    setLocationError("");
    if (!navigator.geolocation) {
      setLocationError("This browser does not provide device location. Search for the venue or place the pin manually.");
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (currentPosition) => {
        const nextPosition = {
          latitude: currentPosition.coords.latitude,
          longitude: currentPosition.coords.longitude,
        };
        const isWithinNepal = nextPosition.latitude >= 26.3 && nextPosition.latitude <= 30.5 && nextPosition.longitude >= 80 && nextPosition.longitude <= 88.3;
        if (!isWithinNepal) {
          setLocationError("Your current location is outside SportSpot's supported Nepal service area. Search for the venue or place the pin manually.");
          setIsLocating(false);
          return;
        }

        setSelectedLabel("Current device location selected. Confirm this point before saving.");
        onChange({ ...nextPosition, source: "DEVICE_LOCATION", displayName: "Current device location" });
        void reverseGeocodePosition(nextPosition, "DEVICE_LOCATION", "Current device location selected. Confirm this point before saving.");
        setIsLocating(false);
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? "Location permission was denied. Allow location access or choose the venue on the map."
          : error.code === error.TIMEOUT
            ? "We could not get your location in time. Try again or choose the venue on the map."
            : "We could not access your location. Search for the venue or place the pin manually.";
        setLocationError(message);
        setIsLocating(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
  }

  function clearLocation() {
    reverseRequest.current += 1;
    setSelectedLabel("");
    setQuery("");
    setResults([]);
    setLocationError("");
    onClear();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-black text-sportNavy">Set your venue location</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">Use one exact location for players. A confirmed pin is the primary map and directions source; the optional link below is a fallback.</p>
        </div>
        {position ? (
          <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-black ${confirmed ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
            {confirmed ? "Location confirmed" : "Confirmation needed"}
          </span>
        ) : (
          <span className="inline-flex w-fit items-center rounded-full bg-slate-200 px-3 py-1 text-xs font-black text-slate-600">Not set</span>
        )}
      </div>

      <div className="mt-5 border-t border-slate-200 pt-5">
        <p className="text-sm font-black text-sportNavy">Exact venue pin <span className="font-semibold text-slate-500">(recommended)</span></p>
        <p className="mt-1 text-xs leading-5 text-slate-500">Search for the venue, use your current device location, or click and drag the pin to the correct entrance.</p>
      </div>

      <div className="relative z-30 mt-4">
        <label className="block text-sm font-black text-sportNavy" htmlFor="venue-location-search">Search for your venue or address</label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            aria-controls="venue-location-search-results"
            aria-expanded={showSearchPanel}
            aria-autocomplete="list"
            aria-label="Search for your venue or address"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm text-sportNavy outline-none focus:border-sportGreen focus:ring-2 focus:ring-green-100"
            id="venue-location-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search venue, landmark, or address"
            type="search"
            value={query}
          />
          <button aria-busy={isLocating} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-green-200 bg-green-50 px-3 text-sm font-bold text-sportGreen transition hover:border-sportGreen hover:bg-white disabled:cursor-wait disabled:opacity-70" disabled={isLocating} onClick={useCurrentLocation} type="button">
            {isLocating ? <LoadingIndicator label="Locating" size="sm" tone="green" /> : "Use my location"}
          </button>
        </div>
        {locationError ? <p className="mt-2 text-sm font-semibold text-amber-800" role="alert">{locationError}</p> : null}
        {showSearchPanel ? (
          <div className="absolute inset-x-0 top-full z-[60] mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl" id="venue-location-search-results" role="listbox">
            {isSearching ? <div className="px-3 py-3"><LoadingIndicator label="Searching locations" size="sm" /></div> : null}
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
          <div className="min-w-0" aria-live="polite">
            <p className="text-sm font-semibold leading-5 text-slate-600">{selectedLabel || (position ? "Pin selected. Confirm this location to save it." : "Click the map to place the venue pin.")}</p>
            {position ? <p className="mt-1 text-xs font-semibold tabular-nums text-slate-400">Lat {position.latitude.toFixed(6)} · Long {position.longitude.toFixed(6)}{source === "DEVICE_LOCATION" ? " · Device location" : ""}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {position ? <button className="sport-secondary-button min-h-10 px-3 text-xs" onClick={clearLocation} type="button">Clear pin</button> : null}
            <button className="sport-primary-button min-h-10 px-3 text-xs" disabled={!position || confirmed} onClick={onConfirm} type="button">
              {confirmed ? "Location confirmed" : "Confirm location"}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-slate-200 pt-5">
        <label className="block text-sm font-black text-sportNavy" htmlFor="venue-map-link">Directions link <span className="font-semibold text-slate-500">(optional fallback)</span></label>
        <p className="mt-1 text-xs leading-5 text-slate-500">Paste a share link from Google Maps, OpenStreetMap, Apple Maps, or Bing Maps. If a pin is confirmed, SportSpot uses the pin as the canonical location. If no pin is available, players can open this link.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm text-sportNavy outline-none focus:border-sportGreen focus:ring-2 focus:ring-green-100" id="venue-map-link" onChange={(event) => onMapLocationChange(event.target.value)} placeholder="https://maps.google.com/..." type="url" value={mapLocation} />
          {mapLocation.trim() && isVenueMapUrl(mapLocation.trim()) ? <a className="text-sm font-bold text-sportGreen hover:text-green-800" href={mapLocation.trim()} rel="noreferrer" target="_blank">Test link</a> : null}
        </div>
        {mapLocation.trim() && !isVenueMapUrl(mapLocation.trim()) ? <p className="mt-2 text-xs font-semibold text-amber-800">Use a complete HTTPS link from a supported map provider.</p> : null}
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">Only the confirmed venue pin is saved and shown as the public map location; your device location is not stored separately.</p>
    </div>
  );
}
