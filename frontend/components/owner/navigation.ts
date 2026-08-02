import type { Venue } from "@/types/venue";

export type OwnerLifecycleState =
  | "NO_VENUE"
  | "SETUP_INCOMPLETE"
  | "PENDING_VERIFICATION"
  | "CHANGES_REQUIRED"
  | "ACTIVE"
  | "TEMPORARILY_INACTIVE"
  | "SUSPENDED";

export type OwnerDashboardNavIcon =
  | "overview"
  | "calendar"
  | "bookings"
  | "venue"
  | "availability"
  | "payments"
  | "reports"
  | "settings"
  | "support"
  | "setup"
  | "courts"
  | "verification";

export type OwnerDashboardNavItem = {
  label: string;
  href: string;
  icon: OwnerDashboardNavIcon;
  match: string[];
  exact?: boolean;
};

const activeVenueItems: OwnerDashboardNavItem[] = [
  { label: "Overview", href: "/dashboard/owner", icon: "overview", match: ["/dashboard/owner"], exact: true },
  { label: "Calendar", href: "/dashboard/owner/calendar", icon: "calendar", match: ["/dashboard/owner/calendar"] },
  { label: "Bookings", href: "/dashboard/owner/bookings", icon: "bookings", match: ["/dashboard/owner/bookings"] },
  { label: "Venue & Courts", href: "/dashboard/owner/venue", icon: "venue", match: ["/dashboard/owner/venue", "/dashboard/owner/courts"] },
  { label: "Availability & Pricing", href: "/dashboard/owner/availability", icon: "availability", match: ["/dashboard/owner/availability"] },
  { label: "Payments & Refunds", href: "/dashboard/owner/refunds", icon: "payments", match: ["/dashboard/owner/refunds", "/dashboard/owner/payments"] },
  { label: "Reports", href: "/dashboard/owner/reports", icon: "reports", match: ["/dashboard/owner/reports"] },
  { label: "Settings", href: "/dashboard/owner/settings", icon: "settings", match: ["/dashboard/owner/settings"] },
];

const noVenueItems: OwnerDashboardNavItem[] = [
  { label: "Get Started", href: "/dashboard/owner", icon: "overview", match: ["/dashboard/owner"], exact: true },
  { label: "Venue Registration", href: "/dashboard/owner/venue-setup", icon: "setup", match: ["/dashboard/owner/venue-setup"] },
  { label: "Settings", href: "/dashboard/owner/settings", icon: "settings", match: ["/dashboard/owner/settings"] },
];

const setupItems: OwnerDashboardNavItem[] = [
  { label: "Setup Progress", href: "/dashboard/owner", icon: "overview", match: ["/dashboard/owner"], exact: true },
  { label: "Venue Details", href: "/dashboard/owner/venue-setup", icon: "venue", match: ["/dashboard/owner/venue-setup"] },
  { label: "Courts", href: "/dashboard/owner/courts", icon: "courts", match: ["/dashboard/owner/courts"] },
  { label: "Availability & Pricing", href: "/dashboard/owner/availability", icon: "availability", match: ["/dashboard/owner/availability"] },
  { label: "Verification", href: "/dashboard/owner/venue-setup?step=verification", icon: "verification", match: ["/dashboard/owner/verification"] },
  { label: "Settings", href: "/dashboard/owner/settings", icon: "settings", match: ["/dashboard/owner/settings"] },
];

const reviewItems: OwnerDashboardNavItem[] = [
  { label: "Overview", href: "/dashboard/owner", icon: "overview", match: ["/dashboard/owner"], exact: true },
  { label: "Venue & Courts", href: "/dashboard/owner/venue", icon: "venue", match: ["/dashboard/owner/venue", "/dashboard/owner/courts", "/dashboard/owner/venue-setup"] },
  { label: "Availability & Pricing", href: "/dashboard/owner/availability", icon: "availability", match: ["/dashboard/owner/availability"] },
  { label: "Settings", href: "/dashboard/owner/settings", icon: "settings", match: ["/dashboard/owner/settings"] },
];

const suspendedItems: OwnerDashboardNavItem[] = [
  { label: "Overview", href: "/dashboard/owner", icon: "overview", match: ["/dashboard/owner"], exact: true },
  { label: "Bookings", href: "/dashboard/owner/bookings", icon: "bookings", match: ["/dashboard/owner/bookings"] },
  { label: "Venue & Courts", href: "/dashboard/owner/venue", icon: "venue", match: ["/dashboard/owner/venue", "/dashboard/owner/courts", "/dashboard/owner/venue-setup"] },
  { label: "Payments & Refunds", href: "/dashboard/owner/refunds", icon: "payments", match: ["/dashboard/owner/refunds", "/dashboard/owner/payments"] },
  { label: "Reports", href: "/dashboard/owner/reports", icon: "reports", match: ["/dashboard/owner/reports"] },
  { label: "Settings", href: "/dashboard/owner/settings", icon: "settings", match: ["/dashboard/owner/settings"] },
];

export const ownerDashboardUtilityItem: OwnerDashboardNavItem = {
  label: "Help & Support",
  href: "/support",
  icon: "support",
  match: ["/support"],
};

export function getOwnerLifecycleState(venue: Venue | null): OwnerLifecycleState {
  if (!venue) return "NO_VENUE";
  if (venue.status === "SUSPENDED") return "SUSPENDED";
  if (venue.status === "APPROVED" && !venue.is_active) return "TEMPORARILY_INACTIVE";
  if (venue.status === "APPROVED") return "ACTIVE";
  if (venue.status === "PENDING") return "PENDING_VERIFICATION";
  if (venue.status === "NEEDS_CHANGES" || venue.status === "REJECTED") return "CHANGES_REQUIRED";
  return "SETUP_INCOMPLETE";
}

export function getOwnerDashboardNavItems(lifecycleState: OwnerLifecycleState) {
  if (lifecycleState === "NO_VENUE") return noVenueItems;
  if (lifecycleState === "SETUP_INCOMPLETE") return setupItems;
  if (lifecycleState === "PENDING_VERIFICATION" || lifecycleState === "CHANGES_REQUIRED") return reviewItems;
  if (lifecycleState === "SUSPENDED") return suspendedItems;
  return activeVenueItems;
}

export function isOwnerDashboardItemActive(pathname: string, item: OwnerDashboardNavItem) {
  if (item.exact) return item.match.some((path) => pathname === path);
  return item.match.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function getActiveOwnerDashboardItem(pathname: string, lifecycleState: OwnerLifecycleState) {
  return (
    [...getOwnerDashboardNavItems(lifecycleState), ownerDashboardUtilityItem].find((item) => isOwnerDashboardItemActive(pathname, item)) ||
    getOwnerDashboardNavItems(lifecycleState)[0]
  );
}

export function getLifecycleStatusLabel(lifecycleState: OwnerLifecycleState) {
  return {
    NO_VENUE: "Setup Incomplete",
    SETUP_INCOMPLETE: "Setup Incomplete",
    PENDING_VERIFICATION: "Pending Verification",
    CHANGES_REQUIRED: "Changes Required",
    ACTIVE: "Active",
    TEMPORARILY_INACTIVE: "Temporarily Inactive",
    SUSPENDED: "Suspended",
  }[lifecycleState];
}
