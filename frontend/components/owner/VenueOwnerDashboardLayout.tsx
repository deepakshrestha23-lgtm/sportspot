"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { getOwnerLifecycleState } from "@/components/owner/navigation";
import { OwnerDashboardContent } from "@/components/owner/OwnerPageHeader";
import { VenueOwnerSidebar } from "@/components/owner/VenueOwnerSidebar";
import { VenueOwnerMobileDrawer } from "@/components/owner/VenueOwnerMobileDrawer";
import RoleGate from "@/components/RoleGate";
import { api } from "@/lib/api";
import type { Venue } from "@/types/venue";

export default function VenueOwnerDashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [venue, setVenue] = useState<Venue | null>(null);
  const [isVenueLoading, setIsVenueLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    setIsVenueLoading(true);
    api
      .get<{ venue: Venue | null }>("/api/venues/owner/venue/")
      .then((response) => {
        if (mounted) setVenue(response.data.venue);
      })
      .catch(() => {
        if (mounted) setVenue(null);
      })
      .finally(() => {
        if (mounted) setIsVenueLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    function openOwnerMenu() {
      setIsDrawerOpen(true);
    }
    window.addEventListener("sportspot-owner-menu-toggle", openOwnerMenu);
    return () => window.removeEventListener("sportspot-owner-menu-toggle", openOwnerMenu);
  }, []);

  const lifecycleState = isVenueLoading ? "SETUP_INCOMPLETE" : getOwnerLifecycleState(venue);

  return (
    <RoleGate allowedRoles={["COURT_OWNER"]} workspace="owner">
      <div className="sport-page-shell">

        <div className="flex min-w-0">
          <VenueOwnerSidebar isLoading={isVenueLoading} venue={venue} />
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
            <OwnerDashboardContent>{children}</OwnerDashboardContent>
          </main>
        </div>

        <VenueOwnerMobileDrawer
          isOpen={isDrawerOpen}
          lifecycleState={lifecycleState}
          onClose={() => setIsDrawerOpen(false)}
          pathname={pathname}
          venue={venue}
        />
      </div>
    </RoleGate>
  );
}
