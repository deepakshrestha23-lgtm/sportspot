import type { ReactNode } from "react";
import PlayerDashboardLayoutShell from "@/components/player-dashboard/PlayerDashboardLayout";

export default function PlayerDashboardLayout({ children }: { children: ReactNode }) {
  return <PlayerDashboardLayoutShell>{children}</PlayerDashboardLayoutShell>;
}
