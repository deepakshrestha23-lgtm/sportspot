"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { DashboardPageHeader } from "@/components/player-dashboard/DashboardPageHeader";
import { api } from "@/lib/api";
import { getApiErrorField, getApiErrorMessage } from "@/lib/apiErrors";
import { emitToast } from "@/lib/toast";
import type { TeamPayload, TeamResponse, TeamSkillLevel } from "@/types/team";

const locations = ["Kathmandu", "Lalitpur", "Bhaktapur"];
const skillOptions: Array<{ label: string; value: TeamSkillLevel; helper: string }> = [
  { label: "Beginner", value: "BEGINNER", helper: "New or casual team" },
  { label: "Intermediate", value: "INTERMEDIATE", helper: "Regular match rhythm" },
  { label: "Advanced", value: "ADVANCED", helper: "Competitive squad" },
];
const playingTimes = [
  "Weekday evenings",
  "Saturday morning",
  "Saturday afternoon",
  "Saturday evening",
  "Sunday morning",
  "Sunday afternoon",
  "Sunday evening",
  "Flexible",
];

const emptyForm: TeamPayload = {
  name: "",
  description: "",
  location: "",
  preferred_playing_area: "",
  preferred_playing_time: "",
  skill_level: "BEGINNER",
};

type FormErrors = Partial<Record<keyof TeamPayload | "team_photo", string>>;

export default function CreateTeamPage() {
  const router = useRouter();
  const [form, setForm] = useState<TeamPayload>(emptyForm);
  const [teamPhotoFile, setTeamPhotoFile] = useState<File | null>(null);
  const [teamPhotoPreview, setTeamPhotoPreview] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    return () => {
      if (teamPhotoPreview) URL.revokeObjectURL(teamPhotoPreview);
    };
  }, [teamPhotoPreview]);

  const selectedSkill = useMemo(() => skillOptions.find((skill) => skill.value === form.skill_level) || skillOptions[0], [form.skill_level]);

  function updateForm(next: Partial<TeamPayload>) {
    setForm((current) => ({ ...current, ...next }));
    setErrors((current) => {
      const updated = { ...current };
      Object.keys(next).forEach((key) => delete updated[key as keyof TeamPayload]);
      return updated;
    });
  }

  function handleTeamPhotoChange(file: File | null) {
    setErrors((current) => ({ ...current, team_photo: "" }));

    if (!file) {
      setTeamPhotoFile(null);
      if (teamPhotoPreview) URL.revokeObjectURL(teamPhotoPreview);
      setTeamPhotoPreview("");
      return;
    }

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setErrors((current) => ({ ...current, team_photo: "Please upload a JPG, JPEG, or PNG image." }));
      emitToast({ message: "Please upload a JPG, JPEG, or PNG image.", type: "error", dedupeKey: "team-photo-type" });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setErrors((current) => ({ ...current, team_photo: "Team photo must be 2MB or smaller." }));
      emitToast({ message: "Team photo must be 2MB or smaller.", type: "error", dedupeKey: "team-photo-size" });
      return;
    }

    if (teamPhotoPreview) URL.revokeObjectURL(teamPhotoPreview);
    setTeamPhotoFile(file);
    setTeamPhotoPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationErrors = validateForm(form);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length) {
      emitToast({ message: "Please check the highlighted team details.", type: "error", dedupeKey: "create-team-validation" });
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = new FormData();
      payload.append("name", form.name.trim());
      payload.append("description", form.description.trim());
      payload.append("location", form.location);
      payload.append("preferred_playing_area", form.preferred_playing_area.trim());
      payload.append("preferred_playing_time", form.preferred_playing_time);
      payload.append("skill_level", form.skill_level);

      if (teamPhotoFile) {
        payload.append("team_photo", teamPhotoFile);
      }

      const response = await api.post<TeamResponse>("/api/teams/", payload);
      emitToast({ message: "Your team has been created.", type: "success", dedupeKey: "team-created" });
      router.push(`/dashboard/player/teams/${response.data.team.id}`);
    } catch (requestError) {
      setErrors({
        name: getApiErrorField(requestError, "name") || "",
        description: getApiErrorField(requestError, "description") || "",
        location: getApiErrorField(requestError, "location") || "",
        preferred_playing_area: getApiErrorField(requestError, "preferred_playing_area") || "",
        preferred_playing_time: getApiErrorField(requestError, "preferred_playing_time") || "",
        skill_level: getApiErrorField(requestError, "skill_level") || "",
        team_photo: getApiErrorField(requestError, "team_photo") || "",
      });
      getApiErrorMessage(requestError, "We could not create your team. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <DashboardPageHeader
        actions={
          <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-black text-sportNavy transition hover:border-sportGreen hover:text-sportGreen focus:outline-none focus:ring-2 focus:ring-green-200" href="/dashboard/player/teams">
            Back to Teams
          </Link>
        }
        eyebrow="Cricksal squads"
        title="Create Team"
        description="Build a team profile, invite players, and manage your Cricksal squad from SportSpot."
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <form className="space-y-5" onSubmit={handleSubmit}>
          <FormCard title="Team Identity" description="Add the basic details players will see before joining your team.">
            <div className="grid gap-5 lg:grid-cols-[180px_minmax(0,1fr)]">
              <div>
                <TeamPhotoPicker error={errors.team_photo} name={form.name} preview={teamPhotoPreview} onChange={handleTeamPhotoChange} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field error={errors.name} label="Team Name" required>
                  <input className={inputClassName(errors.name)} maxLength={100} onChange={(event) => updateForm({ name: event.target.value })} placeholder="e.g. Baneshwor Strikers" value={form.name} />
                </Field>
                <Field label="Sport">
                  <ReadOnlySportBadge />
                </Field>
                <Field className="md:col-span-2" error={errors.description} label="Description">
                  <textarea className={`${inputClassName(errors.description)} min-h-28 resize-y py-3`} maxLength={500} onChange={(event) => updateForm({ description: event.target.value })} placeholder="Share your team style, values, and the kind of players you want to play with." value={form.description} />
                </Field>
              </div>
            </div>
          </FormCard>

          <FormCard title="Playing Preferences" description="Set where and when your team usually plays.">
            <div className="grid gap-4 md:grid-cols-2">
              <Field error={errors.location} label="Home District" required>
                <select className={inputClassName(errors.location)} onChange={(event) => updateForm({ location: event.target.value })} value={form.location}>
                  <option value="">Select district</option>
                  {locations.map((location) => (
                    <option key={location} value={location}>{location}</option>
                  ))}
                </select>
              </Field>
              <Field error={errors.preferred_playing_area} label="Preferred Playing Area" required>
                <input className={inputClassName(errors.preferred_playing_area)} onChange={(event) => updateForm({ preferred_playing_area: event.target.value })} placeholder="e.g. Baneshwor, Chabahil" value={form.preferred_playing_area} />
              </Field>
              <Field className="md:col-span-2" error={errors.preferred_playing_time} label="Preferred Playing Time" required>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {playingTimes.map((time) => {
                    const active = form.preferred_playing_time === time;
                    return (
                      <button
                        className={`min-h-11 rounded-xl border px-3 text-left text-sm font-black transition focus:outline-none focus:ring-2 focus:ring-green-200 ${active ? "border-sportGreen bg-green-50 text-sportGreen" : "border-slate-200 bg-white text-slate-700 hover:border-green-200 hover:bg-slate-50"}`}
                        key={time}
                        onClick={() => updateForm({ preferred_playing_time: time })}
                        type="button"
                      >
                        {time}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>
          </FormCard>

          <FormCard title="Team Level" description="Choose the level that best matches your regular team strength.">
            <div className="grid gap-3 md:grid-cols-3">
              {skillOptions.map((skill) => {
                const active = form.skill_level === skill.value;
                return (
                  <button
                    className={`rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-green-200 ${active ? "border-sportGreen bg-green-50 shadow-sm" : "border-slate-200 bg-white hover:border-green-200 hover:bg-slate-50"}`}
                    key={skill.value}
                    onClick={() => updateForm({ skill_level: skill.value })}
                    type="button"
                  >
                    <span className={`block text-sm font-black ${active ? "text-sportGreen" : "text-sportNavy"}`}>{skill.label}</span>
                    <span className="mt-1 block text-xs font-semibold text-slate-500">{skill.helper}</span>
                  </button>
                );
              })}
            </div>
            {errors.skill_level ? <p className="mt-2 text-xs font-semibold text-red-600">{errors.skill_level}</p> : null}
          </FormCard>

          <div className="flex flex-col-reverse gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:justify-end">
            <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-5 text-sm font-black text-sportNavy transition hover:border-sportGreen hover:text-sportGreen focus:outline-none focus:ring-2 focus:ring-green-200" href="/dashboard/player/teams">
              Cancel
            </Link>
            <button className="inline-flex min-h-11 items-center justify-center rounded-xl bg-sportGreen px-6 text-sm font-black text-white shadow-sm transition hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-200 disabled:cursor-not-allowed disabled:opacity-60" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Creating Team..." : "Create Team"}
            </button>
          </div>
        </form>

        <aside className="space-y-5 xl:sticky xl:top-24 xl:self-start">
          <TeamPreview form={form} photoPreview={teamPhotoPreview} selectedSkill={selectedSkill} />
          <section className="rounded-2xl border border-green-100 bg-green-50 p-5">
            <p className="text-sm font-black uppercase tracking-[0.14em] text-sportGreen">After creation</p>
            <ul className="mt-4 space-y-3 text-sm font-semibold leading-6 text-green-950">
              <li>Your account becomes the team captain.</li>
              <li>You can invite registered players by SportSpot ID.</li>
              <li>You can add guest players from the team page.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function validateForm(form: TeamPayload) {
  const nextErrors: FormErrors = {};
  if (!form.name.trim()) nextErrors.name = "Enter a team name.";
  if (!form.location) nextErrors.location = "Select your home district.";
  if (!form.preferred_playing_area.trim()) nextErrors.preferred_playing_area = "Enter your preferred playing area.";
  if (!form.preferred_playing_time) nextErrors.preferred_playing_time = "Choose your preferred playing time.";
  return nextErrors;
}

function FormCard({ children, description, title }: { children: ReactNode; description: string; title: string }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5">
        <h2 className="text-xl font-black text-sportNavy">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
      </div>
      {children}
    </section>
  );
}

function TeamPhotoPicker({ error, name, onChange, preview }: { error?: string; name: string; onChange: (file: File | null) => void; preview: string }) {
  return (
    <div>
      <p className="text-sm font-black text-sportNavy">Team Photo</p>
      <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="relative mx-auto flex h-32 w-32 items-center justify-center overflow-hidden rounded-2xl bg-sportNavy text-3xl font-black text-white shadow-sm">
          {preview ? <Image alt="Team photo preview" className="object-cover" fill sizes="128px" src={preview} unoptimized /> : getTeamInitials(name || "Team")}
        </div>
        <label className="mt-4 flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-sportGreen px-4 text-center text-sm font-black text-white transition hover:bg-green-700 focus-within:ring-2 focus-within:ring-green-200">
          Upload Photo
          <input accept=".jpg,.jpeg,.png,image/jpeg,image/png" className="sr-only" onChange={(event) => onChange(event.target.files?.[0] || null)} type="file" />
        </label>
        {preview ? (
          <button className="mt-2 min-h-10 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 transition hover:border-red-200 hover:text-red-600" onClick={() => onChange(null)} type="button">
            Remove Photo
          </button>
        ) : null}
        <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">Optional. JPG, JPEG, or PNG. Max size: 2MB.</p>
      </div>
      {error ? <p className="mt-2 text-xs font-semibold text-red-600">{error}</p> : null}
    </div>
  );
}

function TeamPreview({ form, photoPreview, selectedSkill }: { form: TeamPayload; photoPreview: string; selectedSkill: { label: string; helper: string; value: TeamSkillLevel } }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="bg-sportNavy p-5 text-white">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-green-300">Preview</p>
        <p className="mt-1 text-sm font-semibold text-slate-300">This is how your team starts to look.</p>
      </div>
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-sportNavy text-lg font-black text-white">
            {photoPreview ? <Image alt="Team preview" className="object-cover" fill sizes="64px" src={photoPreview} unoptimized /> : getTeamInitials(form.name || "Team")}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-black text-sportNavy">{form.name.trim() || "Team name"}</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">{form.location || "Home district"}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <PreviewBadge label="Cricksal" tone="green" />
          <PreviewBadge label={selectedSkill.label} />
          <PreviewBadge label="Captain" tone="green" />
        </div>

        <div className="mt-5 space-y-3 border-t border-slate-100 pt-5">
          <PreviewRow label="Playing area" value={form.preferred_playing_area.trim() || "Add preferred area"} />
          <PreviewRow label="Playing time" value={form.preferred_playing_time || "Choose preferred time"} />
          <PreviewRow label="Team level" value={selectedSkill.helper} />
        </div>

        <p className="mt-5 line-clamp-4 rounded-2xl bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-600">
          {form.description.trim() || "Add a short description so players understand your squad before joining."}
        </p>
      </div>
    </section>
  );
}

function Field({ children, className = "", error, label, required = false }: { children: ReactNode; className?: string; error?: string; label: string; required?: boolean }) {
  return (
    <label className={`block text-sm font-black text-sportNavy ${className}`}>
      <span>
        {label} {required ? <span className="text-sportGreen">*</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs font-semibold text-red-600">{error}</span> : null}
    </label>
  );
}

function ReadOnlySportBadge() {
  return (
    <div className="mt-2 flex min-h-12 w-full items-center justify-between rounded-xl border border-green-200 bg-green-50 px-4 text-sm">
      <span className="font-black text-sportNavy">Cricksal</span>
      <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-sportGreen">Fixed</span>
    </div>
  );
}

function PreviewBadge({ label, tone = "slate" }: { label: string; tone?: "green" | "slate" }) {
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${tone === "green" ? "bg-green-50 text-sportGreen" : "bg-slate-100 text-slate-600"}`}>{label}</span>;
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <span className="max-w-[190px] text-right text-sm font-black text-sportNavy">{value}</span>
    </div>
  );
}

function inputClassName(error?: string) {
  return `mt-2 min-h-12 w-full rounded-xl border bg-white px-4 text-sm font-semibold text-sportNavy outline-none transition placeholder:text-slate-400 focus:ring-4 focus:ring-green-100 ${error ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-sportGreen"}`;
}

function getTeamInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}