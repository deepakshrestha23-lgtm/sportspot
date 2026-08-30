"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import FeedbackToast from "@/components/FeedbackToast";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { Court } from "@/types/venue";

export default function EditOwnerCourtPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const courtId = params.id;
  const [court, setCourt] = useState<Court | null>(null);
  const [form, setForm] = useState({ name: "", description: "", court_type: "INDOOR", surface_type: "TURF", is_active: true });
  const [photo, setPhoto] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    api.get<{ court: Court }>(`/api/venues/owner/courts/${courtId}/`)
      .then((response) => {
        if (!mounted) return;
        const current = response.data.court;
        setCourt(current);
        setForm({ name: current.name || "", description: current.description || "", court_type: current.court_type, surface_type: current.surface_type, is_active: current.is_active });
      })
      .catch((requestError) => { if (mounted) setError(getApiErrorMessage(requestError, "Could not load this court.")); })
      .finally(() => { if (mounted) setIsLoading(false); });
    return () => { mounted = false; };
  }, [courtId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    try {
      const payload = new FormData();
      Object.entries(form).forEach(([key, value]) => payload.append(key, String(value)));
      if (photo) payload.append("court_photo", photo);
      if (removePhoto && !photo) payload.append("clear_court_photo", "true");
      const response = await api.patch<{ court: Court }>(`/api/venues/owner/courts/${courtId}/`, payload);
      setCourt(response.data.court);
      router.push("/dashboard/owner/courts");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not save court changes."));
    } finally {
      setIsSaving(false);
    }
  }

  function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    setPhoto(event.target.files?.[0] || null);
    setRemovePhoto(false);
    event.target.value = "";
  }

  if (isLoading) return <div className="owner-panel owner-courts-loading">Loading court...</div>;
  if (!court) {
    return (
      <section className="sport-empty-state">
        <h1 className="text-xl font-black text-sportNavy">Court unavailable</h1>
        <p className="mt-2 text-sm text-slate-600">This court could not be loaded or no longer belongs to your venue.</p>
        <Link className="owner-primary-button mt-5" href="/dashboard/owner/courts">Back to courts</Link>
      </section>
    );
  }

  return (
    <div className="owner-court-edit-page space-y-6">
      <FeedbackToast message={error} onClose={() => setError("")} type="error" />
      <OwnerPageHeader backHref="/dashboard/owner/courts" backLabel="Back to courts" description="Update the information players use to understand and choose this physical court." eyebrow="Venue Manager" title={`Edit ${court.name}`} />
      <section className="owner-court-edit-layout">
        <form className="owner-venue-section" onSubmit={submit}>
          <div className="owner-venue-section-header">
            <div><p className="owner-section-kicker">Court profile</p><h2>Details</h2><p>Changes save to this court only. Existing bookings and slots remain attached.</p></div>
          </div>
          <div className="owner-court-edit-fields">
            <Field label="Court name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
            <Select label="Court type" value={form.court_type} onChange={(value) => setForm({ ...form, court_type: value })} options={["INDOOR", "OUTDOOR", "COVERED"]} />
            <Select label="Surface type" value={form.surface_type} onChange={(value) => setForm({ ...form, surface_type: value })} options={["TURF", "MAT", "CEMENT", "ARTIFICIAL_TURF"]} />
            <label className="owner-court-active-toggle"><span><strong>Player visibility</strong><small>Active courts can receive new bookings after venue approval.</small></span><input checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} type="checkbox" /></label>
            <label className="owner-court-edit-field owner-court-edit-field-wide"><span>Description</span><textarea className="sport-input min-h-32" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          </div>
          <div className="owner-court-edit-actions"><Link className="owner-secondary-button" href="/dashboard/owner/courts">Cancel</Link><button className="owner-primary-button" disabled={isSaving} type="submit">{isSaving ? "Saving..." : "Save court changes"}</button></div>
        </form>

        <section className="owner-venue-section">
          <div className="owner-venue-section-header"><div><p className="owner-section-kicker">Presentation</p><h2>Court photo</h2><p>Use a clear image of the actual play area. JPG, JPEG or PNG, up to 3 MB.</p></div></div>
          <div className="owner-court-edit-photo">
            {court.court_photo && !removePhoto ? <img alt={`${court.name} court`} src={getMediaUrl(court.court_photo)} /> : <div className="owner-court-edit-photo-empty"><span>{removePhoto ? "Photo will be removed" : "No court photo"}</span></div>}
            <div className="owner-court-edit-photo-actions">
              <label className="owner-secondary-button">{court.court_photo && !removePhoto ? "Replace photo" : "Add photo"}<input accept=".jpg,.jpeg,.png" className="sr-only" onChange={selectPhoto} type="file" /></label>
              {court.court_photo && !removePhoto ? <button className="owner-court-danger" onClick={() => { setRemovePhoto(true); setPhoto(null); }} type="button">Remove photo</button> : removePhoto ? <button className="owner-court-preview" onClick={() => setRemovePhoto(false)} type="button">Keep current photo</button> : null}
            </div>
            {photo ? <p className="owner-court-photo-selection">New photo selected: {photo.name}</p> : null}
          </div>
        </section>
      </section>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="owner-court-edit-field"><span>{label}</span><input className="sport-input" required value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="owner-court-edit-field"><span>{label}</span><select className="sport-input" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{formatChoice(option)}</option>)}</select></label>;
}

function formatChoice(value: string) {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function getMediaUrl(path: string) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
  return `${baseUrl}${path}`;
}
