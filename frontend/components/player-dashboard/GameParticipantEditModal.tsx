"use client";

import { useEffect, useState } from "react";

import LoadingIndicator from "@/components/LoadingIndicator";
import type { GameParticipant, GameRole } from "@/types/matchmaking";

const roles: Array<{ label: string; value: GameRole }> = [
  { label: "Any role", value: "ANY" },
  { label: "Batsman", value: "BATSMAN" },
  { label: "Bowler", value: "BOWLER" },
  { label: "All-rounder", value: "ALL_ROUNDER" },
  { label: "Wicketkeeper", value: "WICKETKEEPER" },
];

export default function GameParticipantEditModal({ participant, isSaving, onClose, onSave }: { participant: GameParticipant; isSaving: boolean; onClose: () => void; onSave: (payload: { role: GameRole; guest_name?: string }) => void }) {
  const [role, setRole] = useState<GameRole>(participant.role);
  const [guestName, setGuestName] = useState(participant.guest_name || participant.full_name || "");

  useEffect(() => {
    setRole(participant.role);
    setGuestName(participant.guest_name || participant.full_name || "");
  }, [participant]);

  const isGuest = participant.participant_type === "GUEST";
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" role="presentation">
      <section aria-labelledby="edit-participant-title" aria-modal="true" className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6" role="dialog">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-sportGreen">Roster</p><h2 className="mt-1 text-xl font-black text-sportNavy" id="edit-participant-title">Edit participant</h2><p className="mt-1 text-sm font-semibold text-slate-500">{participant.full_name}</p></div><button aria-label="Close participant dialog" className="rounded-full p-2 text-xl text-slate-500 hover:bg-slate-100" onClick={onClose} type="button">×</button></div>
        {isGuest ? <label className="mt-5 block text-sm font-black text-slate-700">Guest name<input className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-sportGreen focus:ring-2 focus:ring-green-100" minLength={2} required value={guestName} onChange={(event) => setGuestName(event.target.value)} /></label> : null}
        <label className="mt-4 block text-sm font-black text-slate-700">Playing role<select className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-sportGreen focus:ring-2 focus:ring-green-100" value={role} onChange={(event) => setRole(event.target.value as GameRole)}>{roles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button className="min-h-11 rounded-xl border border-slate-200 px-5 text-sm font-black text-slate-600" disabled={isSaving} onClick={onClose} type="button">Cancel</button><button aria-busy={isSaving} className="min-h-11 rounded-xl bg-sportGreen px-5 text-sm font-black text-white disabled:opacity-60" disabled={isSaving} onClick={() => onSave({ role, ...(isGuest ? { guest_name: guestName.trim() } : {}) })} type="button">{isSaving ? <LoadingIndicator label="Saving participant" size="sm" tone="inverse" /> : "Save participant"}</button></div>
      </section>
    </div>
  );
}
