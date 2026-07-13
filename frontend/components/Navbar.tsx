"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import NotificationCenter from "@/components/NotificationCenter";
import { clearAuthSession, getCurrentUser, getDashboardPath } from "@/lib/auth";
import type { User } from "@/types/auth";

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  useEffect(() => {
    setUser(getCurrentUser());
    setIsProfileOpen(false);
  }, [pathname]);

  function handleLogout() {
    clearAuthSession();
    setUser(null);
    setIsProfileOpen(false);
    setIsNotificationsOpen(false);
    router.push("/");
  }

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="shrink-0 text-xl font-black tracking-tight text-sportNavy">
            SportSpot
          </Link>

          <div className="hidden items-center gap-6 text-sm font-semibold text-slate-700 lg:flex">
            <Link className="hover:text-sportGreen" href="/courts">
              Courts
            </Link>
            <Link className="hover:text-sportGreen" href="/find-game">
              Find Game
            </Link>
            <Link className="hover:text-sportGreen" href="/challenge-teams">
              Challenge Teams
            </Link>
            {!user ? (
              <Link className="hover:text-sportGreen" href="#">
                Register Venue
              </Link>
            ) : null}
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
                  aria-label="Open notification center"
                  className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:border-green-200 hover:bg-green-50 hover:text-sportGreen"
                  onClick={() => setIsNotificationsOpen(true)}
                  type="button"
                >
                  <BellIcon />
                  <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-sportGreen ring-2 ring-white" />
                </button>

                <div className="relative">
                  <button
                    className="flex max-w-[150px] items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:max-w-none"
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
                    <div className="absolute right-0 mt-3 w-56 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
                      <Link className="block rounded px-3 py-2 text-sm hover:bg-slate-100" href={getDashboardPath(user.role)}>
                        Dashboard
                      </Link>
                      {user.role === "PLAYER" ? (
                        <Link className="block rounded px-3 py-2 text-sm hover:bg-slate-100" href="/dashboard/player/profile">
                          My Profile
                        </Link>
                      ) : null}
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
        <NotificationCenter isOpen={isNotificationsOpen} onClose={() => setIsNotificationsOpen(false)} />
      ) : null}
    </>
  );
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
