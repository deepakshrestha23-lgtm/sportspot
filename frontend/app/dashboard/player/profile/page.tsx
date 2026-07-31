"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";

import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getCurrentUser } from "@/lib/auth";
import type {
  CricksalRole,
  PlayerProfile,
  PlayerProfilePayload,
  PlayerProfileResponse,
  SkillLevel,
} from "@/types/playerProfile";
import type { User } from "@/types/auth";

const locations = ["Kathmandu", "Lalitpur", "Bhaktapur"];

const availabilityOptions = [
  "Weekday mornings",
  "Weekday evenings",
  "Saturday morning",
  "Saturday afternoon",
  "Saturday evening",
  "Sunday morning",
  "Sunday afternoon",
  "Sunday evening",
  "Flexible",
];

const skillOptions: Array<{ label: string; value: SkillLevel }> = [
  { label: "Beginner", value: "BEGINNER" },
  { label: "Intermediate", value: "INTERMEDIATE" },
  { label: "Advanced", value: "ADVANCED" },
];

const cricksalRoleOptions: Array<{ label: string; value: CricksalRole }> = [
  { label: "Batsman", value: "BATSMAN" },
  { label: "Bowler", value: "BOWLER" },
  { label: "All-rounder", value: "ALL_ROUNDER" },
  { label: "Wicketkeeper", value: "WICKETKEEPER" },
  { label: "None", value: "NONE" },
];

const emptyForm: PlayerProfilePayload = {
  preferred_sport: "CRICKSAL",
  skill_level: "BEGINNER",
  location: "",
  weekly_availability: "",
  playing_style: "",
  preferred_cricksal_role: "NONE",
};

export default function PlayerProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [form, setForm] = useState<PlayerProfilePayload>(emptyForm);
  const [profileExists, setProfileExists] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [isPhotoEditing, setIsPhotoEditing] = useState(false);
  const [isSportsEditing, setIsSportsEditing] = useState(false);
  const [isRoleEditing, setIsRoleEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const feedbackMessage = error || success;
  const feedbackType = error ? "error" : success ? "success" : "info";

  useEffect(() => {
    setUser(getCurrentUser());
    loadProfile();
  }, []);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  async function loadProfile() {
    setIsLoading(true);
    setError("");

    try {
      const response = await api.get<PlayerProfileResponse>("/api/players/profile/");
      setProfileExists(response.data.exists);

      if (response.data.profile) {
        const loadedProfile = response.data.profile;
        setProfile(loadedProfile);
        setForm({
          preferred_sport: "CRICKSAL",
          skill_level: loadedProfile.skill_level,
          location: loadedProfile.location,
          weekly_availability: loadedProfile.weekly_availability || "",
          playing_style: loadedProfile.playing_style || "",
          preferred_cricksal_role: loadedProfile.preferred_cricksal_role,
        });
      } else {
        setIsSportsEditing(true);
        setIsRoleEditing(true);
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load player profile."));
    } finally {
      setIsLoading(false);
    }
  }

  function handlePhotoChange(file: File | null) {
    setError("");

    if (!file) {
      setPhotoFile(null);
      setPhotoPreview("");
      return;
    }

    const allowedTypes = ["image/jpeg", "image/png"];
    if (!allowedTypes.includes(file.type)) {
      setError("Profile photo must be JPG, JPEG, or PNG.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError("Profile photo must be 2MB or smaller.");
      return;
    }

    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setIsSaving(true);

    const payload = new FormData();
    payload.append("preferred_sport", "CRICKSAL");
    payload.append("skill_level", form.skill_level);
    payload.append("location", form.location);
    payload.append("weekly_availability", form.weekly_availability);
    payload.append("playing_style", form.playing_style);
    payload.append("preferred_cricksal_role", form.preferred_cricksal_role);

    if (photoFile) {
      payload.append("profile_photo", photoFile);
    }

    try {
      const response = profileExists
        ? await api.put<PlayerProfileResponse>("/api/players/profile/", payload)
        : await api.post<PlayerProfileResponse>("/api/players/profile/", payload);

      setProfile(response.data.profile);
      setProfileExists(true);
      setPhotoFile(null);
      setPhotoPreview("");
      setIsPhotoEditing(false);
      setIsSportsEditing(false);
      setIsRoleEditing(false);
      setSuccess("Player profile saved successfully.");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not save player profile."));
    } finally {
      setIsSaving(false);
    }
  }

  const displayName = profile?.full_name || user?.full_name || "Player";
  const reliabilityText =
    profile && profile.completed_matches_count >= 3
      ? `${profile.reliability_score}/100`
      : "New Player / Provisional Reliability";
  const profilePhotoSrc = useMemo(() => getProfilePhotoSrc(photoPreview || profile?.profile_photo || ""), [photoPreview, profile?.profile_photo]);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-slate-500">Loading player profile...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <FeedbackToast message={feedbackMessage} onClose={() => { setError(""); setSuccess(""); }} type={feedbackType} />

      <form className="space-y-6" onSubmit={handleSubmit}>
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <div className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sportNavy text-2xl font-black text-white">
                {profilePhotoSrc ? (
                  <Image alt={`${displayName} profile photo`} className="object-cover" fill sizes="96px" src={profilePhotoSrc} unoptimized />
                ) : (
                  displayName.charAt(0).toUpperCase()
                )}
              </div>
              <div>
                <h1 className="text-3xl font-black text-sportNavy">{displayName}</h1>
                <p className="mt-1 text-sm font-semibold text-slate-500">{profile?.sportspot_id || "SportSpot ID will be created after saving"}</p>
                <button className="mt-3 text-sm font-black text-sportGreen hover:text-green-700" onClick={() => setIsPhotoEditing((value) => !value)} type="button">
                  {isPhotoEditing ? "Cancel photo edit" : "Edit photo"}
                </button>
              </div>
            </div>
            <div className="rounded-md bg-green-50 px-4 py-3">
              <p className="text-xs font-black uppercase tracking-wide text-sportGreen">Reliability</p>
              <p className="mt-1 font-black text-sportNavy">{reliabilityText}</p>
              {(!profile || profile.completed_matches_count < 3) ? (
                <p className="mt-1 max-w-xs text-xs text-slate-600">Reliability becomes meaningful after a few completed matches.</p>
              ) : null}
            </div>
          </div>

          {isPhotoEditing ? (
            <div className="mt-5 rounded-md border border-dashed border-green-300 bg-green-50 p-4">
              <label className="block text-sm font-black text-sportNavy">
                Upload profile photo
                <input
                  accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                  className="mt-2 block w-full text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-sportGreen file:px-4 file:py-2 file:font-black file:text-white hover:file:bg-green-700"
                  onChange={(event) => handlePhotoChange(event.target.files?.[0] || null)}
                  type="file"
                />
              </label>
              <p className="mt-2 text-xs font-semibold text-slate-600">Accepted formats: JPG, JPEG, PNG. Max size: 2MB.</p>
            </div>
          ) : null}

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryItem label="Sport" value="Cricksal" />
            <SummaryItem label="Skill Level" value={formatChoice(form.skill_level)} />
            <SummaryItem label="Location" value={form.location || "Not set"} />
            <SummaryItem label="Completed Matches" value={profile?.completed_matches_count ?? 0} />
            <SummaryItem label="Average Rating" value={formatRating(profile?.average_rating)} />
          </div>
        </section>

        <EditableSection
          description="Sport, skill, city, availability, and how you prefer to play."
          isEditing={isSportsEditing}
          onEdit={() => setIsSportsEditing(true)}
          title="Sports Identity"
        >
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Sport">
              <ReadOnlySportBadge />
            </Field>
            <Field label="Skill Level">
              <select className={inputClassName} disabled={!isSportsEditing} value={form.skill_level} onChange={(event) => setForm({ ...form, skill_level: event.target.value as SkillLevel })}>
                {skillOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Location">
              <select className={inputClassName} disabled={!isSportsEditing} required value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })}>
                <option value="">Select your city</option>
                {locations.map((location) => (
                  <option key={location} value={location}>
                    {location}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Weekly Availability">
              <select className={inputClassName} disabled={!isSportsEditing} required value={form.weekly_availability} onChange={(event) => setForm({ ...form, weekly_availability: event.target.value })}>
                <option value="">Select availability</option>
                {availabilityOptions.map((availability) => (
                  <option key={availability} value={availability}>
                    {availability}
                  </option>
                ))}
              </select>
            </Field>
            <Field className="md:col-span-2" label="Playing Style">
              <textarea
                className={`${inputClassName} min-h-28 py-3`}
                disabled={!isSportsEditing}
                placeholder="e.g. Competitive but friendly, prefers organized team play"
                required
                value={form.playing_style}
                onChange={(event) => setForm({ ...form, playing_style: event.target.value })}
              />
            </Field>
          </div>
        </EditableSection>

        <EditableSection
          description="Choose the Cricksal role you prefer when joining games and teams."
          isEditing={isRoleEditing}
          onEdit={() => setIsRoleEditing(true)}
          title="Role Preference"
        >
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Preferred Cricksal Role">
              <select className={inputClassName} disabled={!isRoleEditing} value={form.preferred_cricksal_role} onChange={(event) => setForm({ ...form, preferred_cricksal_role: event.target.value as CricksalRole })}>
                {cricksalRoleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </EditableSection>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-sportNavy">Trust Summary</h2>
          <p className="mt-1 text-sm text-slate-500">These values are read-only because SportSpot manages them from match activity.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryItem label="Reliability" value={reliabilityText} />
            <SummaryItem label="Completed Matches" value={profile?.completed_matches_count ?? 0} />
            <SummaryItem label="No-shows" value={profile?.no_show_count ?? 0} />
            <SummaryItem label="Late Cancellations" value={profile?.late_cancellation_count ?? 0} />
            <SummaryItem label="Average Rating" value={formatRating(profile?.average_rating)} />
          </div>
        </section>

        <button className="rounded-md bg-sportGreen px-6 py-3 font-black text-white hover:bg-green-700 disabled:bg-slate-400" disabled={isSaving} type="submit">
          {isSaving ? "Saving Profile..." : "Save Profile"}
        </button>
      </form>
    </div>
  );
}

const inputClassName =
  "mt-2 w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sportGreen focus:ring-2 focus:ring-green-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";

function EditableSection({
  children,
  description,
  isEditing,
  onEdit,
  title,
}: {
  children: React.ReactNode;
  description: string;
  isEditing: boolean;
  onEdit: () => void;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-black text-sportNavy">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <button className="rounded-md border border-green-200 px-3 py-2 text-sm font-black text-sportGreen hover:bg-green-50" onClick={onEdit} type="button">
          {isEditing ? "Editing" : "Edit"}
        </button>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Field({ children, className = "", label }: { children: React.ReactNode; className?: string; label: string }) {
  return (
    <label className={`block text-sm font-black text-slate-800 ${className}`}>
      {label}
      {children}
    </label>
  );
}

function ReadOnlySportBadge() {
  return (
    <div className="mt-2 flex w-full items-center justify-between rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm">
      <span className="font-black text-sportNavy">Cricksal</span>
      <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-sportGreen">SportSpot Sport</span>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-slate-50 p-4">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 font-black text-sportNavy">{value}</p>
    </div>
  );
}

function formatChoice(value?: string) {
  if (!value) return "Not set";
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatRating(value?: string) {
  if (!value) return "0.00";
  return Number(value).toFixed(2);
}

function getProfilePhotoSrc(value: string) {
  if (!value) return "";
  if (value.startsWith("blob:") || value.startsWith("http")) return value;
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
  return `${apiBaseUrl}${value}`;
}
