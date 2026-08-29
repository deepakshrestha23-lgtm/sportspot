"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getCurrentUser } from "@/lib/auth";
import { addCalendarDays, formatDateOnly, formatTimeValue, getLocalDateString } from "@/lib/dates";
import { buildVenueDirectionsHref } from "@/lib/maps";
import { emitToast } from "@/lib/toast";
import BackButton from "@/components/BackButton";
import VenueMap from "@/components/venue/VenueMap";
import type { Booking, CourtSlot, PublicVenue } from "@/types/venue";

const formatTime = formatTimeValue;

export default function VenueDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const venueId = params.id;
  const matchmakingGameId = searchParams.get("matchmaking_game");
  const handoffGameTitle = searchParams.get("game_title") || "your game plan";
  const requestedStartTime = searchParams.get("start_time") || "";
  const requestedDurationMinutes = Number(searchParams.get("duration") || 60);
  const initialDurationHours = [1, 2, 3].includes(requestedDurationMinutes / 60) ? requestedDurationMinutes / 60 : 1;
  const backToCourtsHref = searchParams.toString() ? `/courts?${searchParams.toString()}` : "/courts";
  const [venue, setVenue] = useState<PublicVenue | null>(null);
  const [selectedCourtId, setSelectedCourtId] = useState<number | null>(null);
  const [slots, setSlots] = useState<CourtSlot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [durationHours, setDurationHours] = useState(initialDurationHours);
  const [date, setDate] = useState(searchParams.get("date") || getLocalDateString());
  const [isLoading, setIsLoading] = useState(true);
  const [isSlotLoading, setIsSlotLoading] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [error, setError] = useState("");
  const [slotError, setSlotError] = useState("");
  const slotRequestId = useRef(0);

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

  useEffect(() => {
    if (!requestedStartTime || selectedSlotId || !slots.length) return;
    const matchingSlot = slots.find((slot) => slot.start_time.slice(0, 5) === requestedStartTime.slice(0, 5) && slot.status === "AVAILABLE" && !slot.is_past);
    if (matchingSlot) setSelectedSlotId(matchingSlot.id);
  }, [requestedStartTime, selectedSlotId, slots]);

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
    const requestId = slotRequestId.current + 1;
    slotRequestId.current = requestId;
    setIsSlotLoading(true);
    setSlotError("");
    setSlots([]);
    setSelectedSlotId(null);
    try {
      const response = await api.get<{ slots: CourtSlot[] }>(`/api/venues/courts/${courtId}/slots/?date=${date}`);
      if (requestId === slotRequestId.current) {
        setSlots(response.data.slots);
      }
    } catch (requestError) {
      if (requestId === slotRequestId.current) {
        setSlotError(getApiErrorMessage(requestError, "Could not load availability for this date."));
      }
    } finally {
      if (requestId === slotRequestId.current) {
        setIsSlotLoading(false);
      }
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
      const response = await api.post<{ booking: Booking }>("/api/venues/bookings/reserve/", {
        slot_ids: selectedSlotRange.slots.map((slot) => slot.id),
        matchmaking_game_id: matchmakingGameId ? Number(matchmakingGameId) : undefined,
      });
      const paymentQuery = matchmakingGameId ? `?matchmaking_game=${matchmakingGameId}` : "";
      router.push(`/dashboard/player/bookings/payment/${response.data.booking.id}${paymentQuery}`);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not reserve this slot."));
      if (selectedCourtId) void loadSlots(selectedCourtId);
    } finally {
      setIsBooking(false);
    }
  }

  function changeDate(offset: number) {
    const nextDate = addCalendarDays(date, offset);
    if (nextDate >= getLocalDateString()) setDate(nextDate);
  }

  const selectedCourt = useMemo(() => venue?.courts.find((court) => court.id === selectedCourtId) || null, [selectedCourtId, venue]);
  const selectedSlotRange = useMemo(() => getConsecutiveSlotRange(slots, selectedSlotId, durationHours), [durationHours, selectedSlotId, slots]);
  const dateOptions = getDateOptions();
  const directionsHref = venue ? buildVenueDirectionsHref(venue.latitude, venue.longitude, venue.map_location) : "";

  if (isLoading) {
    return (
      <main className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8">
        <div aria-label="Loading venue details" className="space-y-5" role="status">
          <div className="h-5 w-32 animate-pulse rounded bg-slate-200" />
          <div className="h-64 animate-pulse rounded-xl bg-slate-200 sm:h-80" />
          <div className="grid gap-4 lg:grid-cols-[1fr_350px]"><div className="h-40 animate-pulse rounded-xl bg-white" /><div className="h-72 animate-pulse rounded-xl bg-white" /></div>
        </div>
      </main>
    );
  }

  if (!venue) {
    return (
      <main className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8">
        <BackButton href={backToCourtsHref} label="Back to courts" />
        <div className="sport-error-state mt-6" role="alert">
          <p className="text-base font-bold">{error || "Venue not found."}</p>
          <p className="mt-1 text-sm">The venue details could not be loaded right now.</p>
          <button className="sport-secondary-button mt-4" onClick={() => void loadVenue()} type="button">Try again</button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <BackButton href={backToCourtsHref} label="Back to courts" />
      <PhotoGallery venue={venue} />

      <section className="sport-surface mt-4 p-5 sm:p-6" id="venue-intro">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
          <div className="min-w-0">
            <p className="sport-eyebrow">Cricksal venue</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-sportNavy sm:text-4xl">{venue.name}</h1>
            <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-600"><LocationIcon /> {venue.area}, {venue.city}</p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{venue.description || "Approved Cricksal venue with bookable courts."}</p>
          </div>
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <span className="sport-status border-green-200 bg-green-50 text-sportGreen"><CheckIcon /> Verified venue</span>
              <span className="sport-status border-slate-200 bg-slate-50 text-slate-600">{venue.court_count} court{venue.court_count === 1 ? "" : "s"}</span>
            </div>
            <a className="sport-primary-button w-full shrink-0 sm:w-auto" href="#booking">Book a court</a>
            <span className="text-xs font-semibold text-slate-500">Times shown in Nepal Time (NPT)</span>
          </div>
        </div>

        <div className="mt-5 grid gap-4 border-t border-slate-200 pt-5 sm:grid-cols-3">
          <VenueFact icon={<CourtIcon />} label="Courts" value={`${venue.court_count} available venue court${venue.court_count === 1 ? "" : "s"}`} />
          <VenueFact icon={<ClockIcon />} label="Booking time" value="30-minute slot intervals" />
          <VenueFact icon={<MoneyIcon />} label="Starting from" value={venue.minimum_price ? `${formatNpr(venue.minimum_price)} / slot` : "Price varies by court"} />
        </div>
      </section>

      {matchmakingGameId ? (
        <section className="mt-5 flex flex-col gap-3 rounded-xl border border-green-200 bg-green-50/80 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sportGreen"><LinkIcon /></span>
            <div>
              <p className="text-sm font-bold text-green-950">Booking for {handoffGameTitle}</p>
              <p className="mt-0.5 text-sm text-green-900/80">Choose the final court here. Successful payment will update the game automatically.</p>
            </div>
          </div>
          <Link className="text-sm font-bold text-sportGreen hover:text-green-800" href={`/dashboard/player/games/${matchmakingGameId}`}>Back to game</Link>
        </section>
      ) : null}

      {error ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900" role="alert">{error}</div> : null}

      <section className="sport-surface mt-5 p-5 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <div>
            <p className="sport-eyebrow">Venue details</p>
            <h2 className="mt-1 text-2xl font-bold text-sportNavy">Everything you need before you play</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">Review the venue facilities and rules before choosing a court and time.</p>
          </div>
          <div className="border-t border-slate-200 pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Available facilities</p>
            {venue.facilities?.length ? <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">{venue.facilities.map((facility) => <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600" key={facility}><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-sportGreen" />{facility}</span>)}</div> : <p className="mt-3 text-sm text-slate-500">No facilities listed yet.</p>}
          </div>
        </div>
      </section>

      <section className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_350px]">
        <div className="min-w-0 space-y-6">
          <section className="sport-surface p-5 sm:p-6" id="booking">
            <div className="flex flex-col gap-2 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="sport-eyebrow">Reserve a court</p>
                <h2 className="mt-1 text-2xl font-bold text-sportNavy">Choose your time</h2>
                <p className="mt-1 text-sm text-slate-600">Availability is shown in the venue's local time. Select a continuous block for your game.</p>
              </div>
              <span className="text-xs font-semibold text-slate-500">Held for 10 minutes at checkout</span>
            </div>

            <div className="mt-6">
              <SectionLabel htmlFor="court-date" label="1. Select a date" />
              <div className="mt-2 flex items-center gap-2">
                <button aria-label="Previous date" className="sport-icon-button shrink-0" disabled={date <= getLocalDateString()} onClick={() => changeDate(-1)} type="button"><ChevronLeftIcon /></button>
                <input aria-label="Booking date" className="sport-input" id="court-date" min={getLocalDateString()} onChange={(event) => setDate(event.target.value)} type="date" value={date} />
                <button aria-label="Next date" className="sport-icon-button shrink-0" onClick={() => changeDate(1)} type="button"><ChevronRightIcon /></button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {dateOptions.map((option) => (
                  <button aria-pressed={date === option.value} className={`rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${date === option.value ? "border-green-200 bg-green-50 text-sportGreen" : "border-slate-200 bg-white text-slate-600 hover:border-green-300 hover:text-sportGreen"}`} key={option.value} onClick={() => setDate(option.value)} type="button">{option.label}</button>
                ))}
              </div>
            </div>

            <div className="mt-7">
              <SectionLabel label="2. Select a court" />
              <p className="mt-1 text-xs text-slate-500">Each court has independent availability and pricing.</p>
              <div aria-label="Courts" className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup">
                {venue.courts.map((court) => {
                  const isSelected = selectedCourtId === court.id;
                  return (
                    <button aria-checked={isSelected} className={`flex min-h-16 items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${isSelected ? "border-sportGreen bg-green-50/70" : "border-slate-200 bg-white hover:border-green-300"}`} key={court.id} onClick={() => setSelectedCourtId(court.id)} role="radio" type="button">
                      <span className="min-w-0">
                        <span className={`block truncate text-sm font-bold ${isSelected ? "text-sportGreen" : "text-sportNavy"}`}>{court.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">{formatChoice(court.court_type)} · {formatChoice(court.surface_type)}</span>
                      </span>
                      <span className="shrink-0 text-right text-xs font-semibold text-slate-500">{court.lowest_price ? `from ${formatNpr(court.lowest_price)}` : "No price set"}{isSelected ? <CheckCircleIcon /> : null}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-7">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <SectionLabel label="3. Select duration" />
                  <p className="mt-1 text-xs text-slate-500">Longer bookings use consecutive available slots.</p>
                </div>
                <div className="flex w-fit rounded-lg border border-slate-200 bg-slate-50 p-1" role="group">
                  {[1, 2, 3].map((hours) => (
                    <button aria-pressed={durationHours === hours} className={`min-h-9 rounded-md px-3 text-sm font-semibold transition-colors ${durationHours === hours ? "bg-white text-sportGreen shadow-sm" : "text-slate-600 hover:text-sportNavy"}`} key={hours} onClick={() => { setDurationHours(hours); setSelectedSlotId(null); }} type="button">{hours} hr{hours === 1 ? "" : "s"}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-7 border-t border-slate-200 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <SectionLabel label="4. Select a start time" />
                  <p className="mt-1 text-xs text-slate-500">The total below includes every slot in the selected duration.</p>
                </div>
                <div className="flex flex-wrap gap-3 text-xs font-semibold text-slate-500">
                  <Legend color="bg-white border border-slate-300" label="Available" />
                  <Legend color="bg-green-100 border border-green-300" label="Selected" />
                </div>
              </div>

              <div className="mt-4">
                {!selectedCourtId ? (
                  <InlineState icon={<CourtIcon />} title="Choose a court to see times" description="Availability and prices will appear here." />
                ) : isSlotLoading ? (
                  <SlotSkeleton />
                ) : slotError ? (
                  <InlineState action={<button className="sport-secondary-button" onClick={() => void loadSlots(selectedCourtId)} type="button">Try again</button>} tone="error" title="Availability could not be loaded" description={slotError} />
                ) : slots.length === 0 ? (
                  <InlineState action={<button className="sport-secondary-button" onClick={() => changeDate(1)} type="button">Check next day</button>} icon={<CalendarIcon />} title="No times available on this date" description="Try another date or choose a different court." />
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {slots.map((slot) => {
                      const startRange = getConsecutiveSlotRange(slots, slot.id, durationHours);
                      const isSelectable = slot.status === "AVAILABLE" && !slot.is_past && startRange.isValid;
                      const isInSelectedRange = selectedSlotRange.slots.some((selectedSlot) => selectedSlot.id === slot.id);
                      return (
                        <button aria-label={`${formatTime(slot.start_time)}, ${isSelectable ? "available" : getDisabledSlotReason(slot, startRange.isValid)}`} className={`flex min-h-[72px] items-center justify-between gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors ${isInSelectedRange ? "border-sportGreen bg-green-50 text-sportGreen" : isSelectable ? "border-slate-200 bg-white text-slate-700 hover:border-green-300 hover:bg-green-50/40" : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"}`} disabled={!isSelectable} key={slot.id} onClick={() => setSelectedSlotId(slot.id)} type="button">
                          <span className="min-w-0"><span className="block text-sm font-bold">{formatTime(slot.start_time)}</span><span className="mt-0.5 block text-xs">{isSelectable ? `Ends ${formatTime(startRange.slots[startRange.slots.length - 1]?.end_time || slot.end_time)}` : getDisabledSlotReason(slot, startRange.isValid)}</span></span>
                          <span className="shrink-0 text-right text-xs font-semibold">{formatNpr(slot.price)}{isInSelectedRange ? <CheckCircleIcon /> : null}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className="grid gap-8 md:grid-cols-2">
            <InfoPanel title="Venue rules">
              {venue.rules ? <p className="whitespace-pre-line text-sm leading-6 text-slate-600">{venue.rules}</p> : <ul className="space-y-2 text-sm leading-6 text-slate-600"><li>Arrive at least 10 minutes before your slot.</li><li>Use suitable sports shoes inside the play area.</li><li>Respect venue staff and other players.</li></ul>}
            </InfoPanel>
            <InfoPanel title="Cancellation policy">
              <ul className="space-y-2 text-sm leading-6 text-slate-600">{venue.cancellation_policy_details.summary.map((item) => <li className="flex gap-2" key={item}><span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sportGreen" /><span>{item}</span></li>)}</ul>
              {venue.cancellation_policy ? <p className="mt-4 border-t border-slate-200 pt-4 whitespace-pre-line text-sm leading-6 text-slate-600">{venue.cancellation_policy}</p> : null}
              <p className="mt-4 text-xs text-slate-400">The policy version shown here is captured with your booking.</p>
            </InfoPanel>
          </div>

          <section className="border-t border-slate-200 pt-7">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div><p className="sport-eyebrow">Visit the venue</p><h2 className="mt-1 text-2xl font-bold text-sportNavy">Location</h2><p className="mt-2 text-sm leading-6 text-slate-600">{venue.address || "Address not added"}, {venue.area}, {venue.city}</p></div>
              {directionsHref ? <a className="sport-secondary-button shrink-0" href={directionsHref} rel="noreferrer" target="_blank"><LocationIcon /> Get directions</a> : null}
            </div>
            <div className="mt-5 overflow-hidden rounded-xl border border-slate-200"><VenueMap latitude={venue.latitude} longitude={venue.longitude} /></div>
          </section>

        </div>

        <aside className="sport-surface p-5 lg:sticky lg:top-24" aria-live="polite">
          <div><p className="sport-eyebrow">Your reservation</p><h2 className="mt-1 text-xl font-bold text-sportNavy">Booking summary</h2><p className="mt-1 text-xs text-slate-500">Review before you reserve.</p></div>
          <div className="mt-5 rounded-lg bg-slate-50 p-4"><p className="text-sm font-bold text-sportNavy">{selectedCourt?.name || "Select a court"}</p><p className="mt-1 text-sm text-slate-600">{formatDate(date)}</p><p className="mt-1 text-sm font-semibold text-slate-700">{selectedSlotRange.isValid ? selectedSlotRange.displayTime : "Select an available start time"}</p></div>
          <div className="mt-5 space-y-3 text-sm"><SummaryRow label="Venue" value={venue.name} /><SummaryRow label="Duration" value={`${durationHours} hour${durationHours === 1 ? "" : "s"}`} /><SummaryRow label="Slots" value={selectedSlotRange.isValid ? String(selectedSlotRange.slots.length) : "0"} /></div>
          <div className="mt-5 flex items-end justify-between border-t border-slate-200 pt-4"><span className="text-sm font-semibold text-slate-600">Total</span><span className="text-xl font-bold text-sportNavy">{selectedSlotRange.isValid ? formatNpr(selectedSlotRange.totalPrice) : "NPR 0"}</span></div>
          <button className="sport-primary-button mt-5 w-full" disabled={isBooking || !selectedCourtId || !selectedSlotRange.isValid} onClick={reserveSlot} type="button">{isBooking ? "Holding your time..." : "Reserve & continue"}</button>
          <p className="mt-3 text-center text-xs leading-5 text-slate-500">Your time is held for 10 minutes. It becomes confirmed only after payment is verified.</p>
          <div className="mt-5 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500"><p className="font-bold text-slate-700">Secure checkout</p><p className="mt-1">You will review this reservation and continue to Khalti on the next screen.</p></div>
          <Link className="mt-5 flex justify-center text-sm font-bold text-sportGreen hover:text-green-800" href={backToCourtsHref}>Back to courts</Link>
        </aside>
      </section>
    </main>
  );
}

function PhotoGallery({ venue }: { venue: PublicVenue }) {
  const images = getVenueImages(venue);
  const supportingImages = images.slice(1, 5);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);

  useEffect(() => {
    if (!isGalleryOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsGalleryOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isGalleryOpen]);

  if (images.length === 0) {
    return (
      <section className="sport-surface mt-4 flex aspect-[16/5] min-h-56 items-center justify-center overflow-hidden bg-sportNavy text-4xl font-bold text-white sm:min-h-72">
        <span className="flex h-20 w-20 items-center justify-center rounded-2xl border border-white/20 bg-white/10">{getInitials(venue.name)}</span>
      </section>
    );
  }

  return (
    <>
      <section className="sport-surface mt-4 overflow-hidden p-1.5 sm:p-2" aria-label={`${venue.name} photos`}>
        <div className={`grid gap-2 ${supportingImages.length ? "md:grid-cols-[1.55fr_1fr]" : ""}`}>
          <div className="relative min-w-0">
            <img alt={`${venue.name} venue`} className="h-56 w-full rounded-lg object-cover sm:h-72 md:h-[360px]" src={images[0]} />
            <button className="absolute bottom-3 right-3 inline-flex min-h-10 items-center gap-2 rounded-md bg-sportInk/90 px-3.5 py-2 text-xs font-bold text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-sportNavy focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-sportNavy" onClick={() => setIsGalleryOpen(true)} type="button">
              <PhotoIcon />
              View all photos
              <span className="text-white/70">{images.length}</span>
            </button>
          </div>

          {supportingImages.length ? (
            <div className={`grid gap-2 ${supportingImages.length < 3 ? "grid-cols-1" : "grid-cols-2"}`}>
              {supportingImages.map((image, index) => (
                <button aria-label={`Open ${venue.name} photo ${index + 2}`} className="group relative min-w-0 overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-sportGreen focus-visible:ring-offset-2" key={image} onClick={() => setIsGalleryOpen(true)} type="button">
                  <img alt={`${venue.name} view ${index + 2}`} className={`h-28 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02] sm:h-36 ${supportingImages.length === 1 ? "md:h-[360px]" : "md:h-[176px]"}`} src={image} />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {isGalleryOpen ? (
        <div aria-labelledby="venue-photo-dialog-title" aria-modal="true" className="fixed inset-0 z-50 overflow-y-auto bg-sportNavy/80 p-4 backdrop-blur-sm sm:p-6" role="dialog" onClick={() => setIsGalleryOpen(false)}>
          <div className="mx-auto max-w-6xl rounded-xl bg-white p-4 shadow-2xl sm:p-6" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="sport-eyebrow">Venue photos</p>
                <h2 className="mt-1 text-xl font-bold text-sportNavy" id="venue-photo-dialog-title">{venue.name}</h2>
                <p className="mt-1 text-sm text-slate-500">{images.length} photo{images.length === 1 ? "" : "s"}</p>
              </div>
              <button aria-label="Close photos" className="sport-icon-button shrink-0" onClick={() => setIsGalleryOpen(false)} type="button"><CloseIcon /></button>
            </div>
            <div className="mt-5 grid max-h-[72vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 sm:gap-3">
              {images.map((image, index) => (
                <img alt={`${venue.name} photo ${index + 1}`} className="aspect-[4/3] w-full rounded-lg object-cover" key={image} src={image} />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function InfoPanel({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="sport-surface p-5 sm:p-6">
      <h2 className="text-xl font-bold text-sportNavy">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function VenueFact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-50 text-sportGreen">{icon}</span><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-sportNavy">{value}</p></div></div>;
}

function SummaryRow({ label, strong = false, value }: { label: string; strong?: boolean; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className={`max-w-44 text-right ${strong ? "text-lg font-bold text-sportNavy" : "font-bold text-sportNavy"}`}>{value}</span>
    </div>
  );
}

function SectionLabel({ htmlFor, label }: { htmlFor?: string; label: string }) {
  return <label className="text-sm font-bold text-sportNavy" htmlFor={htmlFor}>{label}</label>;
}

function InlineState({ action, description, icon, title, tone = "neutral" }: { action?: React.ReactNode; description: string; icon?: React.ReactNode; title: string; tone?: "neutral" | "error" }) {
  return <div className={`flex flex-col items-start gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between ${tone === "error" ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}><div className="flex items-start gap-3">{icon ? <span className={`mt-0.5 ${tone === "error" ? "text-red-700" : "text-slate-500"}`}>{icon}</span> : null}<div><p className={`text-sm font-bold ${tone === "error" ? "text-red-950" : "text-sportNavy"}`}>{title}</p><p className={`mt-0.5 text-sm ${tone === "error" ? "text-red-800" : "text-slate-600"}`}>{description}</p></div></div>{action}</div>;
}

function SlotSkeleton() {
  return <div aria-label="Loading available times" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" role="status">{[1, 2, 3, 4, 5, 6].map((item) => <div className="h-[72px] animate-pulse rounded-lg border border-slate-200 bg-slate-50" key={item} />)}</div>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-3 w-3 rounded-sm ${color}`} />
      {label}
    </span>
  );
}

function formatNpr(value: string | number) {
  return `NPR ${Number(value).toLocaleString("en-NP")}`;
}

function CheckIcon() {
  return <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" /></svg>;
}

function CheckCircleIcon() {
  return <svg aria-hidden="true" className="ml-1 inline-block h-4 w-4 align-middle" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" /><path d="m8 12 2.5 2.5L16 9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
}

function LocationIcon() {
  return <svg aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /><circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" /></svg>;
}

function LinkIcon() {
  return <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24"><path d="M10 13.5a4 4 0 0 0 5.7.1l2-2a4 4 0 0 0-5.7-5.7l-1.1 1.1M14 10.5a4 4 0 0 0-5.7-.1l-2 2a4 4 0 0 0 5.7 5.7l1.1-1.1" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}

function ChevronLeftIcon() {
  return <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24"><path d="m14 6-6 6 6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
}

function ChevronRightIcon() {
  return <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24"><path d="m10 6 6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
}

function CalendarIcon() {
  return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M7 3v3m10-3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}

function CourtIcon() {
  return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><rect height="14" rx="1" stroke="currentColor" strokeWidth="1.8" width="18" x="3" y="5" /><path d="M8 5v14M16 5v14M3 12h18" stroke="currentColor" strokeWidth="1.8" /></svg>;
}

function ClockIcon() {
  return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" /><path d="M12 7v5l3 2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}

function MoneyIcon() {
  return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><rect height="14" rx="2" stroke="currentColor" strokeWidth="1.8" width="18" x="3" y="5" /><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" /><path d="M6 9h.01M18 15h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" /></svg>;
}

function PhotoIcon() {
  return <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24"><rect height="16" rx="2" stroke="currentColor" strokeWidth="1.8" width="18" x="3" y="4" /><circle cx="8" cy="9" r="1.5" stroke="currentColor" strokeWidth="1.8" /><path d="m4 17 5-5 3 3 2-2 6 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></svg>;
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


