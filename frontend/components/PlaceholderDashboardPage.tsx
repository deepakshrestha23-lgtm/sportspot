import { DashboardPageHeader } from "@/components/player-dashboard/DashboardPageHeader";

export function PlaceholderDashboardPage({ description, title }: { description: string; title: string }) {
  return (
    <DashboardPageHeader
      eyebrow="Player Dashboard"
      title={title}
      description={`${description} This section will be implemented next.`}
    />
  );
}
