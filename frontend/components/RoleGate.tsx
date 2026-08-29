"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getCurrentUser, getDashboardPath } from "@/lib/auth";
import type { UserRole } from "@/types/auth";

export default function RoleGate({ allowedRoles, children, workspace }: { allowedRoles: UserRole[]; children: React.ReactNode; workspace?: "player" | "owner" }) {
  const router = useRouter();
  const [isAllowed, setIsAllowed] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const allowedRoleKey = allowedRoles.join("|");

  useEffect(() => {
    const user = getCurrentUser();
    const roles = allowedRoleKey.split("|") as UserRole[];
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!roles.includes(user.role)) {
      router.replace(getDashboardPath(user.role));
      return;
    }
    setIsAllowed(true);
    setIsChecking(false);
  }, [allowedRoleKey, router]);

  if (isChecking) {
    return (
      <RoleGateSkeleton workspace={workspace} />
    );
  }

  if (!isAllowed) return null;
  return <>{children}</>;
}

function RoleGateSkeleton({ workspace }: { workspace?: "player" | "owner" }) {
  return (
    <div aria-busy="true" aria-label="Loading workspace" className="sport-page-shell">
      <div className="flex min-w-0">
        <aside className="hidden w-[252px] shrink-0 border-r border-slate-200/80 bg-white lg:block">
          <div className="space-y-3 px-5 py-6">
            <div className="h-4 w-28 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-36 animate-pulse rounded bg-slate-100" />
            <div className="space-y-2 pt-6">
              {[0, 1, 2, 3, 4, 5, 6].map((item) => <div className="h-11 animate-pulse rounded-md bg-slate-100" key={item} />)}
            </div>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <div className="mx-auto w-full max-w-7xl space-y-5">
            <div className="h-8 w-56 animate-pulse rounded-md bg-white" />
            <div className="h-4 w-80 max-w-full animate-pulse rounded bg-white" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map((item) => <div className="h-28 animate-pulse rounded-xl bg-white" key={item} />)}
            </div>
            <div className="h-72 animate-pulse rounded-xl bg-white" />
          </div>
        </main>
      </div>
      <span className="sr-only">{workspace === "owner" ? "Loading venue manager" : "Loading player dashboard"}</span>
    </div>
  );
}
