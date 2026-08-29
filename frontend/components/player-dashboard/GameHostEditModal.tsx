"use client";

import { useEffect, useState } from "react";

import TimeSelect from "@/components/TimeSelect";
import { buildTimeOptions, formatDateTimeInNepal, joinDateTimeInput, parseDateTimeInput, splitDateTimeInput, toDateTimeInput, toNepalDate } from "@/lib/dates";
import type { GameRole, GameRoleRequirement, GameSkillLevel, MatchmakingGame } from "@/types/matchmaking";

const roles: Array<{ label: string; value: GameRole }> = [
  { label: "Batsman", value: "BATSMAN" },
  { label: "Bowler", value: "BOWLER" },
  { label: "All-rounder", value: "ALL_ROUNDER" },
  { label: "Wicketkeeper", value: "WICKETKEEPER" },
  { label: "Any role", value: "ANY" },
];

export type GameHostEditValues = {
  title: string;
  description: string;
  host_notes: string;
  reporting_instructions: string;
  equipment_instructions: string;
  game_intensity: MatchmakingGame["game_intensity"];
  min_skill_level: GameSkillLevel;
  total_capacity: number;
  minimum_players_to_proceed: number;
  waitlist_enabled: boolean;
  recruitment_deadline: string;
  proposed_date: string;
  proposed_start_time: string;
  proposed_end_time: string;
  preferred_district: string;
  preferred_area: string;
  preferred_venue_name: string;
  alternative_details: string;
  booking_deadline: string;
  role_requirements: Array<{ role: GameRole; required_count: number }>;
};

type GameHostEditModalProps = {
  game: MatchmakingGame;
  isSaving: boolean;
  onClose: () => void;
  onSave: (values: GameHostEditValues) => void;
};

function initialValues(game: MatchmakingGame): GameHostEditValues {
  const counts = Object.fromEntries(roles.map((role) => [role.value, 0])) as Record<GameRole, number>;
  game.role_requirements.forEach((requirement: GameRoleRequirement) => {
    counts[requirement.role] = requirement.required_count;
  });
  return {
    title: game.title,
    description: game.description || "",
    host_notes: game.host_notes || "",
    reporting_instructions: game.reporting_instructions || "",
    equipment_instructions: game.equipment_instructions || "",
    game_intensity: game.game_intensity,
    min_skill_level: game.min_skill_level,
    total_capacity: game.total_capacity,
    minimum_players_to_proceed: game.minimum_players_to_proceed,
    waitlist_enabled: game.waitlist_enabled,
    recruitment_deadline: toDateTimeInput(game.recruitment_deadline),
    proposed_date: game.proposed_date || "",
    proposed_start_time: game.proposed_start_time?.slice(0, 5) || "",
    proposed_end_time: game.proposed_end_time?.slice(0, 5) || "",
    preferred_district: game.preferred_district || "",
    preferred_area: game.preferred_area || "",
    preferred_venue_name: game.preferred_venue_name || "",
    alternative_details: game.alternative_details || "",
    booking_deadline: toDateTimeInput(game.booking_deadline),
    role_requirements: roles.map((role) => ({ role: role.value, required_count: counts[role.value] })),
  };
}

export default function GameHostEditModal({ game, isSaving, onClose, onSave }: GameHostEditModalProps) {
  const [values, setValues] = useState(() => initialValues(game));
  const [activeSection, setActiveSection] = useState<"details" | "schedule" | "roles">("details");

  useEffect(() => {
    setValues(initialValues(game));
  }, [game]);

  const isPlanFirst = game.creation_mode === "PLAN_FIRST" && !game.is_booking_verified;
  const setValue = <K extends keyof GameHostEditValues>(key: K, value: GameHostEditValues[K]) => setValues((current) => ({ ...current, [key]: value }));
  const setRoleCount = (role: GameRole, value: number) => setValues((current) => ({
    ...current,
    role_requirements: current.role_requirements.map((item) => item.role === role ? { ...item, required_count: Math.max(0, Math.min(30, value)) } : item),
  }));
  const inputClass = "mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-sportGreen focus:ring-2 focus:ring-green-100";
  const recruitmentDeadline = parseDateTimeInput(values.recruitment_deadline);
  const bookingDeadline = parseDateTimeInput(values.booking_deadline);
  const scheduleError = isPlanFirst && recruitmentDeadline && bookingDeadline && bookingDeadline.getTime() - recruitmentDeadline.getTime() < 30 * 60 * 1000
    ? `Recruitment must close by ${formatDateTimeInNepal(new Date(bookingDeadline.getTime() - 30 * 60 * 1000).toISOString(), { dateStyle: "medium", timeStyle: "short" })}, at least 30 minutes before the ${formatDateTimeInNepal(bookingDeadline.toISOString(), { dateStyle: "medium", timeStyle: "short" })} court-booking deadline.`
    : "";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (scheduleError) {
      setActiveSection("schedule");
      return;
    }
    onSave({
      ...values,
      role_requirements: values.role_requirements.filter((item) => item.required_count > 0),
    });
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" role="presentation">
      <section aria-labelledby="edit-game-title" aria-modal="true" className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6" role="dialog">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sportGreen">Host controls</p>
            <h2 className="mt-1 text-2xl font-black text-sportNavy" id="edit-game-title">Edit game details</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">Update the listing while protecting confirmed players and booking details.</p>
          </div>
          <button aria-label="Close edit game dialog" className="rounded-full p-2 text-xl text-slate-500 hover:bg-slate-100" onClick={onClose} type="button">×</button>
        </div>

        <div className="mt-5 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
          {([['details', 'Details'], ['schedule', 'Schedule'], ['roles', 'Roles']] as const).map(([key, label]) => (
            <button className={`min-h-10 whitespace-nowrap rounded-lg px-4 text-sm font-black ${activeSection === key ? "bg-white text-sportGreen shadow-sm" : "text-slate-500"}`} key={key} onClick={() => setActiveSection(key)} type="button">{label}</button>
          ))}
        </div>

        <form className="mt-5" onSubmit={submit}>
          {activeSection === "details" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2 text-sm font-black text-slate-700">Game title<input className={inputClass} maxLength={120} required value={values.title} onChange={(event) => setValue("title", event.target.value)} /></label>
              <label className="text-sm font-black text-slate-700">Game format<select className={inputClass} value={values.game_intensity} onChange={(event) => setValue("game_intensity", event.target.value as MatchmakingGame["game_intensity"])}><option value="CASUAL">Casual</option><option value="COMPETITIVE">Competitive</option><option value="PRACTICE">Practice / Friendly</option></select></label>
              <label className="text-sm font-black text-slate-700">Skill level<select className={inputClass} value={values.min_skill_level} onChange={(event) => setValue("min_skill_level", event.target.value as GameSkillLevel)}><option value="OPEN">Open to all</option><option value="BEGINNER">Beginner+</option><option value="INTERMEDIATE">Intermediate+</option><option value="ADVANCED">Advanced only</option></select></label>
              <label className="sm:col-span-2 text-sm font-black text-slate-700">Description<textarea className={`${inputClass} h-24 py-3`} maxLength={800} value={values.description} onChange={(event) => setValue("description", event.target.value)} /></label>
              <label className="text-sm font-black text-slate-700">Total player spots<input className={inputClass} max={30} min={2} type="number" value={values.total_capacity} onChange={(event) => setValue("total_capacity", Number(event.target.value))} /></label>
              <label className="text-sm font-black text-slate-700">Minimum to proceed<input className={inputClass} max={values.total_capacity} min={2} type="number" value={values.minimum_players_to_proceed} onChange={(event) => setValue("minimum_players_to_proceed", Number(event.target.value))} /></label>
              <label className="sm:col-span-2 text-sm font-black text-slate-700">Reporting instructions<textarea className={`${inputClass} h-20 py-3`} maxLength={500} placeholder="Where and when players should report" value={values.reporting_instructions} onChange={(event) => setValue("reporting_instructions", event.target.value)} /></label>
              <label className="text-sm font-black text-slate-700">Host notes <span className="font-semibold text-slate-400">private</span><textarea className={`${inputClass} h-20 py-3`} maxLength={500} placeholder="Notes for your own planning" value={values.host_notes} onChange={(event) => setValue("host_notes", event.target.value)} /></label>
              <label className="text-sm font-black text-slate-700">Equipment instructions<textarea className={`${inputClass} h-20 py-3`} maxLength={500} placeholder="What players should bring" value={values.equipment_instructions} onChange={(event) => setValue("equipment_instructions", event.target.value)} /></label>
              <label className="sm:col-span-2 flex min-h-11 items-center gap-3 rounded-xl bg-slate-50 px-3 text-sm font-bold text-slate-700"><input checked={values.waitlist_enabled} className="h-4 w-4 accent-green-700" onChange={(event) => setValue("waitlist_enabled", event.target.checked)} type="checkbox" /> Allow a waitlist when all player spots are filled</label>
            </div>
          ) : null}

          {activeSection === "schedule" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <DateTimeField helper="Players can request to join until this time. This must come first." inputClass={inputClass} label="Recruitment closes" onChange={(value) => setValue("recruitment_deadline", value)} value={values.recruitment_deadline} />
              {isPlanFirst ? <DateTimeField helper="Secure and pay for the court by this time, at least 1 hour before the game." inputClass={inputClass} label="Court booking deadline" onChange={(value) => setValue("booking_deadline", value)} value={values.booking_deadline} /> : null}
              {scheduleError ? <p className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-900">{scheduleError}</p> : null}
              {isPlanFirst ? <>
                <label className="text-sm font-black text-slate-700">Proposed date<input className={inputClass} required type="date" value={values.proposed_date} onChange={(event) => setValue("proposed_date", event.target.value)} /></label>
                <label className="text-sm font-black text-slate-700">Preferred district<input className={inputClass} value={values.preferred_district} onChange={(event) => setValue("preferred_district", event.target.value)} /></label>
                <label className="text-sm font-black text-slate-700">Start time<TimeSelect ariaLabel="Proposed start time" className={inputClass} options={buildTimeOptions()} required value={values.proposed_start_time} onChange={(value) => setValue("proposed_start_time", value)} /></label>
                <label className="text-sm font-black text-slate-700">End time<TimeSelect ariaLabel="Proposed end time" className={inputClass} options={buildTimeOptions()} required value={values.proposed_end_time} onChange={(value) => setValue("proposed_end_time", value)} /></label>
                <label className="text-sm font-black text-slate-700">Preferred area<input className={inputClass} required value={values.preferred_area} onChange={(event) => setValue("preferred_area", event.target.value)} /></label>
                <label className="text-sm font-black text-slate-700">Preferred venue <span className="font-semibold text-slate-400">optional</span><input className={inputClass} value={values.preferred_venue_name} onChange={(event) => setValue("preferred_venue_name", event.target.value)} /></label>
                <label className="sm:col-span-2 text-sm font-black text-slate-700">Alternative area or time <span className="font-semibold text-slate-400">optional</span><input className={inputClass} value={values.alternative_details} onChange={(event) => setValue("alternative_details", event.target.value)} /></label>
                <p className="sm:col-span-2 rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold leading-6 text-blue-800">Changing the proposed date, time, or area will ask existing players to reconfirm their spot.</p>
              </> : <p className="sm:col-span-2 rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-600">Your confirmed booking controls the venue, court, date, and time. You can extend or bring forward recruitment within the booking time.</p>}
            </div>
          ) : null}

          {activeSection === "roles" ? (
            <div>
              <p className="text-sm font-semibold leading-6 text-slate-600">Adjust which Cricksal roles you are still recruiting. A role cannot be reduced below players already accepted into it.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {roles.map((role) => {
                  const current = values.role_requirements.find((item) => item.role === role.value)?.required_count || 0;
                  return <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-4" key={role.value}><div><p className="font-black text-slate-800">{role.label}</p><p className="text-xs font-semibold text-slate-500">Temporary or guest spots</p></div><div className="flex items-center gap-2"><button aria-label={`Decrease ${role.label} spots`} className="h-9 w-9 rounded-lg border border-slate-200 font-black text-slate-600 hover:border-green-300" onClick={() => setRoleCount(role.value, current - 1)} type="button">−</button><span className="w-7 text-center font-black text-sportNavy">{current}</span><button aria-label={`Increase ${role.label} spots`} className="h-9 w-9 rounded-lg border border-slate-200 font-black text-slate-600 hover:border-green-300" onClick={() => setRoleCount(role.value, current + 1)} type="button">+</button></div></div>;
                })}
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
            <button className="min-h-11 rounded-xl border border-slate-200 px-5 text-sm font-black text-slate-600 hover:bg-slate-50" disabled={isSaving} onClick={onClose} type="button">Cancel</button>
            <button className="min-h-11 rounded-xl bg-sportGreen px-5 text-sm font-black text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60" disabled={isSaving} type="submit">{isSaving ? "Saving changes..." : "Save changes"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function DateTimeField({ helper, inputClass, label, onChange, value }: { helper: string; inputClass: string; label: string; onChange: (value: string) => void; value: string }) {
  const [date, time] = splitDateTimeInput(value);
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-black text-slate-700">{label}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1.15fr_1fr]">
        <label className="sr-only" htmlFor={`${id}-date`}>{label} date</label>
        <input aria-label={`${label} date`} className={inputClass} id={`${id}-date`} min={toNepalDate(new Date())} required type="date" value={date} onChange={(event) => onChange(joinDateTimeInput(event.target.value, time))} />
        <label className="sr-only" htmlFor={`${id}-time`}>{label} time</label>
        <TimeSelect ariaLabel={`${label} time`} className={inputClass} id={`${id}-time`} options={buildTimeOptions()} required value={time} onChange={(nextTime) => onChange(joinDateTimeInput(date, nextTime))} />
      </div>
      <span className="mt-1 block text-xs font-semibold text-slate-500">{helper}</span>
    </fieldset>
  );
}
