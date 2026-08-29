"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import Logo from "@/components/Logo";
import NotificationCenter from "@/components/NotificationCenter";
import { api } from "@/lib/api";
import { clearAuthSession, getCurrentUser } from "@/lib/auth";
import type { User } from "@/types/auth";
import type { Venue } from "@/types/venue";

type VenueState = {
  label: string;
  tone: "neutral" | "warning" | "success" | "danger";
};

type ContextAction = {
  label: string;
  href: string;
  variant: "primary" | "secondary";
} | null;

export default function VenueOwnerTopBar() {
  const router = useRouter();
  const bellRef = useRef<HTMLButtonElement>(null);
  const [user, setUser] = useState<User | null>(null);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [isVenueLoading, setIsVenueLoading] = useState(true);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [unseenNotificationsCount, setUnseenNotificationsCount] = useState(0);
  const [notificationToast, setNotificationToast] = useState("");
  const [hasNewNotification, setHasNewNotification] = useState(false);

  useEffect(() => {
    const currentUser = getCurrentUser();
    setUser(currentUser);
    setIsProfileOpen(false);
    setIsWorkspaceOpen(false);

    if (currentUser?.role !== "COURT_OWNER") {
      setVenue(null);
      setIsVenueLoading(false);
      return;
    }

    let mounted = true;
    setIsVenueLoading(true);
    api
      .get<{ venue: Venue | null }>("/api/venues/owner/venue/")
      .then((response) => {
        if (mounted) setVenue(response.data.venue);
      })
      .catch(() => {
        if (mounted) setVenue(null);
      })
      .finally(() => {
        if (mounted) setIsVenueLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleNewNotification = useCallback((title: string) => {
    setNotificationToast(title);
    setHasNewNotification(true);
    window.setTimeout(() => setNotificationToast(""), 3500);
    window.setTimeout(() => setHasNewNotification(false), 1800);
  }, []);

  function handleLogout() {
    clearAuthSession();
    setUser(null);
    setIsProfileOpen(false);
    setIsNotificationsOpen(false);
    setUnseenNotificationsCount(0);
    router.push("/");
  }

  if (!user || user.role !== "COURT_OWNER") return null;

  const venueState = getVenueState(venue);
  const contextAction = getContextAction(venue);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white">
        <nav aria-label="Venue manager navigation" className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              aria-label="Open venue menu"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-sportNavy transition-colors hover:border-green-200 hover:bg-green-50 hover:text-sportGreen focus:outline-none focus:ring-2 focus:ring-green-200 lg:hidden"
              onClick={() => window.dispatchEvent(new CustomEvent("sportspot-owner-menu-toggle"))}
              type="button"
            >
              <MenuIcon />
            </button>
            <Logo href="/dashboard/owner" markClassName="h-8 max-w-[140px]" textClassName="text-[1.15rem]" />
            <span className="hidden rounded-full border border-green-100 bg-green-50 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-sportGreen sm:inline-flex">
              Venue Manager
            </span>
          </div>

          <button
            aria-expanded={isWorkspaceOpen}
            className="hidden min-w-0 max-w-md flex-1 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-left transition-colors hover:border-green-200 hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-green-200 md:flex lg:max-w-lg"
            onClick={() => setIsWorkspaceOpen((current) => !current)}
            type="button"
          >
            <VenueIdentity isLoading={isVenueLoading} venue={venue} state={venueState} />
            <ChevronDownIcon />
          </button>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {contextAction ? <VenueContextAction action={contextAction} /> : null}
            <button
              aria-label="Venue workspace"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-sportNavy transition hover:border-green-200 hover:bg-green-50 hover:text-sportGreen focus:outline-none focus:ring-2 focus:ring-green-200 md:hidden"
              onClick={() => setIsWorkspaceOpen((current) => !current)}
              type="button"
            >
              <BuildingIcon />
            </button>
            <button
              aria-controls="sportspot-notification-centre"
              aria-expanded={isNotificationsOpen}
              aria-label={`Open Notification Centre${unseenNotificationsCount ? `, ${unseenNotificationsCount} unseen` : ""}`}
              className={`relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition-colors hover:border-green-200 hover:bg-green-50 hover:text-sportGreen focus:outline-none focus:ring-2 focus:ring-green-200 ${hasNewNotification ? "border-green-300 text-sportGreen" : ""}`}
              onClick={() => {
                setIsNotificationsOpen(true);
                setHasNewNotification(false);
              }}
              ref={bellRef}
              type="button"
            >
              <BellIcon />
              {hasNewNotification ? <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full border border-green-400 opacity-50" /> : null}
              {unseenNotificationsCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-sportGreen px-1.5 text-[10px] font-black text-white ring-2 ring-white">
                  {unseenNotificationsCount > 99 ? "99+" : unseenNotificationsCount}
                </span>
              ) : null}
            </button>

            <div className="relative">
              <button
                aria-expanded={isProfileOpen}
                aria-haspopup="menu"
                className="flex min-h-10 max-w-[140px] items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:border-green-200 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-green-200 sm:max-w-none sm:px-3"
                onClick={() => setIsProfileOpen((value) => !value)}
                type="button"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sportGreen text-xs font-black text-white">
                  {user.full_name.charAt(0).toUpperCase()}
                </span>
                <span className="hidden max-w-36 truncate sm:inline">{user.full_name}</span>
                <ChevronDownIcon />
              </button>
              {isProfileOpen ? <OwnerProfileMenu onLogout={handleLogout} /> : null}
            </div>
          </div>
        </nav>
      </header>

      {isWorkspaceOpen ? (
        <div className="fixed inset-x-3 top-20 z-40 rounded-xl border border-slate-200 bg-white p-4 shadow-2xl md:left-1/2 md:right-auto md:w-[420px] md:-translate-x-1/2" role="dialog" aria-label="Venue workspace">
          <VenueIdentity isLoading={isVenueLoading} venue={venue} state={venueState} expanded />
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Link className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-black text-sportNavy transition hover:border-green-200 hover:text-sportGreen" href="/dashboard/owner/venue" onClick={() => setIsWorkspaceOpen(false)}>
              Manage Venue
            </Link>
            {contextAction ? (
              <Link className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-sportGreen px-4 text-sm font-black text-white transition hover:bg-green-700" href={contextAction.href} onClick={() => setIsWorkspaceOpen(false)}>
                {contextAction.label}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <NotificationCenter
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        onNewNotification={handleNewNotification}
        onUnseenCountChange={setUnseenNotificationsCount}
        triggerRef={bellRef}
        userId={user.id}
      />

      {notificationToast ? (
        <div aria-live="polite" className="fixed right-4 top-20 z-40 max-w-sm rounded-xl border border-green-200 bg-white px-4 py-3 shadow-xl">
          <p className="text-xs font-black uppercase text-sportGreen">New notification</p>
          <p className="mt-1 text-sm font-bold text-sportNavy">{notificationToast}</p>
        </div>
      ) : null}
    </>
  );
}

function VenueIdentity({ expanded = false, isLoading, state, venue }: { expanded?: boolean; isLoading: boolean; state: VenueState; venue: Venue | null }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Current venue</p>
      <div className={`mt-1 flex min-w-0 ${expanded ? "flex-col items-start gap-2" : "items-center gap-3"}`}>
        <p className="min-w-0 truncate text-sm font-black text-sportNavy sm:text-base">
          {isLoading ? "Loading venue..." : venue?.name || "No venue set up yet"}
        </p>
        {!isLoading ? <VenueStatusBadge state={state} /> : null}
      </div>
    </div>
  );
}

function VenueStatusBadge({ state }: { state: VenueState }) {
  const toneClass = {
    neutral: "border-slate-200 bg-slate-100 text-slate-700",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    success: "border-green-200 bg-green-50 text-sportGreen",
    danger: "border-red-200 bg-red-50 text-red-700",
  }[state.tone];

  return <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-black ${toneClass}`}>{state.label}</span>;
}

function VenueContextAction({ action }: { action: NonNullable<ContextAction> }) {
  const className =
    action.variant === "primary"
      ? "hidden min-h-10 items-center justify-center rounded-xl bg-sportGreen px-4 text-sm font-black text-white transition hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-200 sm:inline-flex"
      : "hidden min-h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-sportNavy transition hover:border-sportGreen hover:text-sportGreen focus:outline-none focus:ring-2 focus:ring-green-200 sm:inline-flex";

  return (
      <Link className={className} href={action.href}>
      {action.label}
    </Link>
  );
}

function OwnerProfileMenu({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="absolute right-0 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-xl" role="menu">
      <MenuLink href="/dashboard/owner" label="Owner Profile" />
      <MenuLink href="/dashboard/owner" label="Account Settings" />
      <MenuLink href="/support" label="Help & Support" />
      <button className="mt-1 w-full rounded-md px-3 py-2.5 text-left text-sm font-black text-red-600 transition hover:bg-red-50" onClick={onLogout} role="menuitem" type="button">
        Log Out
      </button>
    </div>
  );
}

function MenuLink({ href, label }: { href: string; label: string }) {
  return (
    <Link className="block rounded-md px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-sportGreen" href={href} role="menuitem">
      {label}
    </Link>
  );
}

function getVenueState(venue: Venue | null): VenueState {
  if (!venue) return { label: "Setup Incomplete", tone: "neutral" };
  if (venue.status === "SUSPENDED") return { label: "Suspended", tone: "danger" };
  if (venue.status === "APPROVED" && !venue.is_active) return { label: "Temporarily Inactive", tone: "warning" };
  if (venue.status === "APPROVED") return { label: "Active", tone: "success" };
  if (venue.status === "PENDING") return { label: "Pending Verification", tone: "warning" };
  if (venue.status === "NEEDS_CHANGES" || venue.status === "REJECTED") return { label: "Changes Required", tone: "danger" };
  return { label: "Setup Incomplete", tone: "neutral" };
}

function getContextAction(venue: Venue | null): ContextAction {
  if (!venue) return null;

  if (venue.status === "APPROVED" && venue.is_active) {
    return { label: "View Public Venue", href: `/courts/${venue.id}`, variant: "primary" };
  }

  if (venue.status === "PENDING") {
    return { label: "Preview Venue", href: "/dashboard/owner/venue", variant: "secondary" };
  }

  if (venue.status === "NEEDS_CHANGES" || venue.status === "REJECTED") {
    return { label: "Review Feedback", href: "/dashboard/owner/venue-setup", variant: "secondary" };
  }

  if (venue.status === "SUSPENDED") {
    return { label: "Get Support", href: "/support", variant: "secondary" };
  }

  return null;
}

function BellIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M15 17H9m9-2v-4a6 6 0 1 0-12 0v4l-2 2h16l-2-2Zm-4 4a2 2 0 0 1-4 0" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M4 21V7l8-4 8 4v14M9 21v-6h6v6M8 9h.01M12 9h.01M16 9h.01" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}
