import { DashboardPageHeader } from "@/components/player-dashboard/DashboardPageHeader";

export default function SupportPage() {
  return (
    <main className="min-h-[calc(100vh-73px)] bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <DashboardPageHeader
          eyebrow="Support"
          title="Help & Support"
          description="Find help for account access, bookings, teams, venue questions, and SportSpot safety concerns."
        />
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-sportNavy">Need help?</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Support contact options and help articles will be added here.
          </p>
        </section>
      </div>
    </main>
  );
}

