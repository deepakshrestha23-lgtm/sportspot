"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import Navbar from "@/components/Navbar";
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

  return (
    <ToastProvider>
      {!shouldHideNavbar ? <Navbar /> : null}
      {children}
    </ToastProvider>
  );
}