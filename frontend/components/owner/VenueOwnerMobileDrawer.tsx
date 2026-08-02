"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

import {
  getLifecycleStatusLabel,
  getOwnerDashboardNavItems,
  isOwnerDashboardItemActive,
  ownerDashboardUtilityItem,
  type OwnerLifecycleState,
} from "@/components/owner/navigation";
import { VenueLifecycleBadge, VenueOwnerSidebarItem } from "@/components/owner/VenueOwnerSidebar";
import type { Venue } from "@/types/venue";

export function VenueOwnerMobileDrawer({
  isOpen,
  lifecycleState,
  onClose,
  pathname,
  venue,
}: {
  isOpen: boolean;
  lifecycleState: OwnerLifecycleState;
  onClose: () => void;
  pathname: string;
  venue: Venue | null;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !drawerRef.current) return;

    const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!isOpen) return null;

  const navItems = getOwnerDashboardNavItems(lifecycleState);

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button aria-label="Close venue manager menu" className="absolute inset-0 bg-slate-950/45" onClick={onClose} type="button" />
      <aside
        aria-label="Venue Manager menu"
        aria-modal="true"
        className="absolute inset-y-0 left-0 flex w-full max-w-[350px] flex-col bg-white p-4 shadow-2xl outline-none"
        id="venue-owner-mobile-menu"
        onKeyDown={handleKeyDown}
        ref={drawerRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="rounded-lg border border-green-100 bg-green-50/70 px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-black text-sportNavy">Venue Manager</p>
              <p className="mt-1 truncate text-xs font-semibold text-slate-600">{venue?.name || getLifecycleStatusLabel(lifecycleState)}</p>
              <div className="mt-2"><VenueLifecycleBadge state={lifecycleState} /></div>
            </div>
            <button
              aria-label="Close venue manager menu"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-slate-500 outline-none hover:bg-white hover:text-sportNavy focus-visible:ring-2 focus-visible:ring-sportGreen"
              onClick={onClose}
              ref={closeButtonRef}
              type="button"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <nav aria-label="Venue Manager" className="mt-5 space-y-1">
          {navItems.map((item) => (
            <VenueOwnerSidebarItem
              isActive={isOwnerDashboardItemActive(pathname, item)}
              item={item}
              key={`${item.label}-${item.href}`}
              onNavigate={onClose}
            />
          ))}
        </nav>

        <div className="flex-1" />

        <nav aria-label="Venue Manager support" className="border-t border-slate-100 pt-3">
          <VenueOwnerSidebarItem
            isActive={isOwnerDashboardItemActive(pathname, ownerDashboardUtilityItem)}
            item={ownerDashboardUtilityItem}
            onNavigate={onClose}
          />
        </nav>
      </aside>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}
