"use client";

import dynamic from "next/dynamic";

import LoadingIndicator from "@/components/LoadingIndicator";
import { buildVenueDirectionsHref } from "@/lib/maps";

const VenueLocationPickerMap = dynamic(() => import("@/components/owner/VenueLocationPickerMap"), {
  ssr: false,
  loading: () => <div className="sport-loading-inline-panel min-h-[240px] rounded-xl"><LoadingIndicator label="Loading map" size="sm" /></div>,
});

export default function VenueMap({ latitude, longitude, mapLocation = "" }: { latitude: number | string | null; longitude: number | string | null; mapLocation?: string }) {
  const parsedLatitude = latitude === null || latitude === "" ? null : Number(latitude);
  const parsedLongitude = longitude === null || longitude === "" ? null : Number(longitude);
  const directionsHref = buildVenueDirectionsHref(latitude, longitude, mapLocation);

  if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl bg-slate-50 px-6 text-center">
        <p className="text-sm font-semibold text-slate-600">A map preview will appear after this venue confirms its location.</p>
        {directionsHref ? <a className="text-sm font-bold text-sportGreen hover:text-green-800" href={directionsHref} rel="noreferrer" target="_blank">Open map link</a> : null}
      </div>
    );
  }

  return (
    <div className="h-[240px] overflow-hidden rounded-xl">
      <VenueLocationPickerMap position={{ latitude: parsedLatitude as number, longitude: parsedLongitude as number }} />
    </div>
  );
}
