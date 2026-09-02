"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import RoleGate from "@/components/RoleGate";
import { LoadingScreen } from "@/components/LoadingIndicator";
import {
  adminDashboardNavItems,
  adminDashboardSettingsItem,
  adminDashboardUtilityItem,
  getActiveAdminDashboardItem,
  isAdminDashboardItemActive,
  type AdminDashboardNavItem,
} from "@/components/admin-dashboard/navigation";

export default function AdminDashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const activeItem = getActiveAdminDashboardItem(pathname);

  return (
    <RoleGate allowedRoles={["ADMIN"]}>
      <div className="sport-page-shell admin-dashboard-theme">
        <div className="border-b border-slate-200/80 bg-white px-4 py-3 lg:hidden">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-sportGreen">SportSpot Admin</p>
              <div className="mt-1 flex min-w-0 items-center gap-2 text-sm font-black text-sportNavy">
                <span className="shrink-0 text-sportGreen"><AdminIcon name={activeItem.icon} /></span>
                <span className="truncate">{activeItem.label}</span>
              </div>
            </div>
            <button
              aria-controls="admin-dashboard-mobile-menu"
              aria-expanded={isDrawerOpen}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-sportNavy shadow-sm outline-none transition hover:border-green-200 hover:text-sportGreen focus-visible:ring-2 focus-visible:ring-sportGreen"
              onClick={() => setIsDrawerOpen(true)}
              type="button"
            >
              <MenuIcon />
              Menu
            </button>
          </div>
        </div>

        <div className="flex min-w-0">
          <AdminSidebar pathname={pathname} />
          <main className="admin-dashboard-main min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>

        {isDrawerOpen ? <AdminMobileDrawer pathname={pathname} onClose={() => setIsDrawerOpen(false)} /> : null}
      </div>
    </RoleGate>
  );
}

function AdminSidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="hidden w-[248px] shrink-0 border-r border-slate-200/80 bg-white lg:block">
      <div className="sticky top-[64px] flex h-[calc(100vh-64px)] flex-col px-3 py-5">
        <div className="border-b border-slate-100 px-3 pb-5">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-sportGreen">SportSpot</p>
          <p className="mt-1 text-sm font-black text-sportNavy">Admin control center</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">Trust, safety, and marketplace operations.</p>
        </div>
        <nav aria-label="Admin dashboard" className="mt-5 space-y-1.5">
          {adminDashboardNavItems.map((item) => <AdminSidebarItem isActive={isAdminDashboardItemActive(pathname, item)} item={item} key={item.href} />)}
        </nav>
        <div className="flex-1" />
        <nav aria-label="Admin dashboard utilities" className="space-y-1.5 border-t border-slate-100 pt-4">
          <AdminSidebarItem isActive={isAdminDashboardItemActive(pathname, adminDashboardSettingsItem)} item={adminDashboardSettingsItem} />
          <AdminSidebarItem isActive={isAdminDashboardItemActive(pathname, adminDashboardUtilityItem)} item={adminDashboardUtilityItem} />
        </nav>
      </div>
    </aside>
  );
}

function AdminSidebarItem({ isActive, item, onNavigate }: { isActive: boolean; item: AdminDashboardNavItem; onNavigate?: () => void }) {
  return (
    <Link
      aria-current={isActive ? "page" : undefined}
      className={`group relative flex min-h-12 items-center gap-3 rounded-lg px-3 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sportGreen focus-visible:ring-offset-2 ${isActive ? "bg-green-50 text-green-800" : "text-slate-600 hover:bg-slate-50 hover:text-sportNavy"}`}
      href={item.href}
      onClick={onNavigate}
    >
      {isActive ? <span aria-hidden="true" className="absolute left-0 top-3 h-6 w-1 rounded-r-full bg-sportGreen" /> : null}
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${isActive ? "bg-white text-sportGreen" : "bg-slate-50 text-slate-400 group-hover:text-sportGreen"}`}><AdminIcon name={item.icon} /></span>
      <span className="min-w-0"><span className="block truncate text-sm font-black">{item.label}</span><span className={`mt-0.5 block truncate text-[11px] ${isActive ? "text-green-700" : "text-slate-400"}`}>{item.description}</span></span>
    </Link>
  );
}

function AdminMobileDrawer({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin dashboard menu">
      <button aria-label="Close admin menu" className="absolute inset-0 bg-sportNavy/35" onClick={onClose} type="button" />
      <aside className="relative flex h-full w-[min(20rem,88vw)] flex-col bg-white px-4 py-5 shadow-2xl" id="admin-dashboard-mobile-menu">
        <div className="flex items-start justify-between border-b border-slate-100 px-2 pb-5">
          <div><p className="text-[11px] font-black uppercase tracking-[0.14em] text-sportGreen">SportSpot</p><p className="mt-1 text-base font-black text-sportNavy">Admin control center</p></div>
          <button aria-label="Close admin menu" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-sportNavy" onClick={onClose} type="button"><CloseIcon /></button>
        </div>
        <nav className="mt-5 space-y-1.5">{adminDashboardNavItems.map((item) => <AdminSidebarItem isActive={isAdminDashboardItemActive(pathname, item)} item={item} key={item.href} onNavigate={onClose} />)}</nav>
        <div className="flex-1" />
        <nav aria-label="Admin dashboard utilities" className="mt-5 space-y-1.5 border-t border-slate-100 pt-4"><AdminSidebarItem isActive={isAdminDashboardItemActive(pathname, adminDashboardSettingsItem)} item={adminDashboardSettingsItem} onNavigate={onClose} /><AdminSidebarItem isActive={isAdminDashboardItemActive(pathname, adminDashboardUtilityItem)} item={adminDashboardUtilityItem} onNavigate={onClose} /></nav>
      </aside>
    </div>
  );
}

export function AdminLoadingScreen({ label = "Loading admin workspace" }: { label?: string }) {
  return <LoadingScreen label={label} />;
}

function AdminIcon({ name }: { name: AdminDashboardNavItem["icon"] }) {
  const common = { "aria-hidden": true, className: "h-5 w-5", fill: "none", viewBox: "0 0 24 24" } as const;
  if (name === "overview") return <svg {...common}><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9.5Zm4 1.5h.01M12 12h.01M16 12h.01" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
  if (name === "venues") return <svg {...common}><path d="M4 21V7l8-4 8 4v14M9 21v-6h6v6M8 9h.01M12 9h.01M16 9h.01" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
  if (name === "users") return <svg {...common}><path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 2a5 5 0 0 1 5 5M3 20a5 5 0 0 1 10 0" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
  if (name === "bookings") return <svg {...common}><path d="M7 3v3m10-3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm3 8h3m-3 4h6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
  if (name === "moderation") return <svg {...common}><path d="m12 3 7 3v5c0 4.5-2.8 8-7 10-4.2-2-7-5.5-7-10V6l7-3Zm-3 8 2 2 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
  if (name === "reliability") return <svg {...common}><path d="M12 3a9 9 0 1 0 9 9M12 7v5l3 2m3.5-8.5 1.5-1.5m-5-1.5V1" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
  if (name === "operations") return <svg {...common}><path d="M4 19h16M6 16V8m6 8V5m6 11v-4M4 4h16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
  if (name === "settings") return <svg {...common}><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2m0 13v2M4.93 4.93l1.42 1.42m9.3 9.3 1.42 1.42M3 12h2m14 0h2M4.93 19.07l1.42-1.42m9.3-9.3 1.42-1.42" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
  return <svg {...common}><path d="M4 5h16v11H4zM8 21h8M12 16v5M8 9h8M8 12h5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
}

function MenuIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></svg>; }
function CloseIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></svg>; }
