import Link from "next/link";

import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";

export default function OwnerAvailabilityPage() {
  return (
    <div className="space-y-6">
      <OwnerPageHeader
        actions={<Link className="rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" href="/dashboard/owner/calendar">Open Calendar</Link>}
        description="Manage slot generation, pricing and blocked court time from your court calendars. A dedicated availability workspace will be expanded next."
        eyebrow="Venue Manager"
        title="Availability & Pricing"
      />
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-black text-sportNavy">Use court slot pages for now</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Court-specific slot generation and pricing are already available from Venue & Courts. This page is reserved for a unified availability workflow.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link className="rounded-md border border-slate-200 px-4 py-2 text-sm font-black text-sportNavy hover:border-green-200 hover:text-sportGreen" href="/dashboard/owner/courts">Manage Courts</Link>
          <Link className="rounded-md border border-slate-200 px-4 py-2 text-sm font-black text-sportNavy hover:border-green-200 hover:text-sportGreen" href="/dashboard/owner/calendar">View Calendar</Link>
        </div>
      </section>
    </div>
  );
}
