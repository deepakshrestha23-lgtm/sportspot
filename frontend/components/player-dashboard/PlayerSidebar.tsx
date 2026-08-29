"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  isPlayerDashboardItemActive,
  playerDashboardNavItems,
  playerDashboardUtilityItem,
  type PlayerDashboardNavItem,
} from "@/components/player-dashboard/navigation";

export function PlayerSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-[248px] shrink-0 border-r border-slate-200/80 bg-white lg:block">
      <div className="sticky top-[64px] flex h-[calc(100vh-64px)] flex-col px-3 py-5">
        <div className="border-b border-slate-100 px-3 pb-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-sportGreen">SportSpot</p>
          <p className="mt-1 text-sm font-semibold text-slate-600">Player Dashboard</p>
        </div>

        <nav aria-label="Player dashboard" className="mt-5 space-y-1.5">
          {playerDashboardNavItems.map((item) => (
            <PlayerSidebarItem isActive={isPlayerDashboardItemActive(pathname, item)} item={item} key={item.href} />
          ))}
        </nav>

        <div className="flex-1" />

        <nav aria-label="Player dashboard support" className="border-t border-slate-100 pt-4">
          <PlayerSidebarItem
            isActive={isPlayerDashboardItemActive(pathname, playerDashboardUtilityItem)}
            item={playerDashboardUtilityItem}
          />
        </nav>
      </div>
    </aside>
  );
}

export function PlayerSidebarItem({
  isActive,
  item,
  onNavigate,
}: {
  isActive: boolean;
  item: PlayerDashboardNavItem;
  onNavigate?: () => void;
}) {
  return (
    <Link
      aria-current={isActive ? "page" : undefined}
      className={`group relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sportGreen focus-visible:ring-offset-2 ${
        isActive
          ? "bg-green-50 text-green-800"
          : "text-slate-600 hover:bg-slate-50 hover:text-sportNavy"
      }`}
      href={item.href}
      onClick={onNavigate}
    >
      {isActive ? <span aria-hidden="true" className="absolute left-0 top-2.5 h-6 w-1 rounded-r-full bg-sportGreen" /> : null}
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center ${isActive ? "text-sportGreen" : "text-slate-400 group-hover:text-sportGreen"}`}>
        <DashboardIcon name={item.icon} />
      </span>
      <span className="min-w-0 truncate">{item.label}</span>
    </Link>
  );
}

export function DashboardIcon({ name }: { name: PlayerDashboardNavItem["icon"] }) {
  const common = {
    "aria-hidden": true,
    className: "h-5 w-5",
    fill: "none",
    viewBox: "0 0 24 24",
  } as const;

  if (name === "overview") {
    return <svg {...common}><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
  }
  if (name === "profile") {
    return <svg {...common}><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 8a7 7 0 0 0-14 0" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
  }
  if (name === "teams") {
    return <svg {...common}><path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 2a5 5 0 0 1 5 5M3 20a5 5 0 0 1 10 0" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
  }
  if (name === "games") {
    return <svg {...common}><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Zm10 2h3a3 3 0 0 1-3 3M7 6H4a3 3 0 0 0 3 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
  }
  if (name === "bookings") {
    return <svg {...common}><path d="M7 3v3m10-3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm3 8h3m-3 4h6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
  }
  if (name === "ratings") {
    return <svg {...common}><path d="m12 3 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7L6.8 19l1-5.8L3.6 9.1l5.8-.8L12 3Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
  }
  if (name === "settings") {
    return <svg {...common}><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-12v2m0 13v2m8.5-8.5h-2m-13 0h-2m14.5-6.5-1.4 1.4M6.9 17.1l-1.4 1.4m0-13 1.4 1.4m10.2 10.2 1.4 1.4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
  }
  return <svg {...common}><path d="M9.1 9a3 3 0 1 1 4.9 2.3c-1.2.8-2 1.5-2 2.7M12 18h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
}
