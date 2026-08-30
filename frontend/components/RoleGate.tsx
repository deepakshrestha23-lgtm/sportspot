"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { LoadingScreen } from "@/components/LoadingIndicator";
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
    <div className={`sport-page-shell ${workspace === "player" ? "player-dashboard-theme" : ""}`}>
      <LoadingScreen label={workspace === "owner" ? "Loading venue manager" : "Loading player dashboard"} />
    </div>
  );
}
