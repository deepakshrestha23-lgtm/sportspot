import type { ReactNode } from "react";

export function DashboardContentContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl space-y-6">{children}</div>;
}
