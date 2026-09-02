"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import FeedbackToast from "@/components/FeedbackToast";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getImageUploadError } from "@/lib/imageUpload";
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
  const [photo, setPhoto] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  function selectPhoto(file: File | null) {
    if (!file) { setPhoto(null); return; }
    const imageError = getImageUploadError(file, "Court photo");
    if (imageError) { setPhoto(null); setError(imageError); return; }
    setPhoto(file);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    try {
      const payload = new FormData();
      Object.entries(form).forEach(([key, value]) => payload.append(key, String(value)));
      if (photo) payload.append("court_photo", photo);
      const response = await api.post<{ court: Court }>("/api/venues/owner/courts/", payload);
      router.push(`/dashboard/owner/courts/${response.data.court.id}/slots`);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not create court."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <OwnerPageHeader backHref="/dashboard/owner/courts" backLabel="Back to courts" description="Add a physical Cricksal court to your venue, then configure its bookable slots." eyebrow="Venue Manager" title="Add Court" />
      <section className="owner-court-create-card max-w-3xl">
        <div className="owner-court-create-intro"><p className="owner-section-kicker">Court profile</p><h2>Add a physical play area</h2><p>Give players enough detail to choose the right court. Slots and pricing are configured next.</p></div>
        <FeedbackToast message={error} onClose={() => setError("")} type="error" />

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <Input label="Court Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
          <Textarea label="Description" value={form.description} onChange={(value) => setForm({ ...form, description: value })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Court Type" value={form.court_type} onChange={(value) => setForm({ ...form, court_type: value })} options={["INDOOR", "OUTDOOR", "COVERED"]} />
            <Select label="Surface Type" value={form.surface_type} onChange={(value) => setForm({ ...form, surface_type: value })} options={["TURF", "MAT", "CEMENT", "ARTIFICIAL_TURF"]} />
          </div>
          <label className="owner-court-create-upload"><span><strong>Court photo</strong><small>Optional. JPG, JPEG or PNG, up to 5 MB.</small></span><input accept=".jpg,.jpeg,.png" onChange={(event) => selectPhoto(event.target.files?.[0] || null)} type="file" />{photo ? <em>{photo.name}</em> : null}</label>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} type="checkbox" />
            Court is active
          </label>
          <div className="flex flex-wrap gap-3 pt-2">
            <button className="sport-primary-button" disabled={isSaving} type="submit">
              {isSaving ? "Saving..." : "Create Court"}
            </button>
            <Link className="sport-secondary-button" href="/dashboard/owner/courts">
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </div>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="sport-field">
      <span className="text-sm font-black text-sportNavy">{label}</span>
      <input className="sport-input" onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="sport-field">
      <span className="text-sm font-black text-sportNavy">{label}</span>
      <textarea className="sport-input min-h-28" onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <label className="sport-field">
      <span className="text-sm font-black text-sportNavy">{label}</span>
      <select className="sport-input" onChange={(event) => onChange(event.target.value)} value={value}>
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
