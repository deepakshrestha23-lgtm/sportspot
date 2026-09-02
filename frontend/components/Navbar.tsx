"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import Logo from "@/components/Logo";
import NotificationCenter from "@/components/NotificationCenter";
import {
  adminDashboardNavItems,
  adminDashboardSettingsItem,
  adminDashboardUtilityItem,
  isAdminDashboardItemActive,
} from "@/components/admin-dashboard/navigation";
import { api } from "@/lib/api";
import { clearAuthSession, getCurrentUser } from "@/lib/auth";
import type { User } from "@/types/auth";
import type { NotificationPreview } from "@/types/notification";
import type { Booking, Venue, VenueStatus } from "@/types/venue";

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [unseenNotificationsCount, setUnseenNotificationsCount] = useState(0);
  const [notificationToast, setNotificationToast] = useState<NotificationPreview | null>(null);
  const [hasNewNotification, setHasNewNotification] = useState(false);
  const [ownerVenueStatus, setOwnerVenueStatus] = useState<VenueStatus | "NONE">("NONE");
  const [pendingReservation, setPendingReservation] = useState<Booking | null>(null);
  const [dismissedReservationId, setDismissedReservationId] = useState<number | null>(null);
  const [now, setNow] = useState<Date | null>(null);
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
    if (user?.role !== "PLAYER") {
      setPendingReservation(null);
      return;
    }

    let isActive = true;
    api
      .get<{ bookings: Booking[] }>("/api/venues/bookings/my/")
      .then((response) => {
        if (isActive) {
          const nextReservation = findPendingReservation(response.data.bookings);
          setPendingReservation(nextReservation);
          setDismissedReservationId((currentId) => currentId !== nextReservation?.id ? null : currentId);
        }
      })
      .catch(() => {
        if (isActive) {
          setPendingReservation(null);
          setDismissedReservationId(null);
        }
      });

    return () => {
      isActive = false;
    };
  }, [pathname, user?.role]);

  useEffect(() => {
    if (!pendingReservation) {
      setNow(null);
      return;
    }
    const reservation = pendingReservation;

    function updateReservationClock() {
      const currentTime = new Date();
      setNow(currentTime);
      if (new Date(reservation.reserved_until).getTime() <= currentTime.getTime()) {
        setPendingReservation(null);
      }
    }

    updateReservationClock();
    const timer = window.setInterval(updateReservationClock, 1000);
    return () => window.clearInterval(timer);
  }, [pendingReservation]);

  useEffect(() => {
    setIsMobileNavigationOpen(false);
    setIsProfileOpen(false);
    setIsNotificationsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isMobileNavigationOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileNavigationOpen(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobileNavigationOpen]);

  function handleLogout() {
    clearAuthSession();
    setUser(null);
    setIsMobileNavigationOpen(false);
    setIsProfileOpen(false);
    setIsNotificationsOpen(false);
    setUnseenNotificationsCount(0);
    setPendingReservation(null);
    setDismissedReservationId(null);
    setNow(null);
    router.push("/");
  }

  const handleNewNotification = useCallback((notification: NotificationPreview) => {
    setNotificationToast(notification);
    setHasNewNotification(true);
    window.setTimeout(() => setNotificationToast(null), 5000);
    window.setTimeout(() => setHasNewNotification(false), 1800);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white">
        <nav aria-label="Primary navigation" className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 py-2 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <Logo markClassName="h-8 max-w-[120px] sm:max-w-[140px]" textClassName="text-[1.15rem]" />
            <button
              aria-controls="sportspot-mobile-navigation"
              aria-expanded={isMobileNavigationOpen}
              aria-label="Open navigation"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition-colors hover:border-green-200 hover:bg-green-50 hover:text-sportGreen focus:outline-none focus-visible:ring-2 focus-visible:ring-sportGreen focus-visible:ring-offset-2 lg:hidden"
              onClick={() => setIsMobileNavigationOpen(true)}
              type="button"
            >
              <MenuIcon />
            </button>
          </div>

          <div className="hidden items-center gap-7 text-[13px] font-semibold text-slate-600 lg:flex">
            {getNavLinks(user, ownerVenueStatus).map((link) => {
              const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
              <Link aria-current={isActive ? "page" : undefined} className={`relative py-2 transition-colors hover:text-sportGreen ${isActive ? "text-sportGreen after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:rounded-full after:bg-sportGreen" : ""}`} href={link.href} key={link.href}>
                {link.label}
              </Link>
              );
            })}
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
                  className={`relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition-colors hover:border-green-200 hover:bg-green-50 hover:text-sportGreen ${hasNewNotification ? "border-green-300 text-sportGreen" : ""}`}
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
                    className="flex min-h-10 max-w-[150px] items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:border-green-200 hover:bg-slate-50 sm:max-w-none"
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
                    <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl" role="menu">
                      {getProfileLinks(user).map((link) => (
                        <Link className="block rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-slate-50 hover:text-sportGreen" href={link.href} key={link.label} role="menuitem">
                          {link.label}
                        </Link>
                      ))}
                      <button
                        className="w-full rounded-md px-3 py-2.5 text-left text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
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

      {isMobileNavigationOpen ? (
        <MobileNavigationDrawer
          links={getMobileNavigationLinks(user, ownerVenueStatus)}
          onClose={() => setIsMobileNavigationOpen(false)}
          onLogout={handleLogout}
          pathname={pathname}
          user={user}
        />
      ) : null}

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
        <div aria-live="polite" className="fixed right-4 top-20 z-40 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-green-200 bg-white p-4 shadow-xl" role="status">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-sportGreen">{notificationToast.notification_type === "CHAT_MESSAGE_RECEIVED" ? "New chat message" : "New notification"}</p>
          <p className="mt-1 text-sm font-black text-sportNavy">{notificationToast.title}</p>
          <p className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-slate-600">{notificationToast.message}</p>
          {notificationToast.action_url ? <Link className="mt-3 inline-flex min-h-9 items-center rounded-md bg-sportGreen px-3 text-xs font-black text-white hover:bg-green-700" href={notificationToast.action_url} onClick={() => setNotificationToast(null)}>{notificationToast.notification_type === "CHAT_MESSAGE_RECEIVED" ? "Open chat" : "Open notification"}</Link> : null}
        </div>
      ) : null}
      {user?.role === "PLAYER" && pendingReservation && now && dismissedReservationId !== pendingReservation.id && !pathname.startsWith("/dashboard/player/bookings/payment/") ? (
        <PendingReservationBanner booking={pendingReservation} now={now} onDismiss={() => setDismissedReservationId(pendingReservation.id)} />
      ) : null}
    </>
  );
}

type NavigationLink = { label: string; href: string; description?: string };

function MobileNavigationDrawer({ links, onClose, onLogout, pathname, user }: { links: NavigationLink[]; onClose: () => void; onLogout: () => void; pathname: string; user: User | null }) {
  return (
    <div aria-label="SportSpot navigation" aria-modal="true" className="fixed inset-0 z-[60] lg:hidden" role="dialog">
      <button aria-label="Close navigation" className="absolute inset-0 bg-sportNavy/40" onClick={onClose} type="button" />
      <aside className="relative ml-auto flex h-full w-[min(21rem,88vw)] flex-col bg-white shadow-2xl" id="sportspot-mobile-navigation">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-5">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-sportGreen">SportSpot</p>
            <p className="mt-1 text-lg font-black text-sportNavy">Navigation</p>
            {user ? <p className="mt-1 text-xs font-semibold text-slate-500">{getRoleLabel(user.role)}</p> : null}
          </div>
          <button aria-label="Close navigation" className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:border-green-200 hover:bg-green-50 hover:text-sportGreen focus:outline-none focus-visible:ring-2 focus-visible:ring-sportGreen focus-visible:ring-offset-2" onClick={onClose} type="button"><CloseIcon /></button>
        </div>

        <nav aria-label="Mobile navigation" className="flex-1 overflow-y-auto px-3 py-4">
          <div className="space-y-1">
            {links.map((link) => {
              const isActive = isMobileNavigationLinkActive(pathname, link.href);
              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={`block rounded-md px-4 py-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sportGreen focus-visible:ring-offset-2 ${isActive ? "bg-green-50 text-green-800" : "text-slate-700 hover:bg-slate-50 hover:text-sportGreen"}`}
                  href={link.href}
                  key={link.href}
                  onClick={onClose}
                >
                  <span className="block text-sm font-black">{link.label}</span>
                  {link.description ? <span className={`mt-0.5 block text-xs font-medium ${isActive ? "text-green-700" : "text-slate-500"}`}>{link.description}</span> : null}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-slate-100 p-4">
          {user ? (
            <>
              <div className="flex min-w-0 items-center gap-3 px-1 py-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sportGreen text-sm font-black text-white">{user.full_name.charAt(0).toUpperCase()}</span>
                <div className="min-w-0"><p className="truncate text-sm font-black text-sportNavy">{user.full_name}</p><p className="truncate text-xs font-medium text-slate-500">{user.email}</p></div>
              </div>
              <button className="mt-3 flex min-h-11 w-full items-center justify-center rounded-md border border-red-200 bg-white px-3 text-sm font-black text-red-600 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2" onClick={onLogout} type="button">Logout</button>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Link className="flex min-h-11 items-center justify-center rounded-md border border-slate-200 text-sm font-black text-slate-700 transition-colors hover:border-green-200 hover:text-sportGreen" href="/login" onClick={onClose}>Login</Link>
              <Link className="flex min-h-11 items-center justify-center rounded-md bg-sportGreen text-sm font-black text-white transition-colors hover:bg-green-700" href="/register" onClick={onClose}>Sign up</Link>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function PendingReservationBanner({ booking, now, onDismiss }: { booking: Booking; now: Date; onDismiss: () => void }) {
  const secondsLeft = Math.max(0, Math.floor((new Date(booking.reserved_until).getTime() - now.getTime()) / 1000));
  if (secondsLeft <= 0) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-amber-700 shadow-sm"><ClockIcon /></span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-950">Finish your court reservation</p>
            <p className="truncate text-xs font-semibold text-amber-900/80">{booking.venue_name} · {booking.court_name} · {booking.booking_display_time || booking.slot_display_time}</p>
          </div>
          <span aria-hidden="true" className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-bold tabular-nums text-amber-800 shadow-sm">Expires in {formatReservationCountdown(secondsLeft)}</span>
        </div>
        <div className="flex shrink-0 gap-2 pl-11 sm:pl-0">
          <Link className="inline-flex min-h-10 items-center justify-center rounded-md bg-sportGreen px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-300 focus-visible:ring-offset-2" href={`/dashboard/player/bookings/payment/${booking.id}`}>Continue payment</Link>
          <Link className="inline-flex min-h-10 items-center justify-center rounded-md border border-amber-300 bg-white px-3.5 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2" href="/dashboard/player/bookings">My bookings</Link>
          <button aria-label="Dismiss reservation reminder" className="inline-flex min-h-10 w-10 items-center justify-center rounded-md border border-transparent text-amber-800 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2" onClick={onDismiss} title="Dismiss reminder" type="button"><CloseIcon /></button>
        </div>
      </div>
    </div>
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
      { label: "Cricket Scorer", href: "/scorer" },
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
    { label: "Bookings", href: "/dashboard/admin/bookings" },
    { label: "Users", href: "/dashboard/admin/users" },
    { label: "Reports", href: "/dashboard/admin/reports" },
  ];
}

function getProfileLinks(user: User) {
  if (user.role === "PLAYER") {
    return [
      { label: "Dashboard", href: "/dashboard/player" },
      { label: "My Bookings", href: "/dashboard/player/bookings" },
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
    { label: "Bookings & payments", href: "/dashboard/admin/bookings" },
    { label: "Users", href: "/dashboard/admin/users" },
    { label: "Reports & moderation", href: "/dashboard/admin/reports" },
    { label: "Admin Settings", href: "/dashboard/admin/settings" },
  ];
}

function getMobileNavigationLinks(user: User | null, ownerVenueStatus: VenueStatus | "NONE"): NavigationLink[] {
  if (user?.role === "ADMIN") {
    return [...adminDashboardNavItems, adminDashboardSettingsItem, adminDashboardUtilityItem].map((item) => ({
      label: item.label,
      href: item.href,
      description: item.description,
    }));
  }

  const links = user ? [...getNavLinks(user, ownerVenueStatus), ...getProfileLinks(user)] : getNavLinks(user, ownerVenueStatus);
  return links.filter((link, index) => links.findIndex((candidate) => candidate.href === link.href) === index);
}

function isMobileNavigationLinkActive(pathname: string, href: string) {
  if (href === "/dashboard/admin") return isAdminDashboardItemActive(pathname, adminDashboardNavItems[0]);
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getRoleLabel(role: User["role"]) {
  if (role === "ADMIN") return "Admin workspace";
  if (role === "COURT_OWNER") return "Venue owner workspace";
  return "Player workspace";
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

function ClockIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

function findPendingReservation(bookings: Booking[]) {
  const currentTime = Date.now();
  return bookings
    .filter((booking) => booking.status === "RESERVED" && booking.payment_status === "PENDING")
    .filter((booking) => Boolean(booking.reserved_until) && new Date(booking.reserved_until).getTime() > currentTime)
    .sort((first, second) => new Date(first.reserved_until).getTime() - new Date(second.reserved_until).getTime())[0] || null;
}

function formatReservationCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
}
