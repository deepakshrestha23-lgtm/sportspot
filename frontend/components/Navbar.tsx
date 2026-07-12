"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { clearAuthSession, getCurrentUser, getDashboardPath } from "@/lib/auth";
import type { User } from "@/types/auth";

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    setUser(getCurrentUser());
    setIsMenuOpen(false);
  }, [pathname]);

  function handleLogout() {
    clearAuthSession();
    setUser(null);
    setIsMenuOpen(false);
    router.push("/");
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="text-xl font-bold tracking-tight text-sportNavy">
          SportSpot
        </Link>

        <div className="hidden items-center gap-6 text-sm font-medium text-slate-700 md:flex">
          <Link href="#">Courts</Link>
          <Link href="#">Find Game</Link>
          <Link href="#">Challenge Teams</Link>
        </div>

        <div className="flex items-center gap-3">
          {!user ? (
            <>
              <Link className="text-sm font-semibold text-slate-700" href="/login">
                Login
              </Link>
              <Link
                className="rounded-md bg-sportGreen px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700"
                href="/register"
              >
                Register
              </Link>
            </>
          ) : (
            <>
              <Link className="hidden text-sm font-semibold text-slate-700 sm:inline" href={getDashboardPath(user.role)}>
                Dashboard
              </Link>
              <button
                aria-label="Notifications"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
                type="button"
              >
                Notifications
              </button>
              <div className="relative">
                <button
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
                  onClick={() => setIsMenuOpen((value) => !value)}
                  type="button"
                >
                  {user.full_name}
                </button>
                {isMenuOpen ? (
                  <div className="absolute right-0 mt-2 w-56 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
                    <Link className="block rounded px-3 py-2 text-sm hover:bg-slate-100" href={getDashboardPath(user.role)}>
                      Dashboard
                    </Link>
                    <Link className="block rounded px-3 py-2 text-sm hover:bg-slate-100" href="#">
                      My Profile
                    </Link>
                    <Link className="block rounded px-3 py-2 text-sm hover:bg-slate-100" href="#">
                      My Teams
                    </Link>
                    <Link className="block rounded px-3 py-2 text-sm hover:bg-slate-100" href="#">
                      My Bookings
                    </Link>
                    <Link className="block rounded px-3 py-2 text-sm hover:bg-slate-100" href="#">
                      Notifications
                    </Link>
                    <button
                      className="w-full rounded px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
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
  );
}
