"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { AdminListHeader, AdminPageHeader, AdminPanel, AdminPaginationControls, AdminStatusPill, formatCompactDate, getAdminStatusTone } from "@/components/admin-dashboard/AdminUi";
import { AdminLoadingScreen } from "@/components/admin-dashboard/AdminDashboardLayout";
import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { AdminPagination, AdminUser } from "@/types/admin";

const inputClass = "min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-sportNavy outline-none transition focus:border-sportGreen focus:ring-2 focus:ring-green-100";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [pagination, setPagination] = useState<AdminPagination | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [role, setRole] = useState("ALL");
  const [accountStatus, setAccountStatus] = useState("ALL");
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), page_size: "25" });
    if (appliedSearch) params.set("q", appliedSearch);
    if (role !== "ALL") params.set("role", role);
    if (accountStatus !== "ALL") params.set("status", accountStatus);
    try {
      const response = await api.get<{ users: AdminUser[]; pagination: AdminPagination }>(`/api/admin/users/?${params.toString()}`);
      setUsers(response.data.users);
      setPagination(response.data.pagination);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load user accounts."));
    } finally {
      setIsLoading(false);
    }
  }, [accountStatus, appliedSearch, page, role]);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  useEffect(() => {
    if (!isLoading && !error && page > 1 && !users.length && (pagination?.total || 0) > 0) setPage((current) => Math.max(current - 1, 1));
  }, [error, isLoading, page, pagination?.total, users.length]);

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
  }

  async function changeStatus(user: AdminUser) {
    setBusyId(user.id);
    setError("");
    setNotice("");
    try {
      const response = await api.post<{ user: AdminUser }>(`/api/admin/users/${user.id}/status/`, { is_active: !user.is_active });
      await loadUsers();
      setNotice(`${user.full_name} is now ${response.data.user.is_active ? "active" : "suspended"}.`);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not update this account."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <FeedbackToast message={error || notice} onClose={() => { setError(""); setNotice(""); }} type={error ? "error" : "success"} />
      <AdminPageHeader description="Search accounts, understand their role in the marketplace, and control access without changing their historical bookings or records." eyebrow="People & access" title="Users" />

      <AdminPanel className="overflow-visible">
        <form className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:p-5" onSubmit={applySearch}>
          <label className="min-w-0"><span className="sr-only">Search users</span><input className={`w-full ${inputClass}`} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, or phone" value={search} /></label>
          <select aria-label="Filter by role" className={inputClass} onChange={(event) => { setPage(1); setRole(event.target.value); }} value={role}><option value="ALL">All roles</option><option value="PLAYER">Players</option><option value="COURT_OWNER">Venue owners</option><option value="ADMIN">Administrators</option></select>
          <select aria-label="Filter by account status" className={inputClass} onChange={(event) => { setPage(1); setAccountStatus(event.target.value); }} value={accountStatus}><option value="ALL">All account states</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></select>
          <button className="min-h-11 rounded-lg bg-sportGreen px-4 text-sm font-black text-white transition hover:bg-green-700" type="submit">Search</button>
        </form>
      </AdminPanel>

      <AdminListHeader action={<button className="admin-refresh-button" onClick={() => void loadUsers()} type="button"><RefreshIcon /> Refresh</button>} description="Every account, role, activity signal, and access decision in one place." eyebrow="Account directory" title="User accounts" total={pagination ? `${pagination.total.toLocaleString()} account${pagination.total === 1 ? "" : "s"}` : "Loading..."} />

      {isLoading ? <AdminLoadingScreen label="Loading user directory" /> : null}
      {!isLoading && !error && !users.length ? <AdminPanel><div className="admin-empty-state"><span className="admin-empty-icon" aria-hidden="true">✓</span><h2>No matching accounts</h2><p>Try a different name, email, role, or account state.</p></div></AdminPanel> : null}
      {!isLoading && !error && users.length ? <AdminPanel className="overflow-hidden"><div className="admin-table-scroll"><table className="admin-data-table admin-users-table"><colgroup><col className="admin-users-account" /><col className="admin-users-role" /><col className="admin-users-joined" /><col className="admin-users-activity" /><col className="admin-users-access" /><col className="admin-users-action" /></colgroup><thead><tr><th>Account</th><th>Role</th><th>Joined</th><th>Activity</th><th>Access</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td data-label="Account"><div className="flex min-w-0 items-center gap-3 text-left"><span className="admin-avatar">{user.full_name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span className="min-w-0"><strong className="block truncate text-sm font-black text-sportNavy">{user.full_name}</strong><span className="admin-secondary-text">{user.email}</span></span></div></td><td data-label="Role"><AdminStatusPill value={user.role} tone={user.role === "ADMIN" ? "info" : user.role === "COURT_OWNER" ? "success" : "neutral"} /></td><td data-label="Joined"><span className="text-sm font-semibold text-slate-600">{formatCompactDate(user.date_joined)}</span></td><td data-label="Activity"><span className="text-sm font-bold text-slate-700">{user.booking_count} booking{user.booking_count === 1 ? "" : "s"}<span className="mx-1 text-slate-300">·</span>{user.team_count} team{user.team_count === 1 ? "" : "s"}</span></td><td data-label="Access"><span className="flex flex-col items-end gap-1 sm:items-start"><AdminStatusPill value={user.is_active ? "ACTIVE" : "SUSPENDED"} tone={getAdminStatusTone(user.is_active ? "ACTIVE" : "SUSPENDED")} />{!user.email_verified ? <span className="text-[11px] font-bold text-amber-700">Email unverified</span> : null}</span></td><td data-label="Action"><button className={`admin-row-action ${user.is_active ? "admin-row-action-danger" : "admin-row-action-success"}`} disabled={busyId === user.id} onClick={() => void changeStatus(user)} type="button">{busyId === user.id ? "Saving..." : user.is_active ? "Suspend" : "Reactivate"}</button></td></tr>)}</tbody></table></div><AdminPaginationControls hasMore={pagination?.has_more || false} isLoading={isLoading} onNext={() => setPage((current) => current + 1)} onPrevious={() => setPage((current) => Math.max(current - 1, 1))} page={page} pageSize={pagination?.page_size || 25} total={pagination?.total || 0} /></AdminPanel> : null}
      <p className="text-xs font-semibold leading-5 text-slate-500">Suspending an account blocks future sessions and refresh tokens. Existing records remain available for audit and reporting.</p>
    </div>
  );
}

function RefreshIcon() { return <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.8-4L4 9m0 0V4m0 5h5M4 13a8 8 0 0 0 14.8 4L20 15m0 0v5m0-5h-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>; }
