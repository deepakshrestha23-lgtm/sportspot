"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getCurrentUser, getDashboardPath } from "@/lib/auth";
import type { UserRole } from "@/types/auth";

export default function RoleGate({ allowedRoles, children }: { allowedRoles: UserRole[]; children: React.ReactNode }) {
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
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-600 shadow-sm">
          Checking dashboard access...
        </div>
      </div>
    );
  }

  if (!isAllowed) return null;
  return <>{children}</>;
}
