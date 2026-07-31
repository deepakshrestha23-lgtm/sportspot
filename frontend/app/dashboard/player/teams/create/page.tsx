"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { TeamPayload, TeamResponse, TeamSkillLevel } from "@/types/team";

const locations = ["Kathmandu", "Lalitpur", "Bhaktapur"];
const skillOptions: Array<{ label: string; value: TeamSkillLevel }> = [
  { label: "Beginner", value: "BEGINNER" },
  { label: "Intermediate", value: "INTERMEDIATE" },
  { label: "Advanced", value: "ADVANCED" },
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

export default function CreateTeamPage() {
  const router = useRouter();
  const [form, setForm] = useState<TeamPayload>(emptyForm);
  const [teamPhotoFile, setTeamPhotoFile] = useState<File | null>(null);
  const [teamPhotoPreview, setTeamPhotoPreview] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const feedbackMessage = error || success;
  const feedbackType = error ? "error" : success ? "success" : "info";

  useEffect(() => {
    return () => {
      if (teamPhotoPreview) URL.revokeObjectURL(teamPhotoPreview);
    };
  }, [teamPhotoPreview]);

  function handleTeamPhotoChange(file: File | null) {
    setError("");

    if (!file) {
      setTeamPhotoFile(null);
      setTeamPhotoPreview("");
      return;
    }

    const allowedTypes = ["image/jpeg", "image/png"];
    if (!allowedTypes.includes(file.type)) {
      setError("Team photo must be JPG, JPEG, or PNG.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError("Team photo must be 2MB or smaller.");
      return;
    }

    if (teamPhotoPreview) URL.revokeObjectURL(teamPhotoPreview);
    setTeamPhotoFile(file);
    setTeamPhotoPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!form.name.trim() || !form.location || !form.preferred_playing_area.trim() || !form.preferred_playing_time) {
      setError("Please fill all required team details.");
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
      setSuccess("Team created successfully.");
      router.push(`/dashboard/player/teams/${response.data.team.id}`);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not create team."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <FeedbackToast message={feedbackMessage} onClose={() => { setError(""); setSuccess(""); }} type={feedbackType} />

      <section className="rounded-lg border border-slate-200 bg-sportNavy p-6 text-white shadow-sm">
        <p className="text-sm font-black uppercase tracking-wide text-green-300">Create Team</p>
        <h1 className="mt-2 text-3xl font-black">Start a Cricksal Team</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          You become the captain automatically. Sport is fixed as Cricksal for the current SportSpot experience.
        </p>
      </section>

      <form className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm" onSubmit={handleSubmit}>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="md:col-span-2 rounded-lg border border-green-200 bg-green-50 p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-sportNavy text-2xl font-black text-white">
                {teamPhotoPreview ? (
                  <Image alt="Team photo preview" className="object-cover" fill sizes="96px" src={teamPhotoPreview} unoptimized />
                ) : (
                  getTeamInitials(form.name || "Team")
                )}
              </div>
              <div className="min-w-0 flex-1">
                <label className="block text-sm font-black text-sportNavy">
                  Team Photo
                  <input
                    accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                    className="mt-2 block w-full text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-sportGreen file:px-4 file:py-2 file:font-black file:text-white hover:file:bg-green-700"
                    onChange={(event) => handleTeamPhotoChange(event.target.files?.[0] || null)}
                    type="file"
                  />
                </label>
                <p className="mt-2 text-xs font-semibold text-slate-600">Optional. JPG, JPEG, or PNG. Max size: 2MB.</p>
              </div>
            </div>
          </div>

          <Field label="Team Name">
            <input className={inputClassName} maxLength={100} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Thamel Tigers" />
          </Field>

          <Field label="Sport">
            <ReadOnlySportBadge />
          </Field>

          <Field className="md:col-span-2" label="Description">
            <textarea className={`${inputClassName} min-h-28 py-3`} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Describe your team style, attitude, or usual match plan" />
          </Field>

          <Field label="Location">
            <select className={inputClassName} required value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })}>
              <option value="">Select city</option>
              {locations.map((location) => (
                <option key={location} value={location}>
                  {location}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Preferred Playing Area">
            <input className={inputClassName} required value={form.preferred_playing_area} onChange={(event) => setForm({ ...form, preferred_playing_area: event.target.value })} placeholder="e.g. Baneshwor, Chabahil, Boudha" />
          </Field>

          <Field label="Preferred Playing Time">
            <select className={inputClassName} required value={form.preferred_playing_time} onChange={(event) => setForm({ ...form, preferred_playing_time: event.target.value })}>
              <option value="">Select time</option>
              {playingTimes.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Skill Level">
            <select className={inputClassName} value={form.skill_level} onChange={(event) => setForm({ ...form, skill_level: event.target.value as TeamSkillLevel })}>
              {skillOptions.map((skill) => (
                <option key={skill.value} value={skill.value}>
                  {skill.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button className="rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700 disabled:bg-slate-400" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Creating Team..." : "Create Team"}
          </button>
          <Link className="rounded-md border border-slate-300 px-5 py-3 text-center text-sm font-black text-slate-700 hover:bg-slate-50" href="/dashboard/player/teams">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

const inputClassName =
  "mt-2 w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sportGreen focus:ring-2 focus:ring-green-100";

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

function getTeamInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}
