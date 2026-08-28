"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import Logo from "@/components/Logo";
import NotificationCenter from "@/components/NotificationCenter";
import { api } from "@/lib/api";
import { clearAuthSession, getCurrentUser } from "@/lib/auth";
import type { User } from "@/types/auth";
import type { Venue, VenueStatus } from "@/types/venue";

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [unseenNotificationsCount, setUnseenNotificationsCount] = useState(0);
  const [notificationToast, setNotificationToast] = useState("");
  const [hasNewNotification, setHasNewNotification] = useState(false);
  const [ownerVenueStatus, setOwnerVenueStatus] = useState<VenueStatus | "NONE">("NONE");
  const bellRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const currentUser = getCurrentUser();
    setUser(currentUser);
    if (currentUser?.role === "COURT_OWNER") {
      api
        .get<{ venue: Venue | null }>("/api/venues/owner/venue/")
        .then((response) => setOwnerVenueStatus(response.data.venue?.status || "NONE"))
        .catch(() => setOwnerVenueStatus("NONE"));
    } else {
      setOwnerVenueStatus("NONE");
    }
  }, []);

  useEffect(() => {
    setIsProfileOpen(false);
    setIsNotificationsOpen(false);
  }, [pathname]);

  function handleLogout() {
    clearAuthSession();
    setUser(null);
    setIsProfileOpen(false);
    setIsNotificationsOpen(false);
    setUnseenNotificationsCount(0);
    router.push("/");
  }

  const handleNewNotification = useCallback((title: string) => {
    setNotificationToast(title);
    setHasNewNotification(true);
    window.setTimeout(() => setNotificationToast(""), 3500);
    window.setTimeout(() => setHasNewNotification(false), 1800);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <nav className="mx-auto flex min-h-[68px] max-w-7xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6 lg:px-8">
          <Logo markClassName="h-8 max-w-[140px]" textClassName="text-[1.15rem]" />

          <div className="hidden items-center gap-7 text-[13px] font-semibold text-slate-600 lg:flex">
            {getNavLinks(user, ownerVenueStatus).map((link) => (
              <Link className="hover:text-sportGreen" href={link.href} key={link.href}>
                {link.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {!user ? (
              <>
                <Link className="text-sm font-semibold text-slate-700 hover:text-sportGreen" href="/login">
                  Login
                </Link>
                <Link
                  className="rounded-md bg-sportGreen px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700"
                  href="/register"
                >
                  Sign Up
                </Link>
              </>
            ) : (
              <>
                <button
                  aria-controls="sportspot-notification-centre"
                  aria-expanded={isNotificationsOpen}
                  aria-label={`Open Notification Centre${unseenNotificationsCount ? `, ${unseenNotificationsCount} unseen` : ""}`}
                  className={`relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition hover:border-green-200 hover:bg-green-50 hover:text-sportGreen ${hasNewNotification ? "scale-110 border-green-300 text-sportGreen" : ""}`}
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
                    className="flex max-w-[150px] items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:max-w-none"
                    onClick={() => setIsProfileOpen((value) => !value)}
                    type="button"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sportGreen text-xs font-black text-white">
                      {user.full_name.charAt(0).toUpperCase()}
                    </span>
                    <span className="hidden sm:inline">{user.full_name}</span>
                    <ChevronDownIcon />
                  </button>
                  {isProfileOpen ? (
                    <div className="absolute right-0 mt-3 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                      {getProfileLinks(user).map((link) => (
                        <Link className="block rounded px-3 py-2 text-sm hover:bg-slate-100" href={link.href} key={link.label}>
                          {link.label}
                        </Link>
                      ))}
                      <button
                        className="w-full rounded px-3 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50"
                        onClick={handleLogout}
                        type="button"
                      >
                        Logout
                      </button>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </nav>
      </header>

      {user ? (
        <NotificationCenter
          isOpen={isNotificationsOpen}
          onClose={() => setIsNotificationsOpen(false)}
          onNewNotification={handleNewNotification}
          onUnseenCountChange={setUnseenNotificationsCount}
          triggerRef={bellRef}
          userId={user.id}
        />
      ) : null}
      {notificationToast ? (
        <div aria-live="polite" className="fixed right-4 top-20 z-40 max-w-sm rounded-md border border-green-200 bg-white px-4 py-3 shadow-xl">
          <p className="text-xs font-black uppercase text-sportGreen">New notification</p>
          <p className="mt-1 text-sm font-bold text-sportNavy">{notificationToast}</p>
        </div>
      ) : null}
    </>
  );
}

function getNavLinks(user: User | null, ownerVenueStatus: VenueStatus | "NONE") {
  if (!user) {
    return [
      { label: "Courts", href: "/courts" },
      { label: "Find Games", href: "/find-game" },
      { label: "Challenge Teams", href: "/challenge-teams" },
      { label: "Register Venue", href: "/register" },
    ];
  }

  if (user.role === "PLAYER") {
    return [
      { label: "Courts", href: "/courts" },
      { label: "Find Games", href: "/find-game" },
      { label: "Challenge Teams", href: "/challenge-teams" },
      { label: "Wishlist", href: "/dashboard/player/wishlist" },
    ];
  }

  if (user.role === "COURT_OWNER") {
    if (ownerVenueStatus === "APPROVED") {
      return [
        { label: "Courts", href: "/courts" },
        { label: "Owner Dashboard", href: "/dashboard/owner" },
        { label: "Manage Venue", href: "/dashboard/owner/venue" },
        { label: "Manage Courts", href: "/dashboard/owner/courts" },
        { label: "Bookings", href: "/dashboard/owner/bookings" },
        { label: "Refunds", href: "/dashboard/owner/refunds" },
        { label: "Slot Calendar", href: "/dashboard/owner/calendar" },
      ];
    }

    const setupLabel =
      ownerVenueStatus === "DRAFT"
        ? "Continue Venue Setup"
        : ownerVenueStatus === "PENDING"
          ? "Venue Status"
          : ownerVenueStatus === "NEEDS_CHANGES"
            ? "Fix Venue Submission"
            : "Complete Venue Setup";

    return [
      { label: "Courts", href: "/courts" },
      { label: setupLabel, href: "/dashboard/owner/venue-setup" },
    ];
  }

  return [
    { label: "Admin Dashboard", href: "/dashboard/admin" },
    { label: "Venue Approvals", href: "/dashboard/admin/venues" },
    { label: "Bookings", href: "/dashboard/owner/bookings" },
    { label: "Users", href: "/dashboard/admin" },
  ];
}

function getProfileLinks(user: User) {
  if (user.role === "PLAYER") {
    return [
      { label: "Dashboard", href: "/dashboard/player" },
      { label: "My Profile", href: "/dashboard/player/profile" },
      { label: "Settings", href: "/dashboard/player/settings" },
    ];
  }

  if (user.role === "COURT_OWNER") {
    return [
      { label: "Owner Dashboard", href: "/dashboard/owner" },
      { label: "Manage Venue", href: "/dashboard/owner/venue" },
      { label: "My Account", href: "/dashboard/owner" },
    ];
  }

  return [
    { label: "Admin Dashboard", href: "/dashboard/admin" },
    { label: "Venue Approvals", href: "/dashboard/admin/venues" },
  ];
}

function BellIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M15 17H9m9-2v-4a6 6 0 1 0-12 0v4l-2 2h16l-2-2Zm-4 4a2 2 0 0 1-4 0"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
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
