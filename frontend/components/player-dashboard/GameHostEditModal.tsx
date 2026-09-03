"use client";

import { useEffect, useState } from "react";

import LoadingIndicator from "@/components/LoadingIndicator";
import ServiceAreaPicker, { type ServiceAreaSelection } from "@/components/location/ServiceAreaPicker";
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
  preferred_area_code: string;
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
    preferred_area_code: game.preferred_area_code || "",
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSaving, onClose]);

  const isPlanFirst = game.creation_mode === "PLAN_FIRST" && !game.is_booking_verified;
  const setValue = <K extends keyof GameHostEditValues>(key: K, value: GameHostEditValues[K]) => setValues((current) => ({ ...current, [key]: value }));
  const setRoleCount = (role: GameRole, value: number) => setValues((current) => ({
    ...current,
    role_requirements: current.role_requirements.map((item) => item.role === role ? { ...item, required_count: Math.max(0, Math.min(30, value)) } : item),
  }));
  const inputClass = "mt-2 min-h-11 w-full rounded-md border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-sportGreen focus:ring-2 focus:ring-green-100";
  const recruitmentDeadline = parseDateTimeInput(values.recruitment_deadline);
  const bookingDeadline = parseDateTimeInput(values.booking_deadline);
  const scheduleError = isPlanFirst && recruitmentDeadline && bookingDeadline && bookingDeadline.getTime() - recruitmentDeadline.getTime() < 30 * 60 * 1000
    ? `Recruitment must close by ${formatDateTimeInNepal(new Date(bookingDeadline.getTime() - 30 * 60 * 1000).toISOString(), { dateStyle: "medium", timeStyle: "short" })}, at least 30 minutes before the ${formatDateTimeInNepal(bookingDeadline.toISOString(), { dateStyle: "medium", timeStyle: "short" })} court-booking deadline.`
    : "";
  const selectedServiceArea: ServiceAreaSelection | null = values.preferred_area_code && values.preferred_area && values.preferred_district
    ? { code: values.preferred_area_code, area: values.preferred_area, district: values.preferred_district }
    : null;

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

  const sectionLabels = [
    ["details", "Details", "Listing basics"],
    ["schedule", "Schedule", "Timing and location"],
    ["roles", "Roles", "Squad balance"],
  ] as const;
  const activeSectionIndex = sectionLabels.findIndex(([key]) => key === activeSection) + 1;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-sportNavy/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="presentation">
      <section aria-describedby="edit-game-description" aria-labelledby="edit-game-title" aria-modal="true" className="flex max-h-[100dvh] min-h-0 w-full max-w-4xl flex-col overflow-hidden bg-white shadow-2xl sm:max-h-[min(900px,calc(100dvh-2.5rem))] sm:rounded-2xl sm:border sm:border-slate-200" role="dialog">
        <header className="flex shrink-0 items-start justify-between gap-5 border-b border-slate-200 px-5 py-5 sm:px-7 sm:py-6">
          <div className="min-w-0">
            <p className="sport-eyebrow">Host controls</p>
            <h2 className="mt-1 text-2xl font-black text-sportNavy sm:text-[1.75rem]" id="edit-game-title">Edit game details</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600" id="edit-game-description">Update the listing while protecting confirmed players and booking details.</p>
          </div>
          <button aria-label="Close edit game dialog" className="sport-icon-button shrink-0" disabled={isSaving} onClick={onClose} title="Close" type="button"><CloseIcon /></button>
        </header>

        <div className="shrink-0 border-b border-slate-200 bg-slate-50/80 px-5 py-4 sm:px-7">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Edit listing</p>
              <p className="mt-1 text-sm font-semibold text-slate-700">Step {activeSectionIndex} of {sectionLabels.length}</p>
            </div>
            <span className="hidden text-xs font-bold text-slate-500 sm:block">Changes save to this game</span>
          </div>
          <div aria-label="Edit game sections" className="mt-3 grid grid-cols-3 gap-2" role="tablist">
            {sectionLabels.map(([key, label, description]) => (
              <button aria-controls={`edit-game-panel-${key}`} aria-selected={activeSection === key} className={`min-h-12 rounded-md border px-3 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-green-300 focus-visible:ring-offset-1 ${activeSection === key ? "border-green-200 bg-white text-sportGreen shadow-sm" : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-white"}`} key={key} onClick={() => setActiveSection(key)} role="tab" type="button"><span className="block text-sm font-black">{label}</span><span className="mt-0.5 hidden text-xs font-semibold text-slate-500 sm:block">{description}</span></button>
            ))}
          </div>
        </div>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7 sm:py-7">
            {activeSection === "details" ? (
              <div aria-labelledby="edit-game-panel-details-heading" className="space-y-6" id="edit-game-panel-details" role="tabpanel">
                <PanelHeading eyebrow="Listing basics" heading="What players see" text="Keep the public game information clear, accurate, and easy to scan." id="edit-game-panel-details-heading" />
                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="block text-sm font-black text-slate-700 sm:col-span-2">Game title<input className={inputClass} maxLength={120} required value={values.title} onChange={(event) => setValue("title", event.target.value)} /></label>
                  <label className="block text-sm font-black text-slate-700">Game format<select className={inputClass} value={values.game_intensity} onChange={(event) => setValue("game_intensity", event.target.value as MatchmakingGame["game_intensity"])}><option value="CASUAL">Casual</option><option value="COMPETITIVE">Competitive</option><option value="PRACTICE">Practice / Friendly</option></select></label>
                  <label className="block text-sm font-black text-slate-700">Skill level<select className={inputClass} value={values.min_skill_level} onChange={(event) => setValue("min_skill_level", event.target.value as GameSkillLevel)}><option value="OPEN">Open to all</option><option value="BEGINNER">Beginner+</option><option value="INTERMEDIATE">Intermediate+</option><option value="ADVANCED">Advanced only</option></select></label>
                  <label className="block text-sm font-black text-slate-700 sm:col-span-2">Description<textarea className={`${inputClass} min-h-28 resize-y`} maxLength={800} value={values.description} onChange={(event) => setValue("description", event.target.value)} /></label>
                  <label className="block text-sm font-black text-slate-700">Total player spots<input className={inputClass} max={30} min={2} type="number" value={values.total_capacity} onChange={(event) => setValue("total_capacity", Number(event.target.value))} /></label>
                  <label className="block text-sm font-black text-slate-700">Minimum to proceed<input className={inputClass} max={values.total_capacity} min={2} type="number" value={values.minimum_players_to_proceed} onChange={(event) => setValue("minimum_players_to_proceed", Number(event.target.value))} /></label>
                </div>
                <div className="border-t border-slate-200 pt-6">
                  <PanelHeading eyebrow="Match-day notes" heading="Help players arrive prepared" text="These instructions are shown in the game room." />
                  <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    <label className="block text-sm font-black text-slate-700 sm:col-span-2">Reporting instructions<textarea className={`${inputClass} min-h-24 resize-y`} maxLength={500} placeholder="Where and when players should report" value={values.reporting_instructions} onChange={(event) => setValue("reporting_instructions", event.target.value)} /></label>
                    <label className="block text-sm font-black text-slate-700">Host notes <span className="font-semibold text-slate-400">Private</span><textarea className={`${inputClass} min-h-24 resize-y`} maxLength={500} placeholder="Notes for your own planning" value={values.host_notes} onChange={(event) => setValue("host_notes", event.target.value)} /></label>
                    <label className="block text-sm font-black text-slate-700">Equipment instructions<textarea className={`${inputClass} min-h-24 resize-y`} maxLength={500} placeholder="What players should bring" value={values.equipment_instructions} onChange={(event) => setValue("equipment_instructions", event.target.value)} /></label>
                  </div>
                </div>
                <label className="flex min-h-12 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm font-bold text-slate-700"><input checked={values.waitlist_enabled} className="h-4 w-4 accent-green-700" onChange={(event) => setValue("waitlist_enabled", event.target.checked)} type="checkbox" /> Allow a waitlist when all player spots are filled</label>
              </div>
            ) : null}

            {activeSection === "schedule" ? (
              <div aria-labelledby="edit-game-panel-schedule-heading" className="space-y-6" id="edit-game-panel-schedule" role="tabpanel">
                <PanelHeading eyebrow="Timing and location" heading="Set the planning window" text="Recruitment closes before the host must finalize a court booking." id="edit-game-panel-schedule-heading" />
                <div className="grid gap-5 sm:grid-cols-2">
                  <DateTimeField helper="Players can request to join until this time. This must come first." inputClass={inputClass} label="Recruitment closes" onChange={(value) => setValue("recruitment_deadline", value)} value={values.recruitment_deadline} />
                  {isPlanFirst ? <DateTimeField helper="Secure and pay for the court by this time, at least 1 hour before the game." inputClass={inputClass} label="Court booking deadline" onChange={(value) => setValue("booking_deadline", value)} value={values.booking_deadline} /> : null}
                  {scheduleError ? <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-900 sm:col-span-2" role="alert">{scheduleError}</p> : null}
                  {isPlanFirst ? <>
                    <label className="block text-sm font-black text-slate-700">Proposed date<input className={inputClass} required type="date" value={values.proposed_date} onChange={(event) => setValue("proposed_date", event.target.value)} /></label>
                    <label className="block text-sm font-black text-slate-700">Start time<TimeSelect ariaLabel="Proposed start time" className={inputClass} options={buildTimeOptions()} required value={values.proposed_start_time} onChange={(value) => setValue("proposed_start_time", value)} /></label>
                    <label className="block text-sm font-black text-slate-700">End time<TimeSelect ariaLabel="Proposed end time" className={inputClass} options={buildTimeOptions()} required value={values.proposed_end_time} onChange={(value) => setValue("proposed_end_time", value)} /></label>
                    <label className="block text-sm font-black text-slate-700">Preferred venue <span className="font-semibold text-slate-400">Optional</span><input className={inputClass} value={values.preferred_venue_name} onChange={(event) => setValue("preferred_venue_name", event.target.value)} /></label>
                    <div className="sm:col-span-2"><ServiceAreaPicker compact id="edit-game-service-area" onChange={(selection) => setValues((current) => ({ ...current, preferred_area_code: selection.code, preferred_area: selection.area, preferred_district: selection.district }))} value={selectedServiceArea} /></div>
                    <label className="block text-sm font-black text-slate-700 sm:col-span-2">Alternative area or time <span className="font-semibold text-slate-400">Optional</span><input className={inputClass} value={values.alternative_details} onChange={(event) => setValue("alternative_details", event.target.value)} /></label>
                    <p className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold leading-6 text-blue-800 sm:col-span-2">Changing the proposed date, time, or area will ask existing players to reconfirm their spot.</p>
                  </> : <p className="rounded-md bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-600 sm:col-span-2">Your confirmed booking controls the venue, court, date, and time. You can extend or bring forward recruitment within the booking time.</p>}
                </div>
              </div>
            ) : null}

            {activeSection === "roles" ? (
              <div aria-labelledby="edit-game-panel-roles-heading" className="space-y-6" id="edit-game-panel-roles" role="tabpanel">
                <PanelHeading eyebrow="Squad balance" heading="Choose the roles you need" text="Adjust recruitment targets without reducing a role below players already accepted into it." id="edit-game-panel-roles-heading" />
                <div className="grid gap-3 sm:grid-cols-2">
                  {roles.map((role) => {
                    const current = values.role_requirements.find((item) => item.role === role.value)?.required_count || 0;
                    return <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-4" key={role.value}><div><p className="font-black text-slate-800">{role.label}</p><p className="mt-0.5 text-xs font-semibold text-slate-500">Temporary or guest spots</p></div><div className="flex items-center gap-2"><button aria-label={`Decrease ${role.label} spots`} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-lg font-black text-slate-600 hover:border-green-300 hover:text-sportGreen" onClick={() => setRoleCount(role.value, current - 1)} type="button">−</button><span className="w-7 text-center font-black text-sportNavy">{current}</span><button aria-label={`Increase ${role.label} spots`} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-lg font-black text-slate-600 hover:border-green-300 hover:text-sportGreen" onClick={() => setRoleCount(role.value, current + 1)} type="button">+</button></div></div>;
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <footer className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:px-7">
            <p className="text-xs font-semibold leading-5 text-slate-500">Changes may notify players when the schedule or roles are affected.</p>
            <div className="mt-3 flex flex-col-reverse gap-2 sm:mt-0 sm:flex-row">
              <button className="sport-secondary-button w-full sm:w-auto" disabled={isSaving} onClick={onClose} type="button">Cancel</button>
              <button aria-busy={isSaving} className="sport-primary-button w-full sm:w-auto" disabled={isSaving} type="submit">{isSaving ? <LoadingIndicator label="Saving changes" size="sm" tone="inverse" /> : "Save changes"}</button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

function PanelHeading({ eyebrow, heading, id, text }: { eyebrow: string; heading: string; id?: string; text: string }) {
  return <div><p className="sport-eyebrow">{eyebrow}</p><h3 className="mt-1 text-xl font-black text-sportNavy" id={id}>{heading}</h3><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">{text}</p></div>;
}

function CloseIcon() {
  return <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
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
