import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";

export default function OwnerSettingsPage() {
  return (
    <div className="space-y-6">
      <OwnerPageHeader
        description="Owner account settings will be separated from venue details. Venue information remains under Venue & Courts."
        eyebrow="Venue Manager"
        title="Settings"
      />
      <section className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h2 className="text-lg font-black text-sportNavy">Owner settings will be added next</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">For now, manage venue details, courts and booking operations from their dedicated sections.</p>
      </section>
    </div>
  );
}
