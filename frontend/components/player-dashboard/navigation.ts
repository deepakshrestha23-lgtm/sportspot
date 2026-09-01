export type PlayerDashboardNavItem = {
  label: string;
  href: string;
  icon: "overview" | "profile" | "teams" | "games" | "bookings" | "performance" | "ratings" | "settings" | "support";
  match: string[];
  exact?: boolean;
};

export const playerDashboardNavItems: PlayerDashboardNavItem[] = [
  {
    label: "Overview",
    href: "/dashboard/player",
    icon: "overview",
    match: ["/dashboard/player"],
    exact: true,
  },
  {
    label: "My Profile",
    href: "/dashboard/player/profile",
    icon: "profile",
    match: ["/dashboard/player/profile"],
  },
  {
    label: "My Teams",
    href: "/dashboard/player/teams",
    icon: "teams",
    match: ["/dashboard/player/teams", "/dashboard/player/invitations"],
  },
  {
    label: "My Games",
    href: "/dashboard/player/games",
    icon: "games",
    match: ["/dashboard/player/games", "/dashboard/player/matches", "/dashboard/player/requests"],
  },
  {
    label: "My Bookings",
    href: "/dashboard/player/bookings",
    icon: "bookings",
    match: ["/dashboard/player/bookings"],
  },
  {
    label: "My Performance",
    href: "/dashboard/player/performance",
    icon: "performance",
    match: ["/dashboard/player/performance"],
  },
  {
    label: "Ratings & Reliability",
    href: "/dashboard/player/ratings",
    icon: "ratings",
    match: ["/dashboard/player/ratings"],
  },
  {
    label: "Settings",
    href: "/dashboard/player/settings",
    icon: "settings",
    match: ["/dashboard/player/settings"],
  },
];

export const playerDashboardUtilityItem: PlayerDashboardNavItem = {
  label: "Help & Support",
  href: "/support",
  icon: "support",
  match: ["/support"],
};

export function isPlayerDashboardItemActive(pathname: string, item: PlayerDashboardNavItem) {
  if (item.exact) return item.match.some((path) => pathname === path);
  return item.match.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function getActivePlayerDashboardItem(pathname: string) {
  return (
    [...playerDashboardNavItems, playerDashboardUtilityItem].find((item) => isPlayerDashboardItemActive(pathname, item)) ||
    playerDashboardNavItems[0]
  );
}
