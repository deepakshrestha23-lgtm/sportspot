"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";

import ConfirmActionModal from "@/components/ConfirmActionModal";
import FeedbackToast from "@/components/FeedbackToast";
import MediaImage from "@/components/MediaImage";
import TimeSelect from "@/components/TimeSelect";
import VenueLocationPicker, { type VenueLocationChange } from "@/components/owner/VenueLocationPicker";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getFileSizeError, getImageUploadError } from "@/lib/imageUpload";
import { addCalendarDays, buildTimeOptions, formatDateOnly, formatTimeValue, getLocalDateString } from "@/lib/dates";
import { isVenueMapUrl } from "@/lib/maps";
import { estimateGeneratedSlots } from "@/lib/slotSchedule";
import type { Court, Venue, VenuePhoto, VenuePhotoCategory } from "@/types/venue";

const facilitiesOptions = [
  "Parking",
  "Changing Room",
  "Washroom",
  "Drinking Water",
  "Cafe / Shop",
  "Flood Lights",
  "Seating Area",
  "Equipment Rental",
  "First Aid",
];

const ruleTemplates = [
  "Players must arrive at least 10 minutes before the booked slot.",
  "Outside shoes are not allowed inside the play area.",
  "Booking time includes warm-up and court exit time.",
  "Damage to venue property must be reported and settled before leaving.",
];

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const today = getLocalDateString();
const maximumGenerationDate = addCalendarDays(today, 89);

const documentTypes = [
  { value: "BUSINESS_REGISTRATION", label: "Business registration document" },
  { value: "PAN_VAT", label: "PAN/VAT document" },
  { value: "RENTAL_LEASE", label: "Rental/lease agreement" },
  { value: "UTILITY_BILL", label: "Utility bill with venue name/address" },
  { value: "PERMISSION_LETTER", label: "Permission letter from venue owner" },
];

type VenueForm = {
  name: string;
  description: string;
  address: string;
  city: string;
  area: string;
  latitude: number | null;
  longitude: number | null;
  location_source: string;
  location_confirmed: boolean;
  map_location: string;
  contact_phone: string;
  opening_time: string;
  closing_time: string;
  facilities: string[];
  rules: string;
  cancellation_policy: string;
  cancellation_full_refund_hours: string;
  cancellation_partial_refund_enabled: boolean;
  cancellation_partial_refund_hours: string;
  cancellation_partial_refund_percent: string;
  verification_document_type: string;
  declaration_accepted: boolean;
};

type VenueLegacyPhotoField = "front_photo" | "court_area_photo" | "additional_photo";

const legacyPhotoLabels: Record<VenueLegacyPhotoField, string> = {
  front_photo: "Outside / front photo",
  court_area_photo: "Court / play area photo",
  additional_photo: "Additional venue photo",
};

type CourtForm = {
  name: string;
  description: string;
  court_type: string;
  surface_type: string;
  is_active: boolean;
  court_photo: File | null;
};

type ReferenceOption = { value: string; label: string };
type DiscoveryReferenceResponse = {
  filters?: {
    districts?: ReferenceOption[];
    areas_by_district?: Record<string, ReferenceOption[]>;
  };
};

export default function VenueSetupPage() {
  const [step, setStep] = useState(1);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [courts, setCourts] = useState<Court[]>([]);
  const [venuePhotos, setVenuePhotos] = useState<VenuePhoto[]>([]);
  const [districtOptions, setDistrictOptions] = useState<ReferenceOption[]>([]);
  const [areasByDistrict, setAreasByDistrict] = useState<Record<string, ReferenceOption[]>>({});
  const [form, setForm] = useState<VenueForm>({
    name: "",
    description: "",
    address: "",
    city: "Kathmandu",
    area: "",
    latitude: null,
    longitude: null,
    location_source: "",
    location_confirmed: false,
    map_location: "",
    contact_phone: "",
    opening_time: "06:00",
    closing_time: "20:00",
    facilities: [],
    rules: "",
    cancellation_policy: "",
    cancellation_full_refund_hours: "24",
    cancellation_partial_refund_enabled: true,
    cancellation_partial_refund_hours: "12",
    cancellation_partial_refund_percent: "50",
    verification_document_type: "BUSINESS_REGISTRATION",
    declaration_accepted: false,
  });
  const [courtForm, setCourtForm] = useState<CourtForm>({
    name: "",
    description: "",
    court_type: "INDOOR",
    surface_type: "TURF",
    is_active: true,
    court_photo: null,
  });
  const [slotForm, setSlotForm] = useState({
    available_days: ["Saturday", "Sunday"],
    start_date: today,
    end_date: addCalendarDays(today, 29),
    opening_time: "06:00",
    closing_time: "20:00",
    slot_duration_minutes: "60",
    price_30: "800",
    price_60: "1500",
    price_90: "2200",
  });
  const [files, setFiles] = useState<Record<string, File | null>>({
    front_photo: null,
    court_area_photo: null,
    additional_photo: null,
    verification_document: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [clearConfirmCourtId, setClearConfirmCourtId] = useState<number | null>(null);
  const [pendingLegacyPhotoRemoval, setPendingLegacyPhotoRemoval] = useState<VenueLegacyPhotoField | null>(null);
  const [pendingGalleryPhotoId, setPendingGalleryPhotoId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const requestedStep = Number(new URLSearchParams(window.location.search).get("step"));
    if (requestedStep >= 1 && requestedStep <= 4) setStep(requestedStep);
    loadSetup();
  }, []);

  async function loadSetup() {
    setIsLoading(true);
    setError("");
    try {
      const [venueResponse, courtsResponse, referenceResponse] = await Promise.all([
        api.get<{ venue: Venue | null }>("/api/venues/owner/venue/"),
        api.get<{ courts: Court[] }>("/api/venues/owner/courts/").catch(() => ({ data: { courts: [] } })),
        api.get<DiscoveryReferenceResponse>("/api/venues/discovery/reference/").catch(() => null),
      ]);
      setDistrictOptions(referenceResponse?.data.filters?.districts || []);
      setAreasByDistrict(referenceResponse?.data.filters?.areas_by_district || {});
      const currentVenue = venueResponse.data.venue;
      setVenue(currentVenue);
      setCourts(courtsResponse.data.courts);
      if (currentVenue) {
        await loadVenuePhotos();
      }
      if (currentVenue) {
        setForm({
          name: currentVenue.name || "",
          description: currentVenue.description || "",
          address: currentVenue.address || "",
          city: currentVenue.city || "Kathmandu",
          area: currentVenue.area || "",
          latitude: currentVenue.latitude === null ? null : Number(currentVenue.latitude),
          longitude: currentVenue.longitude === null ? null : Number(currentVenue.longitude),
          location_source: currentVenue.location_source || "",
          location_confirmed: Boolean(currentVenue.location_confirmed),
          map_location: currentVenue.map_location || "",
          contact_phone: currentVenue.contact_phone || "",
          opening_time: toInputTime(currentVenue.opening_time) || "06:00",
          closing_time: toInputTime(currentVenue.closing_time) || "20:00",
          facilities: currentVenue.facilities || [],
          rules: currentVenue.rules || "",
          cancellation_policy: currentVenue.cancellation_policy || "",
          cancellation_full_refund_hours: String(currentVenue.cancellation_full_refund_hours || 24),
          cancellation_partial_refund_enabled: currentVenue.cancellation_partial_refund_enabled,
          cancellation_partial_refund_hours: String(currentVenue.cancellation_partial_refund_hours || 12),
          cancellation_partial_refund_percent: String(currentVenue.cancellation_partial_refund_percent || 50),
          verification_document_type: currentVenue.verification_document_type || "BUSINESS_REGISTRATION",
          declaration_accepted: Boolean(currentVenue.declaration_accepted),
        });
        setSlotForm((current) => ({
          ...current,
          opening_time: toInputTime(currentVenue.opening_time) || current.opening_time,
          closing_time: toInputTime(currentVenue.closing_time) || current.closing_time,
        }));
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load venue setup."));
    } finally {
      setIsLoading(false);
    }
  }

  const selectedBasePrice = getSelectedBasePrice(slotForm);
  const availableDistricts = useMemo(
    () => mergeReferenceOption(districtOptions, form.city),
    [districtOptions, form.city],
  );
  const availableAreas = useMemo(
    () => mergeReferenceOption(areasByDistrict[form.city] || [], form.area),
    [areasByDistrict, form.area, form.city],
  );
  const isApprovedVenue = venue?.status === "APPROVED";
  const hasMajorChanges = Boolean(isApprovedVenue && venue && detectMajorVenueChanges(venue, form, files));
  const hasOutsideVenuePhoto = Boolean(venue?.front_photo || venuePhotos.some((photo) => photo.category === "OUTSIDE"));
  const hasCourtAreaPhoto = Boolean(venue?.court_area_photo || venuePhotos.some((photo) => photo.category === "COURT_AREA"));
  const hasUnconfirmedLocationChange = Boolean(
    isApprovedVenue &&
      venue &&
      hasVenueCoordinateChanges(venue, form) &&
      form.latitude !== null &&
      form.longitude !== null &&
      !form.location_confirmed,
  );
  const feedbackMessage = error || message;
  const feedbackType = error ? "error" : message ? "success" : "info";
  const estimatedSlots = estimateGeneratedSlots({
    startDate: slotForm.start_date,
    endDate: slotForm.end_date,
    availableDays: slotForm.available_days,
    openingTime: slotForm.opening_time,
    closingTime: slotForm.closing_time,
    durationMinutes: slotForm.slot_duration_minutes,
  });
  const canSubmitInitialApproval = useMemo(() => {
    return Boolean(courts.length > 0 && form.declaration_accepted && form.verification_document_type && hasOutsideVenuePhoto && hasCourtAreaPhoto);
  }, [courts.length, form.declaration_accepted, form.verification_document_type, hasOutsideVenuePhoto, hasCourtAreaPhoto]);
  const canSubmitMajorReview = Boolean(isApprovedVenue && hasMajorChanges && !hasUnconfirmedLocationChange);
  const canSubmitPrimaryAction = isApprovedVenue ? (hasMajorChanges ? canSubmitMajorReview : true) : canSubmitInitialApproval;

  function clearFeedback() {
    setMessage("");
    setError("");
  }

  async function saveVenueDraft({
    submitForReview = false,
    replacement,
    clearPhotoField,
  }: {
    submitForReview?: boolean;
    replacement?: { field: VenueLegacyPhotoField; file: File };
    clearPhotoField?: VenueLegacyPhotoField;
  } = {}) {
    if (form.map_location.trim() && !isVenueMapUrl(form.map_location.trim())) {
      setError("Enter a valid HTTPS link from Google Maps, OpenStreetMap, Apple Maps, or Bing Maps.");
      setMessage("");
      return null;
    }
    if (!isCancellationPolicyValid(form)) {
      setError("Fix the cancellation policy values before saving. Full refund must be 2-168 hours, and the partial tier must start earlier with a 1-99% refund.");
      setMessage("");
      return null;
    }
    if (isApprovedVenue && hasMajorChanges && !submitForReview) {
      setError("Venue name, address, map location, or legal document changes require admin review. Use Submit Major Changes for Review.");
      setMessage("");
      return null;
    }

    setIsSaving(true);
    setMessage("");
    setError("");
    try {
      const payload = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        payload.append(key, Array.isArray(value) ? JSON.stringify(value) : value === null ? "" : String(value));
      });
      Object.entries(files).forEach(([key, file]) => {
        if (file) payload.append(key, file);
      });
      if (replacement) payload.append(replacement.field, replacement.file);
      if (clearPhotoField && !replacement) payload.append(`clear_${clearPhotoField}`, "true");
      payload.append("submit_for_review", String(submitForReview));
      const response = await api.post<{ venue: Venue }>("/api/venues/owner/venue/", payload);
      setVenue(response.data.venue);
      setMessage(
        submitForReview
          ? "Major venue changes submitted for admin review."
          : isApprovedVenue
            ? "Safe changes saved. Your venue remains approved."
            : "Draft saved successfully.",
      );
      return response.data.venue;
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not save venue draft."));
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  async function loadVenuePhotos() {
    try {
      const response = await api.get<{ photos: VenuePhoto[] }>("/api/venues/owner/venue/photos/");
      setVenuePhotos(response.data.photos);
    } catch {
      setVenuePhotos([]);
    }
  }

  async function uploadVenuePhotos(category: VenuePhotoCategory, event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = "";
    if (selectedFiles.length === 0) return;
    const imageError = selectedFiles.map((file) => getImageUploadError(file, "Venue photo")).find(Boolean);
    if (imageError) { setMessage(""); setError(imageError); return; }

    let activeVenue = venue;
    if (!activeVenue) {
      activeVenue = await saveVenueDraft();
    }
    if (!activeVenue) return;

    setIsSaving(true);
    setMessage("");
    setError("");
    try {
      const payload = new FormData();
      payload.append("category", category);
      selectedFiles.forEach((file) => payload.append("images", file));
      await api.post("/api/venues/owner/venue/photos/", payload);
      await loadVenuePhotos();
      setMessage("Venue photos saved safely. This does not require admin review.");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not upload venue photos."));
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteVenuePhoto(photoId: number) {
    setIsSaving(true);
    setMessage("");
    setError("");
    try {
      await api.delete(`/api/venues/owner/venue/photos/${photoId}/`);
      await loadVenuePhotos();
      setMessage("Venue photo removed.");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not remove venue photo."));
    } finally {
      setIsSaving(false);
    }
  }

  async function replaceLegacyPhoto(field: VenueLegacyPhotoField, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) return;
    const imageError = getImageUploadError(file, legacyPhotoLabels[field]);
    if (imageError) { setMessage(""); setError(imageError); return; }

    const savedVenue = await saveVenueDraft({ replacement: { field, file } });
    if (savedVenue) {
      setFiles((current) => ({ ...current, [field]: null }));
      setMessage(`${legacyPhotoLabels[field]} replaced successfully.`);
    }
  }

  async function removeLegacyPhoto(field: VenueLegacyPhotoField) {
    const savedVenue = await saveVenueDraft({ clearPhotoField: field });
    if (savedVenue) {
      setPendingLegacyPhotoRemoval(null);
      setMessage(`${legacyPhotoLabels[field]} removed. Add a replacement before submitting for approval.`);
    }
  }

  async function removeGalleryPhoto() {
    if (pendingGalleryPhotoId === null) return;
    const photoId = pendingGalleryPhotoId;
    setPendingGalleryPhotoId(null);
    await deleteVenuePhoto(photoId);
  }

  async function addCourt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const savedVenue = venue || (await saveVenueDraft());
    if (!savedVenue) return;

    setIsSaving(true);
    setMessage("");
    setError("");
    try {
      const payload = new FormData();
      payload.append("name", courtForm.name);
      payload.append("description", courtForm.description);
      payload.append("court_type", courtForm.court_type);
      payload.append("surface_type", courtForm.surface_type);
      payload.append("is_active", String(courtForm.is_active));
      if (courtForm.court_photo) payload.append("court_photo", courtForm.court_photo);

      const response = await api.post<{ court: Court }>("/api/venues/owner/courts/", payload);
      setCourts((current) => [...current, response.data.court]);
      setCourtForm({ name: "", description: "", court_type: "INDOOR", surface_type: "TURF", is_active: true, court_photo: null });
      setMessage("Court added successfully.");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not add court."));
    } finally {
      setIsSaving(false);
    }
  }

  async function generateSlots(courtId: number) {
    setIsSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await api.post<{
        created_count: number;
        skipped_count: number;
        existing_count: number;
        overlap_count: number;
        skipped_past_count: number;
        trailing_minutes: number;
        start_date: string;
        end_date: string;
      }>(`/api/venues/owner/courts/${courtId}/slots/generate/`, {
        available_days: slotForm.available_days,
        start_date: slotForm.start_date,
        end_date: slotForm.end_date,
        opening_time: slotForm.opening_time,
        closing_time: slotForm.closing_time,
        slot_duration_minutes: slotForm.slot_duration_minutes,
        base_price: selectedBasePrice,
      });
      const notes = [
        response.data.existing_count ? `${response.data.existing_count} existing slots kept` : "",
        response.data.overlap_count ? `${response.data.overlap_count} overlapping slots skipped` : "",
        response.data.skipped_past_count ? `${response.data.skipped_past_count} past slots skipped` : "",
        response.data.trailing_minutes ? `${response.data.trailing_minutes} minutes left unused at the end of each selected day` : "",
      ].filter(Boolean);
      setMessage(
        `Created ${response.data.created_count} slots from ${formatDateOnly(response.data.start_date)} to ${formatDateOnly(response.data.end_date)}.${notes.length ? ` ${notes.join(". ")}.` : ""}`,
      );
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not generate slots."));
    } finally {
      setIsSaving(false);
    }
  }

  async function clearFutureSlots(courtId: number) {
    setIsSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await api.post<{
        cleared_count: number;
        protected_count: number;
        start_date: string;
        end_date: string;
      }>(`/api/venues/owner/courts/${courtId}/slots/clear/`, {
        start_date: slotForm.start_date,
        end_date: slotForm.end_date,
      });
      setMessage(
        response.data.cleared_count
          ? `Cleared ${response.data.cleared_count} future unbooked slots from ${formatDateOnly(response.data.start_date)} to ${formatDateOnly(response.data.end_date)}. ${response.data.protected_count} slots were kept protected.`
          : `No future unbooked slots were cleared. ${response.data.protected_count} slots in this range were kept protected.`,
      );
      setClearConfirmCourtId(null);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not clear future availability."));
    } finally {
      setIsSaving(false);
    }
  }

  function updateSlotGenerationRange(field: "start_date" | "end_date", value: string) {
    setSlotForm((current) => {
      if (field === "start_date") {
        return { ...current, start_date: value, end_date: current.end_date < value ? value : current.end_date };
      }
      return { ...current, end_date: value };
    });
  }

  async function submitForApproval() {
    if (isApprovedVenue) {
      if (hasMajorChanges && hasUnconfirmedLocationChange) {
        setError("Confirm the new venue pin before submitting this location change for admin review.");
        setMessage("");
        return;
      }
      const savedVenue = await saveVenueDraft({ submitForReview: hasMajorChanges });
      if (savedVenue) setStep(4);
      return;
    }

    const savedVenue = await saveVenueDraft();
    if (!savedVenue) return;

    setIsSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await api.post<{ venue: Venue }>("/api/venues/owner/venue/submit/");
      setVenue(response.data.venue);
      setMessage("Venue submitted for admin approval.");
      setStep(4);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not submit venue for approval."));
    } finally {
      setIsSaving(false);
    }
  }

  function updateFile(event: ChangeEvent<HTMLInputElement>, key: string) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (file) {
      const fileError = getFileSizeError(file, key === "verification_document" ? "Verification document" : "File");
      if (fileError) { setMessage(""); setError(fileError); return; }
    }
    setFiles((current) => ({ ...current, [key]: file }));
  }

  function updateCourtPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) { setCourtForm((current) => ({ ...current, court_photo: null })); return; }
    const imageError = getImageUploadError(file, "Court photo");
    if (imageError) { setMessage(""); setError(imageError); return; }
    setCourtForm((current) => ({ ...current, court_photo: file }));
  }

  function appendRule(rule: string) {
    if (form.rules.includes(rule)) return;
    setForm({ ...form, rules: form.rules ? `${form.rules}\n${rule}` : rule });
  }

  function updateVenueLocation(location: VenueLocationChange) {
    setForm((current) => ({
      ...current,
      address: location.displayName || current.address,
      city: location.district || current.city,
      area: location.area || current.area,
      latitude: roundCoordinate(location.latitude),
      longitude: roundCoordinate(location.longitude),
      location_source: location.source,
      location_confirmed: false,
    }));
  }

  function clearVenueLocation() {
    setForm((current) => ({
      ...current,
      latitude: null,
      longitude: null,
      location_source: "",
      location_confirmed: false,
    }));
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">Loading venue setup...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <FeedbackToast message={feedbackMessage} onClose={clearFeedback} type={feedbackType} />

      <div className="owner-venue-hero rounded-lg bg-sportNavy p-6 text-white shadow-sm">
        <p className="text-sm font-black uppercase tracking-wide text-green-300">Venue Setup</p>
        <h1 className="mt-2 text-3xl font-black">Set up your Cricksal venue</h1>
        <p className="mt-3 text-slate-300">Complete these steps to make your courts bookable after admin approval.</p>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-4">
        {["Venue Details", "Court Setup", "Slots & Pricing", "Verification"].map((label, index) => (
          <button
            className={`rounded-md border px-4 py-3 text-left text-sm font-black ${
              step === index + 1 ? "border-sportGreen bg-green-50 text-sportGreen" : "border-slate-200 bg-white text-slate-600"
            }`}
            key={label}
            onClick={() => setStep(index + 1)}
            type="button"
          >
            <span className="block text-xs uppercase tracking-wide">Step {index + 1}</span>
            {label}
          </button>
        ))}
      </div>

      {isApprovedVenue ? (
        <div className={`mt-5 rounded-lg border p-4 text-sm ${hasMajorChanges ? "border-amber-200 bg-amber-50 text-amber-900" : "border-green-200 bg-green-50 text-green-900"}`}>
          <p className="font-black">{hasMajorChanges ? "Admin review required for these changes" : "Safe edit mode"}</p>
          <p className="mt-1 leading-6">
            Safe edits save directly: description, facilities, rules, cancellation policy, contact phone, opening hours, venue photos, court/play photos, additional photos, slots, and pricing.
            Major edits need review: venue name, address, city, area, map location, legal document type, or legal document upload.
          </p>
        </div>
      ) : null}

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {step === 1 ? (
          <div className="space-y-5">
            <SectionHeader title="Venue Details" description="Tell players where your Cricksal venue is and what they should expect." />
            <div className="grid gap-4 md:grid-cols-2">
              <Input label="Venue Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
              <Input label="Contact Phone" value={form.contact_phone} onChange={(value) => setForm({ ...form, contact_phone: onlyPhone(value) })} />
              <Input label="Address" value={form.address} onChange={(value) => setForm({ ...form, address: value })} />
              <Select label="District" value={form.city} onChange={(value) => setForm((current) => ({ ...current, city: value, area: "" }))} options={availableDistricts.map((item) => item.value)} labels={Object.fromEntries(availableDistricts.map((item) => [item.value, item.label]))} />
              <Select label="Area" value={form.area} onChange={(value) => setForm({ ...form, area: value })} options={availableAreas.map((item) => item.value)} labels={Object.fromEntries(availableAreas.map((item) => [item.value, item.label]))} />
              <p className="-mt-2 text-xs leading-5 text-slate-500 md:col-span-2">Choose the area players will use to discover this venue. The confirmed map pin stores the exact entrance for directions.</p>
              <TimeSelectField label="Opening Time" value={form.opening_time} onChange={(value) => setForm({ ...form, opening_time: value })} />
              <TimeSelectField label="Closing Time" value={form.closing_time} onChange={(value) => setForm({ ...form, closing_time: value })} />
            </div>
            <VenueLocationPicker
              address={form.address}
              confirmed={form.location_confirmed}
              latitude={form.latitude}
              longitude={form.longitude}
              mapLocation={form.map_location}
              onChange={updateVenueLocation}
              onClear={clearVenueLocation}
              onMapLocationChange={(value) => setForm((current) => ({ ...current, map_location: value }))}
              onConfirm={() => setForm((current) => ({ ...current, location_confirmed: true }))}
              source={form.location_source}
            />
            <Textarea label="Description" value={form.description} onChange={(value) => setForm({ ...form, description: value })} />
            <div>
              <p className="text-sm font-black text-sportNavy">Sport</p>
              <span className="mt-2 inline-flex rounded-full bg-green-100 px-3 py-1 text-sm font-black text-green-800">Cricksal</span>
            </div>
            <Facilities form={form} setForm={setForm} />
            <div>
              <Textarea label="Rules / Instructions" value={form.rules} onChange={(value) => setForm({ ...form, rules: value })} />
              <div className="mt-3 flex flex-wrap gap-2">
                {ruleTemplates.map((rule) => (
                  <button className="rounded-full border border-green-200 px-3 py-1.5 text-xs font-black text-sportGreen hover:bg-green-50" key={rule} onClick={() => appendRule(rule)} type="button">
                    Add rule
                  </button>
                ))}
              </div>
            </div>
            <CancellationPolicyEditor form={form} setForm={setForm} />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-6">
            <SectionHeader title="Court Setup" description="Add each physical Cricksal court separately so players know exactly what they are booking." />
            <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
              <form className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-5" onSubmit={addCourt}>
                <div className="grid gap-4 md:grid-cols-2">
                  <Input label="Court Name" value={courtForm.name} onChange={(value) => setCourtForm({ ...courtForm, name: value })} />
                  <Select label="Court Type" value={courtForm.court_type} onChange={(value) => setCourtForm({ ...courtForm, court_type: value })} options={["INDOOR", "OUTDOOR", "COVERED"]} />
                  <Select label="Surface Type" value={courtForm.surface_type} onChange={(value) => setCourtForm({ ...courtForm, surface_type: value })} options={["TURF", "MAT", "CEMENT", "ARTIFICIAL_TURF"]} />
                  <FileInput label="Court Photo Optional (JPG, JPEG or PNG, up to 5 MB)" onChange={updateCourtPhoto} />
                </div>
                <Textarea label="Court Description" value={courtForm.description} onChange={(value) => setCourtForm({ ...courtForm, description: value })} />
                <label className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700">
                  <span>Make this court visible after venue approval</span>
                  <input checked={courtForm.is_active} onChange={(event) => setCourtForm({ ...courtForm, is_active: event.target.checked })} type="checkbox" />
                </label>
                <button className="w-full rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" disabled={isSaving} type="submit">
                  {isSaving ? "Adding..." : "Add Court"}
                </button>
              </form>

              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <h3 className="font-black text-sportNavy">Current Courts</h3>
                <p className="mt-1 text-sm text-slate-600">One venue can have multiple courts. Add every separate play area here.</p>
                <div className="mt-4 space-y-3">
                  {courts.length === 0 ? (
                    <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">No courts added yet.</p>
                  ) : (
                    courts.map((court, index) => (
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-4" key={court.id}>
                        <p className="text-xs font-black uppercase tracking-wide text-sportGreen">Court {index + 1}</p>
                        <h4 className="mt-1 font-black text-sportNavy">{court.name}</h4>
                        <p className="mt-1 text-sm text-slate-600">{formatChoice(court.court_type)} · {formatChoice(court.surface_type)}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-6">
            <SectionHeader title="Slots & Pricing" description="Set the weekly hours and publish concrete bookable slots for a date range you control." />
            <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                <div className="rounded-md border border-slate-200 bg-white p-4">
                  <h3 className="font-black text-sportNavy">Publishing window</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-600">The selected weekdays repeat between these dates. You can publish up to 90 days at a time.</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Input label="Generate from" type="date" min={today} max={maximumGenerationDate} value={slotForm.start_date} onChange={(value) => updateSlotGenerationRange("start_date", value)} />
                    <Input label="Generate until" type="date" min={slotForm.start_date} max={maximumGenerationDate} value={slotForm.end_date} onChange={(value) => updateSlotGenerationRange("end_date", value)} />
                  </div>
                  <p className="mt-3 text-xs font-semibold text-slate-600">Estimated: up to <strong className="text-sportNavy">{estimatedSlots.toLocaleString()}</strong> slots per court.</p>
                  <span className="mt-3 inline-flex rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-black text-green-800">Nepal time</span>
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <TimeSelectField label="Opening time" value={slotForm.opening_time} onChange={(value) => setSlotForm({ ...slotForm, opening_time: value })} />
                  <TimeSelectField label="Closing time" value={slotForm.closing_time} onChange={(value) => setSlotForm({ ...slotForm, closing_time: value })} />
                </div>
                <div className="mt-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-black text-sportNavy">Available weekdays</p>
                    <div className="flex gap-2 text-xs font-black">
                      <button className="rounded-md border border-slate-300 px-2.5 py-1.5 text-slate-600 hover:border-sportGreen hover:text-sportGreen" onClick={() => setSlotForm({ ...slotForm, available_days: days })} type="button">Every day</button>
                      <button className="rounded-md border border-slate-300 px-2.5 py-1.5 text-slate-600 hover:border-sportGreen hover:text-sportGreen" onClick={() => setSlotForm({ ...slotForm, available_days: ["Saturday", "Sunday"] })} type="button">Weekends</button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {days.map((day) => (
                      <label className="flex min-h-11 items-center gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700" key={day}>
                        <input
                          checked={slotForm.available_days.includes(day)}
                          onChange={(event) =>
                            setSlotForm({
                              ...slotForm,
                              available_days: event.target.checked
                                ? [...slotForm.available_days, day]
                                : slotForm.available_days.filter((item) => item !== day),
                            })
                          }
                          type="checkbox"
                        />
                        {day}
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{slotForm.available_days.length} of 7 days selected</p>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <h3 className="font-black text-sportNavy">Duration and Price Table</h3>
                <p className="mt-1 text-sm text-slate-600">Set prices for common booking lengths. The selected duration is used when generating slots.</p>
                <div className="mt-4 grid gap-3">
                  <PriceRow duration="30" selected={slotForm.slot_duration_minutes === "30"} price={slotForm.price_30} onSelect={() => setSlotForm({ ...slotForm, slot_duration_minutes: "30" })} onPriceChange={(value) => setSlotForm({ ...slotForm, price_30: onlyNumber(value) })} />
                  <PriceRow duration="60" selected={slotForm.slot_duration_minutes === "60"} price={slotForm.price_60} onSelect={() => setSlotForm({ ...slotForm, slot_duration_minutes: "60" })} onPriceChange={(value) => setSlotForm({ ...slotForm, price_60: onlyNumber(value) })} />
                  <PriceRow duration="90" selected={slotForm.slot_duration_minutes === "90"} price={slotForm.price_90} onSelect={() => setSlotForm({ ...slotForm, slot_duration_minutes: "90" })} onPriceChange={(value) => setSlotForm({ ...slotForm, price_90: onlyNumber(value) })} />
                </div>
                <div className="mt-5 rounded-md bg-green-50 p-4 text-sm font-semibold text-green-800">
                  Generating {slotForm.slot_duration_minutes}-minute slots at NPR {Number(selectedBasePrice || 0).toLocaleString()} per slot. This price applies to new slots only; existing slots and bookings are never changed.
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {courts.map((court) => (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4" key={court.id}>
                  <p className="font-black text-sportNavy">{court.name}</p>
                  <p className="mt-1 text-sm text-slate-600">Creates {slotForm.slot_duration_minutes}-minute slots from {formatDateOnly(slotForm.start_date)} to {formatDateOnly(slotForm.end_date)} and skips duplicates.</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      className="rounded-md bg-sportGreen px-3 py-2 text-sm font-black text-white hover:bg-green-700 disabled:opacity-60"
                      disabled={isSaving}
                      onClick={() => generateSlots(court.id)}
                      type="button"
                    >
                      {isSaving ? "Working..." : "Generate Slots"}
                    </button>
                    <button
                      className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-black text-red-700 hover:bg-red-50 disabled:opacity-60"
                      disabled={isSaving}
                      onClick={() => setClearConfirmCourtId(court.id)}
                      type="button"
                    >
                      Clear Unbooked
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {clearConfirmCourtId !== null ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-950" role="alertdialog" aria-label="Confirm clearing future availability">
                <p className="font-black">Clear future unbooked slots for {courts.find((court) => court.id === clearConfirmCourtId)?.name || "this court"}?</p>
                <p className="mt-2 leading-6">
                  Only future available slots from {formatDateOnly(slotForm.start_date)} to {formatDateOnly(slotForm.end_date)} will be removed. Booked, reserved, blocked, past, and historical slots stay untouched. This cannot be undone.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className="rounded-md bg-red-700 px-4 py-2.5 text-sm font-black text-white hover:bg-red-800 disabled:opacity-60" disabled={isSaving} onClick={() => clearFutureSlots(clearConfirmCourtId)} type="button">
                    {isSaving ? "Clearing..." : "Clear Unbooked Slots"}
                  </button>
                  <button className="rounded-md border border-red-200 bg-white px-4 py-2.5 text-sm font-black text-red-800 hover:bg-red-100" disabled={isSaving} onClick={() => setClearConfirmCourtId(null)} type="button">
                    Keep Slots
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 4 ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
            <div className="space-y-5">
              <SectionHeader title="Final Verification" description="Review your details before submitting. Admin approval protects players from fake or incomplete venues." />
              <div className="grid gap-4 md:grid-cols-2">
                <ReviewCard title="Venue Details" items={[["Venue Name", form.name || "Not added"], ["Location", `${form.area || "Area"}, ${form.city}`], ["Operating Hours", `${formatTimeValue(form.opening_time)} - ${formatTimeValue(form.closing_time)}`]]} onEdit={() => setStep(1)} />
                <ReviewCard title="Facilities" items={(form.facilities.length ? form.facilities : ["No facilities selected"]).map((item) => ["", item])} onEdit={() => setStep(1)} />
                <ReviewCard
                  title="Rules & Cancellation"
                  items={[
                    ["Rules", form.rules || "Not added"],
                    ...getCancellationPolicySummary(form).map((item) => ["", item]),
                    ["Additional Notes", form.cancellation_policy || "None"],
                  ]}
                  onEdit={() => setStep(1)}
                />
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black text-sportNavy">Venue Photos</h3>
                    <p className="mt-1 text-sm text-slate-600">Upload clear photos so players and admin can trust the venue before booking.</p>
                  </div>
                  <p className="hidden text-xs font-semibold text-slate-500 sm:block">Required: outside + court area</p>
                </div>
                <div className="mt-4 space-y-5">
                  <VenuePhotoManager
                    category="OUTSIDE"
                    description="Entrance, signboard, exterior, or road-facing front view."
                    legacyField="front_photo"
                    legacyPhotoUrl={venue?.front_photo || ""}
                    onDelete={(photoId) => setPendingGalleryPhotoId(photoId)}
                    onRemoveLegacy={() => setPendingLegacyPhotoRemoval("front_photo")}
                    onReplaceLegacy={replaceLegacyPhoto}
                    onUpload={uploadVenuePhotos}
                    photos={venuePhotos}
                    required
                    title="Outside / Front Photos"
                  />
                  <VenuePhotoManager
                    category="COURT_AREA"
                    description="Main playable area, pitch/court surface, nets, lights, and boundaries."
                    legacyField="court_area_photo"
                    legacyPhotoUrl={venue?.court_area_photo || ""}
                    onDelete={(photoId) => setPendingGalleryPhotoId(photoId)}
                    onRemoveLegacy={() => setPendingLegacyPhotoRemoval("court_area_photo")}
                    onReplaceLegacy={replaceLegacyPhoto}
                    onUpload={uploadVenuePhotos}
                    photos={venuePhotos}
                    required
                    title="Court / Play Area Photos"
                  />
                  <VenuePhotoManager
                    category="ADDITIONAL"
                    description="Parking, seating, changing room, washroom, shop, or other facilities."
                    legacyField="additional_photo"
                    legacyPhotoUrl={venue?.additional_photo || ""}
                    onDelete={(photoId) => setPendingGalleryPhotoId(photoId)}
                    onRemoveLegacy={() => setPendingLegacyPhotoRemoval("additional_photo")}
                    onReplaceLegacy={replaceLegacyPhoto}
                    onUpload={uploadVenuePhotos}
                    photos={venuePhotos}
                    title="Additional Photos"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <h3 className="text-lg font-black text-sportNavy">Legal Verification Document</h3>
                <p className="mt-1 text-sm text-slate-600">Select one document type and upload the matching proof.</p>
                <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr]">
                  <Select
                    label="Document Type"
                    value={form.verification_document_type}
                    onChange={(value) => setForm({ ...form, verification_document_type: value })}
                    options={documentTypes.map((item) => item.value)}
                    labels={Object.fromEntries(documentTypes.map((item) => [item.value, item.label]))}
                  />
                  <FileInput label="Upload Selected Document" accept=".jpg,.jpeg,.png,.pdf" onChange={(event) => updateFile(event, "verification_document")} />
                </div>
              </div>

              <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
                <input
                  checked={form.declaration_accepted}
                  className="mt-1"
                  onChange={(event) => setForm({ ...form, declaration_accepted: event.target.checked })}
                  type="checkbox"
                />
                I confirm that I am authorized to register this venue and the information provided is correct.
              </label>
            </div>

            <aside className="rounded-lg bg-sportNavy p-5 text-white shadow-sm lg:sticky lg:top-24 lg:self-start">
              <p className="text-xs font-black uppercase tracking-wide text-green-300">{isApprovedVenue ? "Venue protection" : "Safe & Secure"}</p>
              <h3 className="mt-3 text-2xl font-black">{isApprovedVenue ? (hasMajorChanges ? "Review changes before publishing" : "Keep your venue up to date") : "Ready to Go Live?"}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {isApprovedVenue
                  ? hasMajorChanges
                    ? "Identity and map changes are held for admin review. Your current approved listing remains protected until the review is complete."
                    : "Operational edits can be saved directly while your approved listing stays bookable."
                  : "Submit your Cricksal venue for admin verification. Players can book only after approval."}
              </p>
              <div className="mt-5 space-y-2 text-sm text-slate-300">
                <p>Courts added: <strong className="text-white">{courts.length}</strong></p>
                <p>Selected slot: <strong className="text-white">{slotForm.slot_duration_minutes} min</strong></p>
                <p>Base price: <strong className="text-white">Rs {Number(selectedBasePrice || 0).toLocaleString()}</strong></p>
              </div>
              {isApprovedVenue && hasMajorChanges ? (
                <div className={`mt-5 rounded-md border px-3 py-3 text-xs leading-5 ${hasUnconfirmedLocationChange ? "border-amber-300/40 bg-amber-400/10 text-amber-100" : "border-green-300/30 bg-green-400/10 text-green-100"}`} role="status">
                  {hasUnconfirmedLocationChange
                    ? "Confirm the new pin in the location panel before sending it for review."
                    : "The review request is ready. Admin approval is required before this change becomes public."}
                </div>
              ) : null}
              <button className="mt-5 w-full rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-slate-500" disabled={isSaving || !canSubmitPrimaryAction} onClick={submitForApproval} type="button">
                {isApprovedVenue ? (hasMajorChanges ? "Submit Major Changes for Review" : "Save Safe Changes") : "Submit for Verification"}
              </button>
              {!isApprovedVenue ? (
                <button className="mt-3 w-full rounded-md border border-white/20 px-5 py-3 text-sm font-black text-white hover:bg-white/10" disabled={isSaving} onClick={() => saveVenueDraft()} type="button">
                  Save as Draft
                </button>
              ) : null}
            </aside>
          </div>
        ) : null}

        {step !== 4 ? (
          <>
            <div className="mt-8 flex flex-wrap justify-between gap-3 border-t border-slate-200 pt-5">
            <button className="rounded-md border border-slate-200 px-5 py-3 text-sm font-black text-sportNavy hover:bg-slate-50" disabled={step === 1} onClick={() => setStep((current) => Math.max(1, current - 1))} type="button">
              Previous
            </button>
            <div className="flex flex-wrap gap-3">
              {!isApprovedVenue || !hasMajorChanges ? (
                <button className="rounded-md border border-green-200 px-5 py-3 text-sm font-black text-sportGreen hover:bg-green-50" disabled={isSaving} onClick={() => saveVenueDraft()} type="button">
                  {isSaving ? "Saving..." : isApprovedVenue ? "Save Safe Changes" : "Save as Draft"}
                </button>
              ) : null}
              <button className="rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" onClick={() => setStep((current) => Math.min(4, current + 1))} type="button">
                Next
              </button>
            </div>
            </div>
          </>
        ) : (
          <div className="mt-8 border-t border-slate-200 pt-5">
            <button className="rounded-md border border-slate-200 px-5 py-3 text-sm font-black text-sportNavy hover:bg-slate-50" onClick={() => setStep(3)} type="button">
              Previous
            </button>
          </div>
        )}
      </section>

      <Link className="mt-5 inline-flex text-sm font-black text-sportGreen hover:text-green-700" href="/dashboard/owner">
        Back to Owner Dashboard
      </Link>

      {pendingLegacyPhotoRemoval ? (
        <ConfirmActionModal
          actionLabel="Remove photo"
          body={`This removes the current ${legacyPhotoLabels[pendingLegacyPhotoRemoval].toLowerCase()} from your venue profile. Existing bookings and court availability are not affected.`}
          confirmTone="danger"
          isWorking={isSaving}
          onCancel={() => setPendingLegacyPhotoRemoval(null)}
          onConfirm={() => removeLegacyPhoto(pendingLegacyPhotoRemoval)}
          title={`Remove ${legacyPhotoLabels[pendingLegacyPhotoRemoval]}?`}
        />
      ) : null}
      {pendingGalleryPhotoId !== null ? (
        <ConfirmActionModal
          actionLabel="Remove photo"
          body="This removes this gallery photo from the venue profile. Existing bookings and court availability are not affected."
          confirmTone="danger"
          isWorking={isSaving}
          onCancel={() => setPendingGalleryPhotoId(null)}
          onConfirm={removeGalleryPhoto}
          title="Remove this gallery photo?"
        />
      ) : null}
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-2xl font-black text-sportNavy">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
    </div>
  );
}

function CancellationPolicyEditor({ form, setForm }: { form: VenueForm; setForm: (form: VenueForm) => void }) {
  const fullHours = Number(form.cancellation_full_refund_hours || 0);
  const partialHours = Number(form.cancellation_partial_refund_hours || 0);
  const hasValidOrder = !form.cancellation_partial_refund_enabled || (
    partialHours >= 1 && fullHours >= 2 && partialHours < fullHours
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-black text-sportNavy">Cancellation and Refund Policy</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            Configure the rules SportSpot will enforce automatically. Policy edits apply only to future bookings; confirmed bookings keep the terms captured when they were reserved.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-green-100 px-3 py-1 text-xs font-black text-green-800">
          Executable Policy
        </span>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <PolicyTierCard
          description="Player receives the entire paid amount."
          label="Full Refund"
          tone="green"
        >
          <NumberField
            label="Cancel at least"
            max={168}
            min={2}
            onChange={(value) => setForm({ ...form, cancellation_full_refund_hours: value })}
            suffix="hours before"
            value={form.cancellation_full_refund_hours}
          />
        </PolicyTierCard>

        <PolicyTierCard
          description="Optional fair middle window for late changes."
          label="Partial Refund"
          tone="amber"
        >
          <label className="flex items-center justify-between gap-3 rounded-md bg-white p-3 text-sm font-bold text-slate-700">
            <span>Enable partial refunds</span>
            <input
              checked={form.cancellation_partial_refund_enabled}
              onChange={(event) => setForm({ ...form, cancellation_partial_refund_enabled: event.target.checked })}
              type="checkbox"
            />
          </label>
          {form.cancellation_partial_refund_enabled ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <NumberField
                label="Starts at"
                max={167}
                min={1}
                onChange={(value) => setForm({ ...form, cancellation_partial_refund_hours: value })}
                suffix="hours before"
                value={form.cancellation_partial_refund_hours}
              />
              <NumberField
                label="Refund"
                max={99}
                min={1}
                onChange={(value) => setForm({ ...form, cancellation_partial_refund_percent: value })}
                suffix="% of payment"
                value={form.cancellation_partial_refund_percent}
              />
            </div>
          ) : null}
        </PolicyTierCard>

        <PolicyTierCard
          description="Slots are released, but payment is not refunded."
          label="Late Cancellation"
          tone="red"
        >
          <div className="rounded-md bg-white p-3">
            <p className="text-xs font-black uppercase text-slate-500">No-refund window</p>
            <p className="mt-1 text-sm font-black text-sportNavy">
              Less than {form.cancellation_partial_refund_enabled ? form.cancellation_partial_refund_hours : form.cancellation_full_refund_hours} hours before
            </p>
          </div>
        </PolicyTierCard>
      </div>

      {!hasValidOrder ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          Partial-refund hours must be lower than full-refund hours.
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <Textarea
          label="Additional Policy Notes Optional"
          onChange={(value) => setForm({ ...form, cancellation_policy: value.slice(0, 500) })}
          value={form.cancellation_policy}
        />
        <div className="rounded-md border border-green-200 bg-green-50 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-green-800">Player Preview</p>
          <ul className="mt-3 space-y-2 text-sm font-semibold leading-5 text-green-950">
            {getCancellationPolicySummary(form).map((item) => (
              <li className="flex gap-2" key={item}>
                <span aria-hidden="true">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-green-200 pt-3 text-xs font-semibold text-green-800">
            Venue-caused cancellations always require a 100% refund and cannot be overridden.
          </p>
        </div>
      </div>
    </section>
  );
}

function PolicyTierCard({
  label,
  description,
  tone,
  children,
}: {
  label: string;
  description: string;
  tone: "green" | "amber" | "red";
  children: ReactNode;
}) {
  const toneClasses = tone === "green"
    ? "border-green-200 bg-green-50"
    : tone === "amber"
      ? "border-amber-200 bg-amber-50"
      : "border-red-200 bg-red-50";
  return (
    <div className={`rounded-lg border p-4 ${toneClasses}`}>
      <p className="font-black text-sportNavy">{label}</p>
      <p className="mt-1 min-h-10 text-xs leading-5 text-slate-600">{description}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function NumberField({
  label,
  value,
  suffix,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  suffix: string;
  min: number;
  max: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block rounded-md bg-white p-3">
      <span className="text-xs font-black uppercase text-slate-500">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          className="w-20 rounded-md border border-slate-300 px-2 py-2 text-sm font-black text-sportNavy outline-none focus:border-sportGreen"
          max={max}
          min={min}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
          type="number"
          value={value}
        />
        <span className="text-xs font-semibold text-slate-500">{suffix}</span>
      </div>
    </label>
  );
}

function getCancellationPolicySummary(form: VenueForm) {
  const fullHours = Number(form.cancellation_full_refund_hours || 24);
  if (!form.cancellation_partial_refund_enabled) {
    return [
      `100% refund at least ${fullHours} hours before start.`,
      `No refund less than ${fullHours} hours before start.`,
    ];
  }
  const partialHours = Number(form.cancellation_partial_refund_hours || 12);
  const partialPercent = Number(form.cancellation_partial_refund_percent || 50);
  return [
    `100% refund at least ${fullHours} hours before start.`,
    `${partialPercent}% refund between ${partialHours} and ${fullHours} hours before start.`,
    `No refund less than ${partialHours} hours before start.`,
  ];
}

function isCancellationPolicyValid(form: VenueForm) {
  const fullHours = Number(form.cancellation_full_refund_hours);
  if (!Number.isInteger(fullHours) || fullHours < 2 || fullHours > 168) return false;
  if (!form.cancellation_partial_refund_enabled) return true;
  const partialHours = Number(form.cancellation_partial_refund_hours);
  const partialPercent = Number(form.cancellation_partial_refund_percent);
  return Number.isInteger(partialHours)
    && partialHours >= 1
    && partialHours < fullHours
    && Number.isInteger(partialPercent)
    && partialPercent >= 1
    && partialPercent <= 99;
}

function Facilities({ form, setForm }: { form: VenueForm; setForm: (form: VenueForm) => void }) {
  return (
    <div>
      <p className="text-sm font-black text-sportNavy">Facilities</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {facilitiesOptions.map((facility) => (
          <label className="flex items-center gap-2 rounded-md border border-slate-200 p-3 text-sm font-semibold text-slate-700" key={facility}>
            <input
              checked={form.facilities.includes(facility)}
              onChange={(event) =>
                setForm({
                  ...form,
                  facilities: event.target.checked ? [...form.facilities, facility] : form.facilities.filter((item) => item !== facility),
                })
              }
              type="checkbox"
            />
            {facility}
          </label>
        ))}
      </div>
    </div>
  );
}

function PriceRow({ duration, selected, price, onSelect, onPriceChange }: { duration: string; selected: boolean; price: string; onSelect: () => void; onPriceChange: (value: string) => void }) {
  return (
    <div className={`grid gap-3 rounded-md border p-3 sm:grid-cols-[120px_1fr] ${selected ? "border-sportGreen bg-green-50" : "border-slate-200 bg-white"}`}>
      <button className={`rounded-md px-3 py-2 text-sm font-black ${selected ? "bg-sportGreen text-white" : "bg-slate-100 text-slate-700"}`} onClick={onSelect} type="button">
        {duration} min
      </button>
      <label>
        <span className="text-xs font-black uppercase tracking-wide text-slate-500">Base price per slot</span>
        <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sportGreen" onChange={(event) => onPriceChange(event.target.value)} value={price} />
      </label>
    </div>
  );
}

function ReviewCard({ title, items, onEdit }: { title: string; items: string[][]; onEdit: () => void }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-black text-sportNavy">{title}</h3>
        <button className="text-xs font-black text-sportGreen hover:text-green-700" onClick={onEdit} type="button">
          Edit
        </button>
      </div>
      <div className="mt-4 space-y-3">
        {items.map(([label, value], index) => (
          <div key={`${label}-${value}-${index}`}>
            {label ? <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p> : null}
            <p className="text-sm font-semibold text-slate-700">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text", min, max }: { label: string; value: string; onChange: (value: string) => void; type?: string; min?: string; max?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-sportNavy">{label}</span>
      <input className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-sm outline-none focus:border-sportGreen" max={max} min={min} onChange={(event) => onChange(event.target.value)} type={type} value={value} />
    </label>
  );
}

function TimeSelectField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-sportNavy">{label}</span>
      <TimeSelect ariaLabel={label} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-sm outline-none focus:border-sportGreen" options={buildTimeOptions()} value={value} onChange={onChange} />
    </label>
  );
}

function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-sportNavy">{label}</span>
      <textarea className="mt-2 min-h-24 w-full rounded-md border border-slate-300 px-3 py-3 text-sm outline-none focus:border-sportGreen" onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  labels = {},
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  labels?: Record<string, string>;
}) {
  return (
    <label className="block">
      <span className="text-sm font-black text-sportNavy">{label}</span>
      <select className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-sm outline-none focus:border-sportGreen" onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option] || formatChoice(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function FileInput({ label, accept = ".jpg,.jpeg,.png", onChange }: { label: string; accept?: string; onChange: (event: ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className="block rounded-md border border-dashed border-slate-300 bg-slate-50 p-4">
      <span className="text-sm font-black text-sportNavy">{label}</span>
      <input accept={accept} className="mt-3 block w-full text-sm text-slate-600" onChange={onChange} type="file" />
    </label>
  );
}

function VenuePhotoManager({
  title,
  description,
  category,
  photos,
  legacyField,
  legacyPhotoUrl,
  required = false,
  onUpload,
  onDelete,
  onRemoveLegacy,
  onReplaceLegacy,
}: {
  title: string;
  description: string;
  category: VenuePhotoCategory;
  photos: VenuePhoto[];
  legacyField: VenueLegacyPhotoField;
  legacyPhotoUrl: string;
  required?: boolean;
  onUpload: (category: VenuePhotoCategory, event: ChangeEvent<HTMLInputElement>) => void;
  onDelete: (photoId: number) => void;
  onRemoveLegacy: () => void;
  onReplaceLegacy: (field: VenueLegacyPhotoField, event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const categoryPhotos = photos.filter((photo) => photo.category === category);
  const hasPhotos = categoryPhotos.length > 0 || Boolean(legacyPhotoUrl);
  const totalPhotos = categoryPhotos.length + (legacyPhotoUrl ? 1 : 0);

  return (
    <section className="owner-photo-manager">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-black text-sportNavy">{title}</h4>
            <span className={`owner-photo-count ${hasPhotos ? "owner-photo-count-ready" : required ? "owner-photo-count-required" : ""}`}>
              {hasPhotos ? `${totalPhotos} photo${totalPhotos === 1 ? "" : "s"}` : required ? "Required" : "Optional"}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        <label className="owner-photo-upload-button">
          <EditIcon />
          Add photos
          <input accept=".jpg,.jpeg,.png" className="sr-only" multiple onChange={(event) => onUpload(category, event)} type="file" />
        </label>
      </div>

      <div className="owner-photo-grid">
        {legacyPhotoUrl ? (
          <PhotoTile
            imageUrl={legacyPhotoUrl}
            isPrimary
            label="Current primary photo"
            onDelete={onRemoveLegacy}
            onReplace={(event) => onReplaceLegacy(legacyField, event)}
          />
        ) : null}
        {categoryPhotos.map((photo) => (
          <PhotoTile imageUrl={photo.image} key={photo.id} label="Gallery photo" onDelete={() => onDelete(photo.id)} />
        ))}
        <label className="owner-photo-add">
            <span className="owner-photo-add-icon"><CameraIcon /></span>
            <span className="mt-2 text-sm font-black text-sportGreen">{hasPhotos ? "Add another photo" : "Add your first photo"}</span>
            <span className="mt-1 px-4 text-xs text-slate-500">JPG, JPEG or PNG, up to 5 MB</span>
            <input accept=".jpg,.jpeg,.png" className="sr-only" multiple onChange={(event) => onUpload(category, event)} type="file" />
        </label>
      </div>
    </section>
  );
}

function PhotoTile({ imageUrl, label, isPrimary = false, onDelete, onReplace }: { imageUrl: string; label: string; isPrimary?: boolean; onDelete?: () => void; onReplace?: (event: ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <article className="owner-photo-tile">
      <MediaImage alt={label} className="owner-photo-image object-cover" fallback={<div className="owner-photo-image flex items-center justify-center bg-slate-100 text-xs font-black text-slate-500">Photo unavailable</div>} source={imageUrl} />
      <div className="owner-photo-tile-footer">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-sportNavy">{label}</p>
          <p className="mt-1 text-xs text-slate-500">{isPrimary ? "Shown as the category cover" : "Visible in the venue gallery"}</p>
        </div>
        <div className="owner-photo-tile-actions">
          {onReplace ? (
            <label className="owner-photo-action owner-photo-action-replace">
              Replace
              <input accept=".jpg,.jpeg,.png" className="sr-only" onChange={onReplace} type="file" />
            </label>
          ) : null}
          {onDelete ? <button className="owner-photo-action owner-photo-action-remove" onClick={onDelete} type="button">Remove</button> : null}
        </div>
      </div>
    </article>
  );
}

function EditIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="m4 16-.8 4 4-.8L18.5 7.9a2 2 0 0 0-2.8-2.8L4.4 16.4Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
      <path d="m14 6 4 4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M4 8h3l2-3h6l2 3h3v11H4V8Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
      <path d="M12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}


function getSelectedBasePrice(slotForm: { slot_duration_minutes: string; price_30: string; price_60: string; price_90: string }) {
  if (slotForm.slot_duration_minutes === "30") return slotForm.price_30;
  if (slotForm.slot_duration_minutes === "90") return slotForm.price_90;
  return slotForm.price_60;
}

function detectMajorVenueChanges(venue: Venue, form: VenueForm, files: Record<string, File | null>) {
  const majorFields: Array<keyof VenueForm> = ["name", "address", "city", "area", "map_location", "verification_document_type"];
  const changedMajorField = majorFields.some((field) => normalizeCompare(String(venue[field] || "")) !== normalizeCompare(String(form[field] || "")));
  return changedMajorField || hasVenueCoordinateChanges(venue, form) || Boolean(files.verification_document);
}

function hasVenueCoordinateChanges(venue: Venue, form: VenueForm) {
  return normalizeCoordinate(venue.latitude) !== normalizeCoordinate(form.latitude) || normalizeCoordinate(venue.longitude) !== normalizeCoordinate(form.longitude);
}

function normalizeCoordinate(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "";
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue.toFixed(6) : String(value).trim();
}

function roundCoordinate(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value;
}

function normalizeCompare(value: string) {
  return value.trim();
}

function onlyPhone(value: string) {
  return value.replace(/[^\d+ ]/g, "");
}

function onlyNumber(value: string) {
  return value.replace(/[^\d.]/g, "");
}

function toInputTime(value: string | null) {
  if (!value) return "";
  return value.slice(0, 5);
}

function formatChoice(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mergeReferenceOption(options: ReferenceOption[], currentValue: string) {
  const normalizedCurrent = currentValue.trim();
  if (!normalizedCurrent || options.some((option) => option.value.toLowerCase() === normalizedCurrent.toLowerCase())) {
    return options;
  }
  return [{ value: normalizedCurrent, label: `${normalizedCurrent} (current)` }, ...options];
}
