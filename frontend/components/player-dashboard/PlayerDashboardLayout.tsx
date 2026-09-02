"use client";

import { usePathname } from "next/navigation";
import { type ReactNode } from "react";

import { DashboardContentContainer } from "@/components/player-dashboard/DashboardContentContainer";
import { PlayerSidebar, DashboardIcon } from "@/components/player-dashboard/PlayerSidebar";
import { getActivePlayerDashboardItem } from "@/components/player-dashboard/navigation";
import RoleGate from "@/components/RoleGate";

export default function PlayerDashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeItem = getActivePlayerDashboardItem(pathname);

  return (
    <RoleGate allowedRoles={["PLAYER"]} workspace="player">
      <div className="sport-page-shell player-dashboard-theme">
        <div className="border-b border-slate-200/80 bg-white px-4 py-3 lg:hidden">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wide text-sportGreen">Player Dashboard</p>
              <div className="mt-1 flex min-w-0 items-center gap-2 text-sm font-black text-sportNavy">
                <span className="shrink-0 text-sportGreen"><DashboardIcon name={activeItem.icon} /></span>
                <span className="truncate">{activeItem.label}</span>
              </div>
            </div>
            <span className="rounded-full bg-green-50 px-3 py-1.5 text-xs font-black text-green-800">Player</span>
          </div>
        </div>

        <div className="flex min-w-0">
          <PlayerSidebar />
          <main className="player-dashboard-main min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
            <DashboardContentContainer>{children}</DashboardContentContainer>
          </main>
        </div>
      </div>
    </RoleGate>
  );
}

