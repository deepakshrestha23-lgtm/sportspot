import Link from "next/link";

import RoleGate from "@/components/RoleGate";

const ownerSidebarItems = [
  { label: "Overview", href: "/dashboard/owner" },
  { label: "Manage Venue", href: "/dashboard/owner/venue" },
  { label: "Court Management", href: "/dashboard/owner/courts" },
  { label: "Slot Calendar", href: "/dashboard/owner/calendar" },
  { label: "Bookings", href: "/dashboard/owner/bookings" },
  { label: "Refunds", href: "/dashboard/owner/refunds" },
  { label: "Venue Setup", href: "/dashboard/owner/venue-setup" },
];

export default function OwnerDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGate allowedRoles={["COURT_OWNER"]}>
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[260px_1fr] lg:px-8">
        <aside className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm lg:sticky lg:top-24 lg:self-start">
          <div className="px-3 py-3">
            <p className="text-xs font-black uppercase tracking-wide text-sportGreen">Owner Dashboard</p>
            <h2 className="mt-1 text-lg font-black text-sportNavy">Venue Operations</h2>
          </div>
          <nav className="mt-2 grid gap-1">
            {ownerSidebarItems.map((item) => (
              <Link
                className="rounded-md px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-green-50 hover:text-sportGreen"
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <section className="min-w-0">{children}</section>
      </div>
    </RoleGate>
  );
}
