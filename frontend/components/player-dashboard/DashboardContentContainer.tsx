import type { ReactNode } from "react";

export function DashboardContentContainer({ children }: { children: ReactNode }) {
  return <div className="sport-page-content">{children}</div>;
}
