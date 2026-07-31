"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { Court } from "@/types/venue";

export default function CreateOwnerCourtPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    description: "",
    court_type: "INDOOR",
    surface_type: "TURF",
    is_active: true,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    try {
      const response = await api.post<{ court: Court }>("/api/venues/owner/courts/", form);
      router.push(`/dashboard/owner/courts/${response.data.court.id}/slots`);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not create court."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-black uppercase tracking-wide text-sportGreen">Court Management</p>
        <h1 className="mt-2 text-3xl font-black text-sportNavy">Add Cricksal Court</h1>
        <p className="mt-2 text-sm text-slate-600">Every court in SportSpot is Cricksal-only for now.</p>
        <FeedbackToast message={error} onClose={() => setError("")} type="error" />

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <Input label="Court Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
          <Textarea label="Description" value={form.description} onChange={(value) => setForm({ ...form, description: value })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Court Type" value={form.court_type} onChange={(value) => setForm({ ...form, court_type: value })} options={["INDOOR", "OUTDOOR", "COVERED"]} />
            <Select label="Surface Type" value={form.surface_type} onChange={(value) => setForm({ ...form, surface_type: value })} options={["TURF", "MAT", "CEMENT", "ARTIFICIAL_TURF"]} />
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} type="checkbox" />
            Court is active
          </label>
          <div className="flex flex-wrap gap-3 pt-2">
            <button className="rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" disabled={isSaving} type="submit">
              {isSaving ? "Saving..." : "Create Court"}
            </button>
            <Link className="rounded-md border border-slate-200 px-5 py-3 text-sm font-black text-sportNavy hover:bg-slate-50" href="/dashboard/owner/courts">
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-sportNavy">{label}</span>
      <input className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-sm outline-none focus:border-sportGreen" onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-sportNavy">{label}</span>
      <textarea className="mt-2 min-h-28 w-full rounded-md border border-slate-300 px-3 py-3 text-sm outline-none focus:border-sportGreen" onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-sportNavy">{label}</span>
      <select className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-sm outline-none focus:border-sportGreen" onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option} value={option}>
            {formatChoice(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatChoice(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
