import { LoadingScreen } from "@/components/LoadingIndicator";

export function DashboardRouteLoading() {
  return <LoadingScreen label="Loading dashboard" />;
}

export function PublicRouteLoading({ title = "Loading" }: { title?: string }) {
  return <LoadingScreen label={`${title} loading`} />;
}
