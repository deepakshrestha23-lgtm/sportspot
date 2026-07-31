import Link from "next/link";

import RoleGate from "@/components/RoleGate";

const playerSidebarItems = [
  { label: "Overview", href: "/dashboard/player" },
  { label: "My Profile", href: "/dashboard/player/profile" },
  { label: "My Teams", href: "/dashboard/player/teams" },
  { label: "My Matches / Game Rooms", href: "/dashboard/player/matches" },
  { label: "My Bookings", href: "/dashboard/player/bookings" },
  { label: "My Requests", href: "/dashboard/player/requests" },
  { label: "My Invitations", href: "/dashboard/player/invitations" },
  { label: "My Ratings", href: "/dashboard/player/ratings" },
  { label: "Settings", href: "/dashboard/player/settings" },
];

export default function PlayerDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGate allowedRoles={["PLAYER"]}>
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[260px_1fr] lg:px-8">
        <aside className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm lg:sticky lg:top-24 lg:self-start">
          <div className="px-3 py-3">
            <p className="text-xs font-black uppercase tracking-wide text-sportGreen">Player Dashboard</p>
            <h2 className="mt-1 text-lg font-black text-sportNavy">Manage SportSpot</h2>
          </div>
          <nav className="mt-2 grid gap-1">
            {playerSidebarItems.map((item) => (
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
