import type { ReactNode } from "react";

export function DashboardContentContainer({ children }: { children: ReactNode }) {
  return <div className="sport-page-content mx-auto max-w-6xl">{children}</div>;
}
