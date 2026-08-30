"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import Navbar from "@/components/Navbar";
import SiteFooter from "@/components/SiteFooter";
import VenueOwnerTopBar from "@/components/owner/VenueOwnerTopBar";
import { ToastProvider } from "@/components/ToastProvider";

const authRoutes = [
  "/login",
  "/register",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
];

export default function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const shouldHideNavbar = authRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  const isOwnerWorkspace = pathname === "/dashboard/owner" || pathname.startsWith("/dashboard/owner/");

  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col">
        {!shouldHideNavbar ? (isOwnerWorkspace ? <VenueOwnerTopBar /> : <Navbar />) : null}
        <div className="min-w-0 flex-1">{children}</div>
        {!shouldHideNavbar ? <SiteFooter /> : null}
      </div>
    </ToastProvider>
  );
}
