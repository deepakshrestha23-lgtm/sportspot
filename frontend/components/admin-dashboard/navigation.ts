export type AdminDashboardNavItem = {
  label: string;
  description: string;
  href: string;
  icon: "overview" | "venues" | "users" | "bookings" | "moderation" | "reliability" | "operations" | "support";
  match: string[];
  exact?: boolean;
};

export const adminDashboardNavItems: AdminDashboardNavItem[] = [
  { label: "Overview", description: "Platform pulse", href: "/dashboard/admin", icon: "overview", match: ["/dashboard/admin"], exact: true },
  { label: "Venue approvals", description: "Trust queue", href: "/dashboard/admin/venues", icon: "venues", match: ["/dashboard/admin/venues"] },
  { label: "Users", description: "Accounts and access", href: "/dashboard/admin/users", icon: "users", match: ["/dashboard/admin/users"] },
  { label: "Bookings & payments", description: "Marketplace operations", href: "/dashboard/admin/bookings", icon: "bookings", match: ["/dashboard/admin/bookings"] },
  { label: "Reports & moderation", description: "Player voice and safety", href: "/dashboard/admin/reports", icon: "moderation", match: ["/dashboard/admin/reports"] },
  { label: "Reliability review", description: "Attendance disputes", href: "/dashboard/admin/reliability", icon: "reliability", match: ["/dashboard/admin/reliability"] },
  { label: "Games & scoring", description: "Platform activity", href: "/dashboard/admin/operations", icon: "operations", match: ["/dashboard/admin/operations"] },
];

export const adminDashboardUtilityItem: AdminDashboardNavItem = {
  label: "Help & Support",
  description: "Get help with SportSpot",
  href: "/support",
  icon: "support",
  match: ["/support"],
};

export function isAdminDashboardItemActive(pathname: string, item: AdminDashboardNavItem) {
  if (item.exact) return item.match.some((path) => pathname === path);
  return item.match.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function getActiveAdminDashboardItem(pathname: string) {
  return [...adminDashboardNavItems, adminDashboardUtilityItem].find((item) => isAdminDashboardItemActive(pathname, item)) || adminDashboardNavItems[0];
}
