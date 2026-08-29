"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

import { PlayerSidebarItem } from "@/components/player-dashboard/PlayerSidebar";
import {
  isPlayerDashboardItemActive,
  playerDashboardNavItems,
  playerDashboardUtilityItem,
} from "@/components/player-dashboard/navigation";

export function MobileDashboardDrawer({
  isOpen,
  onClose,
  pathname,
}: {
  isOpen: boolean;
  onClose: () => void;
  pathname: string;
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
    if (focusable.length === 0) return;
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

  return (
    <div className="player-dashboard-drawer fixed inset-0 z-50 lg:hidden">
      <button aria-label="Close dashboard menu" className="player-dashboard-drawer-backdrop absolute inset-0 bg-slate-950/45" onClick={onClose} type="button" />
      <aside
        aria-label="Player dashboard menu"
        aria-modal="true"
        className="player-dashboard-drawer-panel absolute inset-y-0 left-0 flex w-full max-w-[340px] flex-col bg-white p-4 shadow-2xl outline-none"
        id="player-dashboard-mobile-menu"
        onKeyDown={handleKeyDown}
        ref={drawerRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4 rounded-lg border border-green-100 bg-green-50/70 px-4 py-3">
          <div>
            <p className="text-sm font-black text-sportNavy">Player Dashboard</p>
            <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">Manage your SportSpot activity</p>
          </div>
          <button
            aria-label="Close dashboard menu"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-slate-500 outline-none hover:bg-white hover:text-sportNavy focus-visible:ring-2 focus-visible:ring-sportGreen"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>

        <nav aria-label="Player dashboard" className="mt-5 space-y-1">
          {playerDashboardNavItems.map((item) => (
            <PlayerSidebarItem
              isActive={isPlayerDashboardItemActive(pathname, item)}
              item={item}
              key={item.href}
              onNavigate={onClose}
            />
          ))}
        </nav>

        <div className="flex-1" />

        <nav aria-label="Player dashboard support" className="border-t border-slate-100 pt-3">
          <PlayerSidebarItem
            isActive={isPlayerDashboardItemActive(pathname, playerDashboardUtilityItem)}
            item={playerDashboardUtilityItem}
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


