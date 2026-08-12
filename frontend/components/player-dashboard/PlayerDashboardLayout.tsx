"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { DashboardContentContainer } from "@/components/player-dashboard/DashboardContentContainer";
import { MobileDashboardDrawer } from "@/components/player-dashboard/MobileDashboardDrawer";
import { PlayerSidebar, DashboardIcon } from "@/components/player-dashboard/PlayerSidebar";
import { getActivePlayerDashboardItem } from "@/components/player-dashboard/navigation";
import RoleGate from "@/components/RoleGate";

export default function PlayerDashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const activeItem = getActivePlayerDashboardItem(pathname);

  return (
    <RoleGate allowedRoles={["PLAYER"]}>
      <div className="min-h-[calc(100vh-68px)] bg-slate-50">
        <div className="border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wide text-sportGreen">Player Dashboard</p>
              <div className="mt-1 flex min-w-0 items-center gap-2 text-sm font-black text-sportNavy">
                <span className="shrink-0 text-sportGreen"><DashboardIcon name={activeItem.icon} /></span>
                <span className="truncate">{activeItem.label}</span>
              </div>
            </div>
            <button
              aria-controls="player-dashboard-mobile-menu"
              aria-expanded={isDrawerOpen}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-black text-sportNavy shadow-sm outline-none hover:border-green-200 hover:text-sportGreen focus-visible:ring-2 focus-visible:ring-sportGreen"
              onClick={() => setIsDrawerOpen(true)}
              type="button"
            >
              <MenuIcon />
              Menu
            </button>
          </div>
        </div>

        <div className="flex min-w-0">
          <PlayerSidebar />
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <DashboardContentContainer>{children}</DashboardContentContainer>
          </main>
        </div>

        <MobileDashboardDrawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} pathname={pathname} />
      </div>
    </RoleGate>
  );
}

function MenuIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

