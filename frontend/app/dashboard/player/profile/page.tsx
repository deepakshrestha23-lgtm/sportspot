
"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { DashboardPageHeader } from "@/components/player-dashboard/DashboardPageHeader";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getCurrentUser } from "@/lib/auth";
import { emitToast } from "@/lib/toast";
import type { User } from "@/types/auth";
import type { AvailabilityDay, AvailabilityTimePeriod, CricksalRole, PlayerProfile, PlayerProfilePayload, PlayerProfileResponse, SkillLevel } from "@/types/playerProfile";

const locations = ["Kathmandu", "Lalitpur", "Bhaktapur"];
const skills: Array<{ label: string; value: SkillLevel; helper: string }> = [
  { label: "Beginner", value: "BEGINNER", helper: "Building match confidence" },
  { label: "Intermediate", value: "INTERMEDIATE", helper: "Regular competitive player" },
  { label: "Advanced", value: "ADVANCED", helper: "Strong match experience" },
];
const roles: Array<{ label: string; value: CricksalRole; helper: string }> = [
  { label: "Batsman", value: "BATSMAN", helper: "Runs and batting control" },
  { label: "Bowler", value: "BOWLER", helper: "Pace, spin, and wickets" },
  { label: "All-rounder", value: "ALL_ROUNDER", helper: "Balanced batting and bowling" },
  { label: "Wicketkeeper", value: "WICKETKEEPER", helper: "Keeper and field organiser" },
  { label: "None", value: "NONE", helper: "Flexible role" },
];
const days: Array<{ label: string; value: AvailabilityDay }> = [
  { label: "Mon", value: "MON" }, { label: "Tue", value: "TUE" }, { label: "Wed", value: "WED" }, { label: "Thu", value: "THU" }, { label: "Fri", value: "FRI" }, { label: "Sat", value: "SAT" }, { label: "Sun", value: "SUN" },
];
const periods: Array<{ label: string; value: AvailabilityTimePeriod; helper: string }> = [
  { label: "Morning", value: "MORNING", helper: "Before 12 PM" },
  { label: "Afternoon", value: "AFTERNOON", helper: "12 PM - 5 PM" },
  { label: "Evening", value: "EVENING", helper: "After 5 PM" },
  { label: "Flexible", value: "FLEXIBLE", helper: "Open to coordinate" },
];

const emptyForm: PlayerProfilePayload = {
  preferred_sport: "CRICKSAL",
  skill_level: "BEGINNER",
  location: "",
  weekly_availability: "",
  availability_days: [],
  availability_time_periods: [],
  playing_style: "",
  bio: "",
  preferred_cricksal_role: "NONE",
};

type FormErrors = Partial<Record<keyof PlayerProfilePayload | "profile_photo", string>>;

export default function PlayerProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [form, setForm] = useState<PlayerProfilePayload>(emptyForm);
  const [profileExists, setProfileExists] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [pageError, setPageError] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [removePhoto, setRemovePhoto] = useState(false);
  const firstFieldRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => { setUser(getCurrentUser()); loadProfile(); }, []);
  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);
  useEffect(() => {
    if (!isEditorOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => firstFieldRef.current?.focus(), 80);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !isSaving) closeEditor(); };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = originalOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [isEditorOpen, isSaving]);

  async function loadProfile() {
    setIsLoading(true); setPageError("");
    try {
      const response = await api.get<PlayerProfileResponse>("/api/players/profile/");
      setProfileExists(response.data.exists);
      if (response.data.profile) { setProfile(response.data.profile); setForm(toForm(response.data.profile)); }
      else { setProfile(null); setForm(emptyForm); setIsEditorOpen(true); }
    } catch (error) {
      setPageError(getApiErrorMessage(error, "We could not load your profile right now. Please try again."));
    } finally { setIsLoading(false); }
  }

  function openEditor() {
    setForm(profile ? toForm(profile) : emptyForm); setErrors({}); setPhotoFile(null); setPhotoPreview(""); setRemovePhoto(false); setIsEditorOpen(true);
  }
  function closeEditor() {
    if (isSaving) return;
    setIsEditorOpen(false); setErrors({}); setPhotoFile(null); setRemovePhoto(false);
    if (photoPreview) { URL.revokeObjectURL(photoPreview); setPhotoPreview(""); }
  }
  function updateForm(next: Partial<PlayerProfilePayload>) {
    setForm((current) => ({ ...current, ...next }));
    setErrors((current) => { const updated = { ...current }; Object.keys(next).forEach((key) => delete updated[key as keyof PlayerProfilePayload]); return updated; });
  }
  function toggleDay(value: AvailabilityDay) { updateForm({ availability_days: form.availability_days.includes(value) ? form.availability_days.filter((item) => item !== value) : [...form.availability_days, value] }); }
  function togglePeriod(value: AvailabilityTimePeriod) { updateForm({ availability_time_periods: form.availability_time_periods.includes(value) ? form.availability_time_periods.filter((item) => item !== value) : [...form.availability_time_periods, value] }); }
  function handlePhotoChange(file: File | null) {
    setErrors((current) => ({ ...current, profile_photo: "" }));
    if (!file) { setPhotoFile(null); setPhotoPreview(""); return; }
    if (!["image/jpeg", "image/png"].includes(file.type)) { setErrors((current) => ({ ...current, profile_photo: "Please upload a JPG, JPEG, or PNG image." })); return; }
    if (file.size > 2 * 1024 * 1024) { setErrors((current) => ({ ...current, profile_photo: "Profile photo must be 2MB or smaller." })); return; }
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file); setPhotoPreview(URL.createObjectURL(file)); setRemovePhoto(false);
  }

  function handleRemovePhoto() {
    setPhotoFile(null); if (photoPreview) URL.revokeObjectURL(photoPreview); setPhotoPreview(""); setRemovePhoto(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationErrors = validateForm(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length) return;

    setIsSaving(true);
    const payload = new FormData();
    payload.append("preferred_sport", "CRICKSAL");
    payload.append("skill_level", form.skill_level);
    payload.append("location", form.location.trim());
    payload.append("availability_days", JSON.stringify(form.availability_days));
    payload.append("availability_time_periods", JSON.stringify(form.availability_time_periods));
    payload.append("playing_style", form.playing_style.trim());
    payload.append("bio", form.bio.trim());
    payload.append("preferred_cricksal_role", form.preferred_cricksal_role);
    if (photoFile) payload.append("profile_photo", photoFile);
    if (removePhoto && !photoFile) payload.append("remove_profile_photo", "true");

    try {
      const response = profileExists ? await api.patch<PlayerProfileResponse>("/api/players/profile/", payload) : await api.post<PlayerProfileResponse>("/api/players/profile/", payload);
      if (response.data.profile) { setProfile(response.data.profile); setForm(toForm(response.data.profile)); }
      setProfileExists(true); setIsEditorOpen(false); setPhotoFile(null); setPhotoPreview(""); setRemovePhoto(false);
      emitToast({ message: "Your profile has been updated.", type: "success", dedupeKey: "player-profile-saved" });
    } catch (error) {
      emitToast({ message: getApiErrorMessage(error, "We could not update your profile. Please try again."), type: "error", dedupeKey: "player-profile-save-error" });
    } finally { setIsSaving(false); }
  }

  const displayName = profile?.full_name || user?.full_name || "Player";
  const completion = profile?.profile_completion_percentage ?? 0;
  const photoSrc = useMemo(() => getProfilePhotoSrc(removePhoto ? "" : photoPreview || profile?.profile_photo || ""), [photoPreview, profile?.profile_photo, removePhoto]);
  const rating = formatRating(profile?.average_rating);
  const role = roles.find((item) => item.value === form.preferred_cricksal_role) || roles[4];
  const skill = skills.find((item) => item.value === form.skill_level) || skills[0];

  if (isLoading) return <ProfileSkeleton />;
  if (pageError) return (
    <div className="space-y-5">
      <DashboardPageHeader eyebrow="My Profile" title="Player Profile" description="Manage your public sports identity and playing preferences." />
      <section className="sport-error-state">
        <p className="text-sm font-semibold text-red-700">{pageError}</p>
        <button className="sport-primary-button mt-4" onClick={loadProfile} type="button">Retry</button>
      </section>
    </div>
  );

  return (
    <div className="space-y-5">
      <DashboardPageHeader
        actions={
          <>
            <button className="sport-secondary-button min-h-11" onClick={() => emitToast({ message: "Public profile preview is not available yet.", type: "info", dedupeKey: "public-profile-preview" })} type="button">View Public Profile</button>
            <button className="sport-primary-button min-h-11" onClick={openEditor} type="button">Edit Profile</button>
          </>
        }
        eyebrow="Public sports identity"
        title="My Profile"
        description="Manage the Cricksal identity other players, teams, and captains use to understand how you play."
      />

      {!profile?.is_profile_complete ? (
        <section className="sport-surface border-green-200 bg-green-50 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div><p className="text-sm font-black text-green-950">Complete your sports identity</p><p className="mt-1 text-sm text-green-800">Add your role, availability, playing style, and bio so teams can judge fit faster.</p></div>
          <button className="sport-primary-button mt-3 min-h-11 sm:mt-0" onClick={openEditor} type="button">Complete Profile</button>
        </section>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <section className="sport-card">
            <div className="flex flex-col items-center text-center">
              <div className="relative">
                <div className="absolute -inset-2 rounded-full" style={{ background: `conic-gradient(#16A34A ${completion}%, #E2E8F0 0)` }} />
                <div className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-sportNavy text-2xl font-black text-white shadow-sm">
                  {photoSrc ? <Image alt={`${displayName} profile photo`} className="object-cover" fill sizes="112px" src={photoSrc} unoptimized /> : initials(displayName)}
                </div>
                <button aria-label="Change profile photo" className="absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center rounded-full border-4 border-white bg-sportGreen text-sm font-black text-white shadow-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-200" onClick={openEditor} type="button">+</button>
              </div>
              <h2 className="mt-5 text-2xl font-black tracking-tight text-sportNavy">{displayName}</h2>
              <p className="mt-1 text-xs font-black uppercase tracking-[0.2em] text-sportGreen">{profile?.sportspot_id || "SportSpot ID pending"}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2"><Pill label="Cricksal" tone="green" /><Pill label={profile?.is_profile_complete ? "Profile complete" : `${completion}% complete`} tone="slate" /></div>
            </div>
            <div className="my-5 border-t border-slate-200" />
            <div className="grid grid-cols-2 gap-3"><Metric label="Reliability" value={profile && profile.completed_matches_count >= 3 ? `${profile.reliability_score}%` : "New Player"} /><Metric label="Avg rating" value={`${rating}/5`} /><Metric label="Matches" value={profile?.completed_matches_count ?? 0} /><Metric label="No-shows" value={profile?.no_show_count ?? 0} /></div>
            {profile && profile.completed_matches_count < 3 ? <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs font-semibold leading-5 text-slate-600">Reliability becomes meaningful after a few completed matches.</p> : null}
          </section>
          <section className="sport-card">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Trust summary</p><h3 className="mt-1 text-lg font-black text-sportNavy">Match behaviour</h3></div><span className="rounded-full bg-green-50 px-3 py-1 text-xs font-black text-sportGreen">Read only</span></div>
            <div className="mt-4 space-y-3"><TrustRow label="Reliability score" value={profile ? `${profile.reliability_score}/100` : "Not available"} /><TrustRow label="Average rating" value={`${rating}/5`} /><TrustRow label="Completed matches" value={profile?.completed_matches_count ?? 0} /><TrustRow label="Late cancellations" value={profile?.late_cancellation_count ?? 0} /></div>
          </section>
        </aside>

        <main className="space-y-5">
          <section className="sport-card sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Public visibility</p><h2 className="mt-1 text-xl font-black text-sportNavy">Player information</h2></div>
              <button aria-label="Edit player information" className="min-h-10 rounded-xl border border-green-200 px-4 text-sm font-black text-sportGreen hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-green-200" onClick={openEditor} type="button">Edit</button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Spec label="Preferred role" title={formatRole(form.preferred_cricksal_role)} description={role.helper} tone="green" />
              <Spec label="Skill level" title={formatSkill(form.skill_level)} description={skill.helper} tone="slate" />
              <Spec label="Playing style" title={form.playing_style || "Not added"} description={form.playing_style ? "How you like to contribute" : "Add your style so teams understand your approach."} tone="green" />
              <Spec label="Location" title={form.location || "Not set"} description="Public district shown to nearby players" tone="slate" />
            </div>
            <div className="mt-6">
              <div className="flex items-center justify-between gap-3"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Availability</p><button className="text-sm font-black text-sportGreen hover:text-green-700" onClick={openEditor} type="button">Edit Availability</button></div>
              <Availability days={form.availability_days} periods={form.availability_time_periods} weeklyText={profile?.weekly_availability || ""} />
            </div>
            <div className="mt-6"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Player bio</p><div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-700">{form.bio || "Add a short bio to help teams learn more about you."}</div></div>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="sport-card border-l-4 border-sportGreen"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Primary team</p><h3 className="mt-2 text-lg font-black text-sportNavy">Team details live in My Teams</h3><p className="mt-2 text-sm leading-6 text-slate-600">Manage memberships, invitations, guests, and captain actions from the dedicated teams section.</p><Link className="mt-4 inline-flex text-sm font-black text-sportGreen hover:text-green-700" href="/dashboard/player/teams">Open My Teams</Link></section>
            <section className="sport-card border-l-4 border-slate-500"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Ratings & reliability</p><h3 className="mt-2 text-lg font-black text-sportNavy">Detailed trust history</h3><p className="mt-2 text-sm leading-6 text-slate-600">Match ratings, attendance, and reliability history belong in the ratings section.</p><Link className="mt-4 inline-flex text-sm font-black text-sportGreen hover:text-green-700" href="/dashboard/player/ratings">View Ratings</Link></section>
          </div>
        </main>
      </div>

      {isEditorOpen ? (
        <div aria-modal="true" className="fixed inset-0 z-50" role="dialog">
          <button aria-label="Close profile editor" className="absolute inset-0 bg-sportNavy/45" onClick={closeEditor} type="button" />
          <form className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl sm:rounded-l-3xl" onSubmit={handleSubmit}>
            <div className="border-b border-slate-200 p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-sportGreen">Edit public profile</p><h2 className="mt-1 text-2xl font-black text-sportNavy">Sports identity</h2><p className="mt-2 text-sm leading-6 text-slate-600">Update the details other players use when they view your Cricksal profile.</p></div><button aria-label="Close editor" className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-xl leading-none text-slate-600 hover:bg-slate-50" disabled={isSaving} onClick={closeEditor} type="button">x</button></div></div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6"><div className="space-y-7">
              <section><h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Profile photo</h3><div className="mt-3 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center"><div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sportNavy text-xl font-black text-white">{photoSrc && !removePhoto ? <Image alt="Profile photo preview" className="object-cover" fill sizes="80px" src={photoSrc} unoptimized /> : "SP"}</div><div className="min-w-0 flex-1"><label className="inline-flex min-h-10 cursor-pointer items-center rounded-xl bg-sportGreen px-4 text-sm font-black text-white hover:bg-green-700">{photoPreview ? "Replace Photo" : "Upload Photo"}<input accept=".jpg,.jpeg,.png,image/jpeg,image/png" className="sr-only" onChange={(event) => handlePhotoChange(event.target.files?.[0] || null)} type="file" /></label><button className="ml-2 inline-flex min-h-10 items-center rounded-xl border border-slate-300 px-4 text-sm font-black text-slate-700 hover:bg-white" onClick={handleRemovePhoto} type="button">Remove</button><p className="mt-2 text-xs font-semibold text-slate-500">JPG, JPEG, or PNG. Maximum size 2MB.</p>{errors.profile_photo ? <FieldError message={errors.profile_photo} /> : null}</div></div></section>
              <section><h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Player information</h3><div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Sport"><div className="mt-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-black text-sportNavy">Cricksal</div></Field>
                <Field error={errors.location} label="Location" required><select className={inputClassName} onChange={(event) => updateForm({ location: event.target.value })} ref={firstFieldRef} value={form.location}><option value="">Select district</option>{locations.map((location) => <option key={location} value={location}>{location}</option>)}</select></Field>
                <Field label="Skill level" required><select className={inputClassName} onChange={(event) => updateForm({ skill_level: event.target.value as SkillLevel })} value={form.skill_level}>{skills.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
                <Field label="Preferred role" required><select className={inputClassName} onChange={(event) => updateForm({ preferred_cricksal_role: event.target.value as CricksalRole })} value={form.preferred_cricksal_role}>{roles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
                <Field className="sm:col-span-2" error={errors.playing_style} label="Playing style" required><textarea className={`${inputClassName} min-h-24 py-3`} maxLength={180} onChange={(event) => updateForm({ playing_style: event.target.value })} placeholder="Example: Calm organiser, aggressive batsman, dependable bowler" value={form.playing_style} /></Field>
                <Field className="sm:col-span-2" error={errors.bio} label="Short player bio"><textarea className={`${inputClassName} min-h-28 py-3`} maxLength={500} onChange={(event) => updateForm({ bio: event.target.value })} placeholder="Tell teams what kind of teammate you are and what games you are looking for." value={form.bio} /><p className="mt-2 text-xs font-semibold text-slate-500">{form.bio.length}/500 characters</p></Field>
              </div></section>
              <section><h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Availability</h3><div className="mt-3 rounded-2xl border border-slate-200 p-4">
                <Field error={errors.availability_days} label="Available days" required><div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">{days.map((day) => <Toggle key={day.value} label={day.label} selected={form.availability_days.includes(day.value)} onClick={() => toggleDay(day.value)} />)}</div></Field>
                <div className="mt-4"><Field error={errors.availability_time_periods} label="Preferred time" required><div className="mt-2 grid gap-2 sm:grid-cols-2">{periods.map((period) => <button className={`rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-green-200 ${form.availability_time_periods.includes(period.value) ? "border-green-300 bg-green-50 text-green-950" : "border-slate-200 bg-white text-slate-700 hover:border-green-200"}`} key={period.value} onClick={() => togglePeriod(period.value)} type="button"><span className="block text-sm font-black">{period.label}</span><span className="mt-1 block text-xs font-semibold text-slate-500">{period.helper}</span></button>)}</div></Field></div>
              </div></section>
            </div></div>
            <div className="border-t border-slate-200 p-5 sm:p-6"><div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button className="min-h-11 rounded-xl border border-slate-300 px-5 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60" disabled={isSaving} onClick={closeEditor} type="button">Cancel</button><button className="min-h-11 rounded-xl bg-sportGreen px-5 text-sm font-black text-white shadow-sm hover:bg-green-700 disabled:bg-slate-400" disabled={isSaving} type="submit">{isSaving ? "Saving..." : "Save Profile"}</button></div></div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function Field({ children, className = "", error, label, required = false }: { children: ReactNode; className?: string; error?: string; label: string; required?: boolean }) {
  return <label className={`block text-sm font-black text-slate-800 ${className}`}>{label} {required ? <span className="text-sportGreen">*</span> : null}{children}{error ? <FieldError message={error} /> : null}</label>;
}
function FieldError({ message }: { message: string }) { return <p className="mt-2 text-xs font-bold text-red-600">{message}</p>; }
function Toggle({ label, onClick, selected }: { label: string; onClick: () => void; selected: boolean }) { return <button aria-pressed={selected} className={`min-h-10 rounded-xl border text-sm font-black transition focus:outline-none focus:ring-2 focus:ring-green-200 ${selected ? "border-green-300 bg-sportGreen text-white" : "border-slate-200 bg-white text-slate-700 hover:border-green-200"}`} onClick={onClick} type="button">{label}</button>; }
function Spec({ description, label, title, tone }: { description: string; label: string; title: string; tone: "green" | "slate" }) {
  return <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{label}</p><div className="mt-3 flex items-center gap-3"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-black ${tone === "green" ? "bg-green-50 text-sportGreen" : "bg-slate-100 text-slate-600"}`}>{title.charAt(0)}</span><div className="min-w-0"><h3 className="truncate text-base font-black text-sportNavy">{title}</h3><p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-600">{description}</p></div></div></div>;
}
function Availability({ days: selectedDays, periods: selectedPeriods, weeklyText }: { days: AvailabilityDay[]; periods: AvailabilityTimePeriod[]; weeklyText: string }) {
  if (!selectedDays.length && !selectedPeriods.length && !weeklyText) return <p className="mt-3 rounded-2xl border border-dashed border-slate-300 p-4 text-sm font-semibold text-slate-500">Add your weekly availability so captains can invite you for suitable games.</p>;
  return <div className="mt-3 space-y-3"><div className="flex flex-wrap gap-2">{selectedDays.map((day) => <Pill key={day} label={formatDay(day)} tone="green" />)}{selectedPeriods.map((period) => <Pill key={period} label={formatPeriod(period)} tone="slate" />)}</div>{weeklyText ? <p className="text-sm font-semibold text-slate-600">{weeklyText}</p> : null}</div>;
}
function Pill({ label, tone }: { label: string; tone: "green" | "slate" }) { return <span className={`rounded-full px-3 py-1 text-xs font-black ${tone === "green" ? "bg-green-50 text-sportGreen" : "bg-slate-100 text-slate-600"}`}>{label}</span>; }
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center"><p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="mt-2 text-lg font-black text-sportNavy">{value}</p></div>; }
function TrustRow({ label, value }: { label: string; value: string | number }) { return <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3"><span className="text-sm font-semibold text-slate-600">{label}</span><span className="text-sm font-black text-sportNavy">{value}</span></div>; }
function ProfileSkeleton() { return <div className="space-y-5"><div className="h-32 animate-pulse rounded-lg bg-white shadow-sm" /><div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]"><div className="space-y-5"><div className="h-[410px] animate-pulse rounded-[1.35rem] bg-white shadow-sm" /><div className="h-60 animate-pulse rounded-[1.35rem] bg-white shadow-sm" /></div><div className="space-y-5"><div className="h-[560px] animate-pulse rounded-[1.35rem] bg-white shadow-sm" /><div className="grid gap-5 lg:grid-cols-2"><div className="h-40 animate-pulse rounded-[1.35rem] bg-white shadow-sm" /><div className="h-40 animate-pulse rounded-[1.35rem] bg-white shadow-sm" /></div></div></div></div>; }
function toForm(profile: PlayerProfile): PlayerProfilePayload { return { preferred_sport: "CRICKSAL", skill_level: profile.skill_level || "BEGINNER", location: profile.location || "", weekly_availability: profile.weekly_availability || "", availability_days: profile.availability_days || [], availability_time_periods: profile.availability_time_periods || [], playing_style: profile.playing_style || "", bio: profile.bio || "", preferred_cricksal_role: profile.preferred_cricksal_role || "NONE" }; }
function validateForm(form: PlayerProfilePayload) { const next: FormErrors = {}; if (!form.location.trim()) next.location = "Choose your district."; if (!form.availability_days.length) next.availability_days = "Choose at least one available day."; if (!form.availability_time_periods.length) next.availability_time_periods = "Choose at least one preferred time."; if (!form.playing_style.trim()) next.playing_style = "Add your playing style."; if (form.playing_style.trim().length > 180) next.playing_style = "Playing style must be 180 characters or fewer."; if (form.bio.trim().length > 500) next.bio = "Bio must be 500 characters or fewer."; return next; }
function initials(name: string) { return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "SP"; }
function formatSkill(value?: SkillLevel) { return skills.find((item) => item.value === value)?.label || "Not set"; }
function formatRole(value?: CricksalRole) { return roles.find((item) => item.value === value)?.label || "Not set"; }
function formatDay(value: AvailabilityDay) { return days.find((item) => item.value === value)?.label || value; }
function formatPeriod(value: AvailabilityTimePeriod) { return periods.find((item) => item.value === value)?.label || value; }
function formatRating(value?: string) { const numberValue = Number(value || 0); return Number.isFinite(numberValue) ? numberValue.toFixed(1) : "0.0"; }
function getProfilePhotoSrc(value: string) { if (!value) return ""; if (value.startsWith("blob:") || value.startsWith("http")) return value; const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"; return `${apiBaseUrl}${value}`; }

const inputClassName = "sport-input mt-2";
