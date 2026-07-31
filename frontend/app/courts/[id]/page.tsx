"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getCurrentUser } from "@/lib/auth";
import { addCalendarDays, formatDateOnly, getLocalDateString } from "@/lib/dates";
import { emitToast } from "@/lib/toast";
import type { Booking, CourtSlot, PublicVenue } from "@/types/venue";

export default function VenueDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const venueId = params.id;
  const backToCourtsHref = searchParams.toString() ? `/courts?${searchParams.toString()}` : "/courts";
  const [venue, setVenue] = useState<PublicVenue | null>(null);
  const [selectedCourtId, setSelectedCourtId] = useState<number | null>(null);
  const [slots, setSlots] = useState<CourtSlot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [durationHours, setDurationHours] = useState(1);
  const [date, setDate] = useState(getLocalDateString());
  const [isLoading, setIsLoading] = useState(true);
  const [isSlotLoading, setIsSlotLoading] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadVenue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

  useEffect(() => {
    if (!selectedCourtId) {
      setSlots([]);
      setSelectedSlotId(null);
      return;
    }
    loadSlots(selectedCourtId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCourtId, date]);

  async function loadVenue() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<{ venue: PublicVenue }>(`/api/venues/venues/${venueId}/`);
      setVenue(response.data.venue);
      if (response.data.venue.courts.length === 1) {
        setSelectedCourtId(response.data.venue.courts[0].id);
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load venue details."));
    } finally {
      setIsLoading(false);
    }
  }

  async function loadSlots(courtId: number) {
    setIsSlotLoading(true);
    try {
      const response = await api.get<{ slots: CourtSlot[] }>(`/api/venues/courts/${courtId}/slots/?date=${date}`);
      setSlots(response.data.slots);
      setSelectedSlotId(null);
    } catch {
      setSlots([]);
    } finally {
      setIsSlotLoading(false);
    }
  }

  async function reserveSlot() {
    const user = getCurrentUser();
    if (!user) {
      router.push("/login");
      return;
    }
    if (user.role !== "PLAYER") {
      setError("Only player accounts can book courts.");
      emitToast({ message: "Only player accounts can book courts.", type: "warning" });
      return;
    }
    if (!selectedCourtId) {
      setError("Select a court first.");
      emitToast({ message: "Select a court first.", type: "warning" });
      return;
    }
    if (!selectedSlotId) {
      setError("Select a start time first.");
      emitToast({ message: "Select a start time first.", type: "warning" });
      return;
    }
    if (!selectedSlotRange.isValid) {
      setError("Selected duration needs consecutive available slots. Choose another start time or shorter duration.");
      emitToast({ message: "Selected duration needs consecutive available slots. Choose another start time or shorter duration.", type: "warning" });
      return;
    }

    setIsBooking(true);
    setError("");
    try {
      const response = await api.post<{ booking: Booking }>("/api/venues/bookings/reserve/", { slot_ids: selectedSlotRange.slots.map((slot) => slot.id) });
      router.push(`/dashboard/player/bookings/payment/${response.data.booking.id}`);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not reserve this slot."));
      if (selectedCourtId) loadSlots(selectedCourtId);
    } finally {
      setIsBooking(false);
    }
  }

  const selectedCourt = useMemo(() => venue?.courts.find((court) => court.id === selectedCourtId) || null, [selectedCourtId, venue]);
  const selectedSlotRange = useMemo(() => getConsecutiveSlotRange(slots, selectedSlotId, durationHours), [durationHours, selectedSlotId, slots]);
  const dateOptions = getDateOptions();

  if (isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">Loading venue...</div>
      </main>
    );
  }

  if (!venue) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">{error || "Venue not found."}</div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <PhotoGallery venue={venue} />


      <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-black text-green-800">Cricksal</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{venue.court_count} court{venue.court_count === 1 ? "" : "s"}</span>
                </div>
                <h1 className="mt-3 text-3xl font-black text-sportNavy">{venue.name}</h1>
                <p className="mt-2 text-sm font-semibold text-slate-600">{venue.area}, {venue.city}</p>
              </div>
              <div className="rounded-md bg-green-50 px-4 py-3 text-right">
                <p className="text-xs font-black uppercase tracking-wide text-sportGreen">Starting Price</p>
                <p className="mt-1 font-black text-sportNavy">{venue.minimum_price ? `Rs ${Number(venue.minimum_price).toLocaleString()}` : "Not set"}</p>
              </div>
            </div>
            <p className="mt-5 text-sm leading-6 text-slate-600">{venue.description || "Approved Cricksal venue with bookable courts."}</p>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black text-sportNavy">Facilities</h2>
            {venue.facilities?.length ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {venue.facilities.map((facility) => (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center" key={facility}>
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-green-100 text-sm font-black text-sportGreen">
                      {facility.charAt(0).toUpperCase()}
                    </div>
                    <p className="mt-3 text-sm font-black text-sportNavy">{facility}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-md bg-slate-50 p-4 text-sm text-slate-600">No facilities listed yet.</p>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black text-sportNavy">Select Court</h2>
            <p className="mt-1 text-sm text-slate-600">Choose the playable area first. Every court has its own slot availability.</p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {venue.courts.map((court) => (
                <button
                  className={`rounded-lg border p-4 text-left transition ${
                    selectedCourtId === court.id ? "border-sportGreen bg-green-50 shadow-sm" : "border-slate-200 bg-white hover:border-sportGreen"
                  }`}
                  key={court.id}
                  onClick={() => setSelectedCourtId(court.id)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-black text-sportNavy">{court.name}</h3>
                      <p className="mt-1 text-sm text-slate-600">{formatChoice(court.court_type)} · {formatChoice(court.surface_type)}</p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-sportGreen">
                      {court.lowest_price ? `Rs ${Number(court.lowest_price).toLocaleString()}+` : "No slots"}
                    </span>
                  </div>
                  {court.description ? <p className="mt-3 line-clamp-2 text-sm text-slate-600">{court.description}</p> : null}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-black text-sportNavy">Select Slot</h2>
                <p className="mt-1 text-sm text-slate-600">Choose duration first, then select a start time with enough consecutive availability.</p>
              </div>
              <input className="rounded-md border border-slate-300 px-3 py-3 text-sm outline-none focus:border-sportGreen" min={getLocalDateString()} onChange={(event) => setDate(event.target.value)} type="date" value={date} />
            </div>

            <div className="mt-5">
              <p className="text-sm font-black text-sportNavy">Duration</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {[1, 2, 3].map((hours) => (
                  <button
                    className={`rounded-md border px-4 py-3 text-sm font-black ${durationHours === hours ? "border-sportGreen bg-sportGreen text-white" : "border-slate-200 bg-white text-slate-700 hover:border-sportGreen"}`}
                    key={hours}
                    onClick={() => {
                      setDurationHours(hours);
                      setSelectedSlotId(null);
                    }}
                    type="button"
                  >
                    {hours} hour{hours === 1 ? "" : "s"}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {dateOptions.map((option) => (
                <button
                  className={`rounded-md border px-4 py-2 text-sm font-black ${date === option.value ? "border-sportGreen bg-sportGreen text-white" : "border-slate-200 bg-white text-slate-700 hover:border-sportGreen"}`}
                  key={option.value}
                  onClick={() => setDate(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap gap-4 text-xs font-semibold text-slate-500">
              <Legend color="bg-white border border-slate-300" label="Available" />
              <Legend color="bg-green-100 border border-green-300" label="Selected" />
              <Legend color="bg-slate-200 border border-slate-300" label="Unavailable" />
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {!selectedCourtId ? (
                <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600 sm:col-span-2 lg:col-span-4">Choose a court to see available times.</p>
              ) : isSlotLoading ? (
                <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600 sm:col-span-2 lg:col-span-4">Loading slots...</p>
              ) : slots.length === 0 ? (
                <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600 sm:col-span-2 lg:col-span-4">No slots available for this court on this date.</p>
              ) : (
                slots.map((slot) => {
                  const startRange = getConsecutiveSlotRange(slots, slot.id, durationHours);
                  const isSelectable = slot.status === "AVAILABLE" && !slot.is_past && startRange.isValid;
                  const isInSelectedRange = selectedSlotRange.slots.some((selectedSlot) => selectedSlot.id === slot.id);
                  return (
                    <button
                      className={`min-h-24 rounded-md border p-3 text-left text-sm transition ${
                        isInSelectedRange
                          ? "border-sportGreen bg-green-50 text-sportGreen shadow-sm"
                          : isSelectable
                            ? "border-slate-200 bg-white text-slate-700 hover:border-sportGreen"
                            : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                      }`}
                      disabled={!isSelectable}
                      key={slot.id}
                      onClick={() => setSelectedSlotId(slot.id)}
                      type="button"
                    >
                      <span className="block font-black">{formatTime(slot.start_time)}</span>
                      <span className="mt-1 block text-xs">Rs {Number(slot.price).toLocaleString()}</span>
                      {!isSelectable ? (
                        <span className="mt-1 block text-xs">{getDisabledSlotReason(slot, startRange.isValid)}</span>
                      ) : (
                        <span className="mt-1 block text-xs">Start time</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="grid gap-6 md:grid-cols-2">
            <InfoPanel title="Venue Rules">
              {venue.rules ? (
                <p className="whitespace-pre-line text-sm leading-6 text-slate-600">{venue.rules}</p>
              ) : (
                <ul className="space-y-2 text-sm text-slate-600">
                  <li>Arrive at least 10 minutes before your booked slot.</li>
                  <li>Use proper sports shoes inside the play area.</li>
                  <li>Respect venue staff and other players.</li>
                </ul>
              )}
            </InfoPanel>
            <InfoPanel title="Cancellation Policy">
              <ul className="space-y-2 text-sm leading-6 text-slate-600">
                {venue.cancellation_policy_details.summary.map((item) => (
                  <li className="flex gap-2" key={item}>
                    <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sportGreen" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              {venue.cancellation_policy ? (
                <p className="mt-3 border-t border-slate-200 pt-3 whitespace-pre-line text-sm leading-6 text-slate-600">
                  {venue.cancellation_policy}
                </p>
              ) : null}
              <p className="mt-3 text-xs font-semibold text-slate-400">
                Your booking keeps the policy version shown at reservation time.
              </p>
            </InfoPanel>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-black text-sportNavy">Location</h2>
                <p className="mt-2 text-sm text-slate-600">{venue.address || "Address not added"}, {venue.area}, {venue.city}</p>
              </div>
              {venue.map_location ? (
                <a className="rounded-md border border-green-200 px-4 py-2 text-sm font-black text-sportGreen hover:bg-green-50" href={venue.map_location} rel="noreferrer" target="_blank">
                  Get Directions
                </a>
              ) : null}
            </div>
            <div className="mt-5 flex h-56 items-center justify-center rounded-lg bg-gradient-to-br from-green-50 via-slate-100 to-amber-50 text-sm font-black text-slate-500">
              Map location preview
            </div>
          </section>
        </div>

        <aside className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm lg:sticky lg:top-24 lg:self-start">
          <h2 className="text-xl font-black text-sportNavy">Booking Summary</h2>
          <div className="mt-5 space-y-3 text-sm">
            <SummaryRow label="Venue" value={venue.name} />
            <SummaryRow label="Court" value={selectedCourt?.name || "Select court"} />
            <SummaryRow label="Date" value={formatDate(date)} />
            <SummaryRow label="Time" value={selectedSlotRange.isValid ? selectedSlotRange.displayTime : "Select start time"} />
            <SummaryRow label="Duration" value={`${durationHours} hour${durationHours === 1 ? "" : "s"}`} />
            <SummaryRow label="Slots" value={selectedSlotRange.isValid ? String(selectedSlotRange.slots.length) : "0"} />
          </div>
          <div className="mt-5 border-t border-slate-200 pt-4">
            <SummaryRow label="Total Amount" value={selectedSlotRange.isValid ? `Rs ${selectedSlotRange.totalPrice.toLocaleString()}` : "Rs 0"} strong />
          </div>
          <button
            className="mt-5 w-full rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={isBooking || !selectedCourtId || !selectedSlotRange.isValid}
            onClick={reserveSlot}
            type="button"
          >
            {isBooking ? "Reserving..." : "Confirm & Book"}
          </button>
          <p className="mt-3 text-center text-xs font-semibold text-slate-500">You will continue to secure payment after reservation.</p>
          <Link className="mt-5 block text-center text-sm font-black text-sportGreen hover:text-green-700" href={backToCourtsHref}>
            Back to Courts
          </Link>
        </aside>
      </section>
    </main>
  );
}

function PhotoGallery({ venue }: { venue: PublicVenue }) {
  const images = getVenueImages(venue);

  if (images.length === 0) {
    return (
      <section className="flex aspect-[16/6] min-h-72 items-center justify-center rounded-lg bg-sportNavy text-4xl font-black text-white shadow-sm">
        {getInitials(venue.name)}
      </section>
    );
  }

  return (
    <section className="grid gap-3 overflow-hidden rounded-lg md:grid-cols-[1.3fr_1fr]">
      <img alt={venue.name} className="h-72 w-full rounded-lg object-cover md:h-96" src={images[0]} />
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((index) =>
          images[index] ? (
            <img alt={`${venue.name} ${index + 1}`} className="h-[138px] w-full rounded-lg object-cover md:h-[186px]" key={images[index]} src={images[index]} />
          ) : (
            <div className="flex h-[138px] items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-500 md:h-[186px]" key={index}>
              SportSpot
            </div>
          ),
        )}
      </div>
    </section>
  );
}

function InfoPanel({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-black text-sportNavy">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function SummaryRow({ label, strong = false, value }: { label: string; strong?: boolean; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className={`max-w-44 text-right ${strong ? "text-lg font-black text-sportNavy" : "font-black text-sportNavy"}`}>{value}</span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-3 w-3 rounded-sm ${color}`} />
      {label}
    </span>
  );
}

function getDateOptions() {
  const today = getLocalDateString();
  return [0, 1, 2].map((offset) => {
    const value = addCalendarDays(today, offset);
    const label = offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : formatDateOnly(value, { month: "short", day: "numeric" });
    return { label, value };
  });
}

function getConsecutiveSlotRange(slots: CourtSlot[], startSlotId: number | null, durationHours: number) {
  if (!startSlotId) {
    return { displayTime: "", isValid: false, slots: [] as CourtSlot[], totalDurationMinutes: 0, totalPrice: 0 };
  }

  const orderedSlots = [...slots].sort((first, second) => first.start_time.localeCompare(second.start_time));
  const startIndex = orderedSlots.findIndex((slot) => slot.id === startSlotId);
  if (startIndex === -1) {
    return { displayTime: "", isValid: false, slots: [] as CourtSlot[], totalDurationMinutes: 0, totalPrice: 0 };
  }

  const selectedSlots: CourtSlot[] = [];
  const targetMinutes = durationHours * 60;
  let totalDurationMinutes = 0;

  for (let index = startIndex; index < orderedSlots.length && totalDurationMinutes < targetMinutes; index += 1) {
    const slot = orderedSlots[index];
    const previousSlot = selectedSlots[selectedSlots.length - 1];

    if (slot.status !== "AVAILABLE" || slot.is_past) break;
    if (previousSlot && previousSlot.end_time !== slot.start_time) break;

    selectedSlots.push(slot);
    totalDurationMinutes += slot.slot_duration_minutes;
  }

  const isValid = totalDurationMinutes === targetMinutes;
  const totalPrice = selectedSlots.reduce((total, slot) => total + Number(slot.price), 0);
  const displayTime = isValid && selectedSlots.length > 0 ? `${formatTime(selectedSlots[0].start_time)} - ${formatTime(selectedSlots[selectedSlots.length - 1].end_time)}` : "";

  return { displayTime, isValid, slots: isValid ? selectedSlots : [], totalDurationMinutes, totalPrice };
}

function getVenueImages(venue: PublicVenue) {
  const rawImages = [
    venue.front_photo,
    venue.court_area_photo,
    venue.additional_photo,
    ...(venue.photos || []).map((photo) => photo.image),
    ...(venue.courts || []).map((court) => court.court_photo),
  ].filter(Boolean);

  return Array.from(new Set(rawImages.map((image) => getMediaUrl(image))));
}

function getMediaUrl(path: string) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
  return `${baseUrl}${path}`;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function formatDate(value: string) {
  return formatDateOnly(value, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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

function getDisabledSlotReason(slot: CourtSlot, hasConsecutiveRange: boolean) {
  if (slot.is_past) return "Time passed";
  if (slot.status !== "AVAILABLE") return formatChoice(slot.status);
  if (!hasConsecutiveRange) return "Not enough consecutive time";
  return "Unavailable";
}


