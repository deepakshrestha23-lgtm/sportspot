"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";

import {
  getLifecycleStatusLabel,
  getOwnerDashboardNavItems,
  getOwnerLifecycleState,
  isOwnerDashboardItemActive,
  ownerDashboardUtilityItem,
  type OwnerDashboardNavIcon,
  type OwnerDashboardNavItem,
  type OwnerLifecycleState,
} from "@/components/owner/navigation";
import type { Venue } from "@/types/venue";

export function VenueOwnerSidebar({ isLoading, venue }: { isLoading: boolean; venue: Venue | null }) {
  const pathname = usePathname();
  const lifecycleState = isLoading ? "SETUP_INCOMPLETE" : getOwnerLifecycleState(venue);
  const navItems = getOwnerDashboardNavItems(lifecycleState);

  return (
    <aside className="owner-sidebar hidden w-[248px] shrink-0 border-r border-slate-200/80 bg-white lg:block">
      <div className="sticky top-[64px] flex h-[calc(100vh-64px)] flex-col px-3 py-5">
        <VenueOwnerSidebarHeader />

        <nav aria-label="Venue Manager" className="mt-5 space-y-1.5">
          {isLoading ? <VenueOwnerSidebarSkeleton /> : navItems.map((item) => (
            <VenueOwnerSidebarItem isActive={isOwnerDashboardItemActive(pathname, item)} item={item} key={`${item.label}-${item.href}`} />
          ))}
        </nav>

        <div className="flex-1" />

        {lifecycleState === "CHANGES_REQUIRED" ? (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
            <p className="text-xs font-black uppercase tracking-wide text-amber-800">Action Required</p>
            <p className="mt-1 text-xs font-semibold leading-5 text-amber-900">Review admin feedback before resubmitting your venue.</p>
          </div>
        ) : null}

        <nav aria-label="Venue Manager support" className="border-t border-slate-100 pt-3">
          <VenueOwnerSidebarItem
            isActive={isOwnerDashboardItemActive(pathname, ownerDashboardUtilityItem)}
            item={ownerDashboardUtilityItem}
          />
        </nav>
      </div>
    </aside>
  );
}


function VenueOwnerSidebarSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[1, 2, 3, 4, 5, 6].map((item) => (
        <div className="flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5" key={item}>
          <div className="h-6 w-6 shrink-0 animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-32 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}
export function VenueOwnerSidebarHeader() {
  return (
    <div className="border-b border-slate-100 px-2 pb-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-sportGreen">SportSpot</p>
      <p className="mt-1 text-sm font-semibold text-sportNavy">Venue Manager</p>
    </div>
  );
}

export function VenueOwnerSidebarItem({
  isActive,
  item,
  onNavigate,
}: {
  isActive: boolean;
  item: OwnerDashboardNavItem;
  onNavigate?: () => void;
}) {
  return (
    <Link
      aria-current={isActive ? "page" : undefined}
      className={`group relative flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sportGreen focus-visible:ring-offset-2 ${
        isActive ? "bg-green-50 text-green-800" : "text-slate-600 hover:bg-slate-50 hover:text-sportNavy"
      }`}
      href={item.href}
      onClick={onNavigate}
    >
      {isActive ? <span aria-hidden="true" className="absolute left-0 top-2.5 h-6 w-1 rounded-r-full bg-sportGreen" /> : null}
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center ${isActive ? "text-sportGreen" : "text-slate-400 group-hover:text-sportGreen"}`}>
        <OwnerDashboardIcon name={item.icon} />
      </span>
      <span className="min-w-0 truncate">{item.label}</span>
    </Link>
  );
}

export function VenueLifecycleBadge({ state }: { state: OwnerLifecycleState }) {
  const toneClass = {
    NO_VENUE: "border-slate-200 bg-slate-100 text-slate-700",
    SETUP_INCOMPLETE: "border-slate-200 bg-slate-100 text-slate-700",
    PENDING_VERIFICATION: "border-amber-200 bg-amber-50 text-amber-800",
    CHANGES_REQUIRED: "border-red-200 bg-red-50 text-red-700",
    ACTIVE: "border-green-200 bg-green-50 text-sportGreen",
    TEMPORARILY_INACTIVE: "border-amber-200 bg-amber-50 text-amber-800",
    SUSPENDED: "border-red-200 bg-red-50 text-red-700",
  }[state];

  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${toneClass}`}>{getLifecycleStatusLabel(state)}</span>;
}

export function OwnerDashboardIcon({ name }: { name: OwnerDashboardNavIcon }) {
  const common = {
    "aria-hidden": true,
    className: "h-5 w-5",
    fill: "none",
    viewBox: "0 0 24 24",
  } as const;

  const paths: Record<OwnerDashboardNavIcon, ReactElement> = {
    overview: <path d="M4 13h7V4H4v9Zm9 7h7V4h-7v16ZM4 20h7v-5H4v5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />,
    calendar: <path d="M7 3v3m10-3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm3 8h3m-3 4h6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />,
    bookings: <path d="M6 4h12v16H6V4Zm3 4h6M9 12h6M9 16h4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />,
    venue: <path d="M4 21V7l8-4 8 4v14M9 21v-6h6v6M8 9h.01M12 9h.01M16 9h.01" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />,
    availability: <path d="M4 6h16M4 12h10M4 18h7m7-5v6m3-3h-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />,
    payments: <path d="M4 7h16v10H4V7Zm0 3h16m-4 4h1M7 14h4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />,
    reports: <path d="M5 20V4h14v16H5Zm4-4v-4m3 4V8m3 8v-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />,
    settings: <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-12v2m0 13v2m8.5-8.5h-2m-13 0h-2m14.5-6.5-1.4 1.4M6.9 17.1l-1.4 1.4m0-13 1.4 1.4m10.2 10.2 1.4 1.4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />,
    support: <path d="M9.1 9a3 3 0 1 1 4.9 2.3c-1.2.8-2 1.5-2 2.7M12 18h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />,
    setup: <path d="M5 12.5 10 17 19 7M4 4h16v16H4V4Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />,
    courts: <path d="M4 5h16v14H4V5Zm8 0v14M4 12h16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />,
    verification: <path d="M12 3 5 6v5c0 4.2 2.8 7.7 7 9 4.2-1.3 7-4.8 7-9V6l-7-3Zm-3 9 2 2 4-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />,
  };

  return <svg {...common}>{paths[name]}</svg>;
}
