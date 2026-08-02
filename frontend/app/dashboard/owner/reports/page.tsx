import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";

export default function OwnerReportsPage() {
  return (
    <div className="space-y-6">
      <OwnerPageHeader
        description="Reports will summarise booking activity, revenue and operational patterns after the owner workflow has more production data."
        eyebrow="Venue Manager"
        title="Reports"
      />
      <section className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h2 className="text-lg font-black text-sportNavy">Reports are not available yet</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">Your booking and payment records remain available from Bookings and Payments & Refunds.</p>
      </section>
    </div>
  );
}
