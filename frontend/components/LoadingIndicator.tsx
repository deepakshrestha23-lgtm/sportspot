import type { HTMLAttributes } from "react";

type LoadingIndicatorProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  label?: string;
  size?: "sm" | "md" | "lg";
  tone?: "green" | "muted" | "inverse";
};

export default function LoadingIndicator({
  className = "",
  label = "Loading",
  size = "md",
  tone = "muted",
  ...props
}: LoadingIndicatorProps) {
  return (
    <span
      aria-label={label}
      className={`sport-loading-indicator sport-loading-indicator-${size} sport-loading-indicator-${tone} ${className}`.trim()}
      role="status"
      {...props}
    >
      <span aria-hidden="true" className="sport-loading-spinner" />
      <span>{label}</span>
    </span>
  );
}

export function LoadingScreen({ label = "Loading page" }: { label?: string }) {
  return (
    <div aria-busy="true" className="sport-loading-screen">
      <LoadingIndicator label={label} size="lg" />
    </div>
  );
}
