"use client";

import dynamic from "next/dynamic";

const VenueLocationPickerMap = dynamic(() => import("@/components/owner/VenueLocationPickerMap"), {
  ssr: false,
  loading: () => <div className="flex min-h-[240px] items-center justify-center rounded-xl bg-slate-100 text-sm font-semibold text-slate-500">Loading map...</div>,
});

export default function VenueMap({ latitude, longitude }: { latitude: number | string | null; longitude: number | string | null }) {
  const parsedLatitude = latitude === null || latitude === "" ? null : Number(latitude);
  const parsedLongitude = longitude === null || longitude === "" ? null : Number(longitude);

  if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)) {
    return <div className="flex min-h-[240px] items-center justify-center rounded-xl bg-slate-100 px-6 text-center text-sm font-semibold text-slate-500">A map will appear when the venue location is confirmed.</div>;
  }

  return (
    <div className="h-[240px] overflow-hidden rounded-xl">
      <VenueLocationPickerMap position={{ latitude: parsedLatitude as number, longitude: parsedLongitude as number }} />
    </div>
  );
}
