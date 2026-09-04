"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AdminListHeader, AdminPageHeader, AdminPanel, AdminPaginationControls, AdminStatusPill, formatAdminValue, formatCompactDate, getAdminStatusTone } from "@/components/admin-dashboard/AdminUi";
import { AdminLoadingScreen } from "@/components/admin-dashboard/AdminDashboardLayout";
import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { AdminBooking, AdminPagination } from "@/types/admin";

const inputClass = "min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-sportNavy outline-none transition focus:border-sportGreen focus:ring-2 focus:ring-green-100";

export default function AdminBookingsPage() {
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [pagination, setPagination] = useState<AdminPagination | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ query: "", status: "ALL", payment: "ALL", refund: "ALL" });
  const [cancelTarget, setCancelTarget] = useState<AdminBooking | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const refund = params.get("refund_status") || "ALL";
    const bookingStatus = params.get("status") || "ALL";
    setFilters((current) => ({ ...current, refund, status: bookingStatus }));
  }, []);

  const loadBookings = useCallback(async () => {
    setIsLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), page_size: "25" });
    if (filters.query) params.set("q", filters.query);
    if (filters.status !== "ALL") params.set("status", filters.status);
    if (filters.payment !== "ALL") params.set("payment_status", filters.payment);
    if (filters.refund !== "ALL") params.set("refund_status", filters.refund);
    try {
      const response = await api.get<{ bookings: AdminBooking[]; pagination: AdminPagination }>(`/api/admin/bookings/?${params.toString()}`);
      setBookings(response.data.bookings);
      setPagination(response.data.pagination);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load marketplace bookings."));
    } finally {
      setIsLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { void loadBookings(); }, [loadBookings]);

  useEffect(() => {
    if (!isLoading && !error && page > 1 && !bookings.length && (pagination?.total || 0) > 0) setPage((current) => Math.max(current - 1, 1));
  }, [bookings.length, error, isLoading, page, pagination?.total]);

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setFilters((current) => ({ ...current, query: search.trim() }));
  }

  function updateFilter(key: "status" | "payment" | "refund", value: string) {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="space-y-6">
      <FeedbackToast message={error || notice} onClose={() => { setError(""); setNotice(""); }} type={error ? "error" : "success"} />
      <AdminPageHeader description="Monitor reservations, payment state, refunds, check-ins, and booking handoffs from one operational queue." eyebrow="Marketplace operations" title="Bookings & payments" />
      <AdminPanel className="overflow-visible">
        <form className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] sm:p-5" onSubmit={applySearch}><label className="min-w-0"><span className="sr-only">Search bookings</span><input className={`w-full ${inputClass}`} onChange={(event) => setSearch(event.target.value)} placeholder="Search booking code, player, or venue" value={search} /></label><select aria-label="Filter booking status" className={inputClass} onChange={(event) => updateFilter("status", event.target.value)} value={filters.status}><option value="ALL">All bookings</option>{["RESERVED", "CONFIRMED", "COMPLETED", "CANCELLED", "EXPIRED"].map((item) => <option key={item} value={item}>{formatAdminValue(item)}</option>)}</select><select aria-label="Filter payment status" className={inputClass} onChange={(event) => updateFilter("payment", event.target.value)} value={filters.payment}><option value="ALL">All payments</option>{["PENDING", "PAID", "REFUND_PENDING", "REFUNDED", "PARTIALLY_REFUNDED", "NO_REFUND", "FAILED"].map((item) => <option key={item} value={item}>{formatAdminValue(item)}</option>)}</select><select aria-label="Filter refund status" className={inputClass} onChange={(event) => updateFilter("refund", event.target.value)} value={filters.refund}><option value="ALL">All refunds</option>{["PENDING_OWNER_ACTION", "REFUNDED", "PARTIALLY_REFUNDED", "REJECTED", "NOT_ELIGIBLE"].map((item) => <option key={item} value={item}>{formatAdminValue(item)}</option>)}</select><button className="min-h-11 rounded-lg bg-sportGreen px-4 text-sm font-black text-white hover:bg-green-700" type="submit">Search</button></form>
      </AdminPanel>
      <AdminListHeader action={<button className="admin-refresh-button" onClick={() => void loadBookings()} type="button"><RefreshIcon /> Refresh</button>} description="Follow every reservation from schedule to payment, check-in, and exception handling." eyebrow="Booking ledger" title="Marketplace bookings" total={pagination ? `${pagination.total.toLocaleString()} booking${pagination.total === 1 ? "" : "s"}` : "Loading..."} />
      {isLoading ? <AdminLoadingScreen label="Loading booking ledger" /> : null}
      {!isLoading && !error && !bookings.length ? <AdminPanel><div className="admin-empty-state"><span className="admin-empty-icon" aria-hidden="true">✓</span><h2>No matching bookings</h2><p>Try clearing a filter or searching for a different booking.</p></div></AdminPanel> : null}
      {!isLoading && !error && bookings.length ? <AdminPanel className="overflow-hidden"><div className="admin-table-scroll"><table className="admin-data-table admin-bookings-table"><colgroup><col className="admin-bookings-id" /><col className="admin-bookings-schedule" /><col className="admin-bookings-customer" /><col className="admin-bookings-payment" /><col className="admin-bookings-state" /><col className="admin-bookings-action" /></colgroup><thead><tr><th>Booking</th><th>Schedule</th><th>Customer</th><th>Payment</th><th>Booking state</th><th>Actions</th></tr></thead><tbody>{bookings.map((booking) => <tr key={booking.id}><td data-label="Booking"><div className="min-w-0 text-left"><strong className="admin-primary-text">{booking.booking_code}</strong><span className="admin-secondary-text">{booking.venue.name} <span className="text-slate-300">·</span> {booking.court.name}</span></div></td><td data-label="Schedule"><div className="text-left"><strong className="admin-primary-text">{formatCompactDate(booking.slot_date)}</strong><span className="admin-secondary-text">{formatTime(booking.slot_start_time)} - {formatTime(booking.slot_end_time)}</span></div></td><td data-label="Customer"><div className="min-w-0 text-left"><strong className="admin-primary-text">{booking.player.name}</strong><span className="admin-secondary-text">{booking.player.email}</span></div></td><td data-label="Payment"><div className="flex flex-col items-end gap-1 sm:items-start"><strong className="admin-amount">NPR {Number(booking.amount).toLocaleString("en-NP")}</strong><AdminStatusPill value={booking.payment_status} tone={getAdminStatusTone(booking.payment_status)} />{booking.refund_status !== "NOT_REQUIRED" ? <span className="admin-row-note">{formatAdminValue(booking.refund_status)}</span> : null}</div></td><td data-label="Booking state"><div className="flex flex-col items-end gap-1 sm:items-start"><AdminStatusPill value={booking.status} tone={getAdminStatusTone(booking.status)} /><span className="admin-row-note">{booking.check_in ? "Checked in" : "Not checked in"}</span></div></td><td data-label="Actions">{["RESERVED", "CONFIRMED"].includes(booking.status) ? <button className="admin-row-action admin-row-action-danger" onClick={() => setCancelTarget(booking)} type="button">Cancel</button> : <span className="admin-no-action">—</span>}</td></tr>)}</tbody></table></div><AdminPaginationControls hasMore={pagination?.has_more || false} isLoading={isLoading} onNext={() => setPage((current) => current + 1)} onPageChange={setPage} onPrevious={() => setPage((current) => Math.max(current - 1, 1))} page={page} pageSize={pagination?.page_size || 25} total={pagination?.total || 0} /></AdminPanel> : null}
      <p className="text-xs font-semibold leading-5 text-slate-500">Admin cancellation is reserved for exceptional cases. The selected refund outcome and slot action are recorded by the existing booking lifecycle.</p>
      {cancelTarget ? <CancelBookingDialog booking={cancelTarget} onClose={() => setCancelTarget(null)} onSaved={() => { setCancelTarget(null); setNotice(`Booking ${cancelTarget.booking_code} was cancelled.`); void loadBookings(); }} onError={setError} /> : null}
    </div>
  );
}

function CancelBookingDialog({ booking, onClose, onSaved, onError }: { booking: AdminBooking; onClose: () => void; onSaved: () => void; onError: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const [paymentStatus, setPaymentStatus] = useState(booking.payment_status === "PAID" ? "REFUND_PENDING" : "FAILED");
  const [slotAction, setSlotAction] = useState("AVAILABLE");
  const [isSaving, setIsSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) return;
    setIsSaving(true);
    onError("");
    try {
      await api.post(`/api/venues/bookings/${booking.id}/cancel/`, { reason: reason.trim(), payment_status: paymentStatus, slot_action: slotAction });
      onSaved();
    } catch (requestError) {
      onError(getApiErrorMessage(requestError, "Could not cancel this booking."));
    } finally {
      setIsSaving(false);
    }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-sportNavy/40 p-4" role="dialog" aria-modal="true" aria-labelledby="admin-cancel-heading"><form className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6" onSubmit={submit}><div className="flex items-start justify-between gap-4"><div><p className="sport-eyebrow">Exceptional action</p><h2 className="mt-1 text-xl font-black text-sportNavy" id="admin-cancel-heading">Cancel {booking.booking_code}?</h2><p className="mt-1 text-sm font-semibold text-slate-600">{booking.player.name} · {booking.venue.name} · NPR {Number(booking.amount).toLocaleString("en-NP")}</p></div><button aria-label="Close cancellation dialog" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-lg text-slate-500 hover:text-sportNavy" onClick={onClose} type="button">×</button></div><label className="mt-5 block"><span className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">Reason <span className="text-red-600">*</span></span><textarea className="mt-2 min-h-24 w-full resize-y rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold text-sportNavy outline-none focus:border-sportGreen focus:ring-2 focus:ring-green-100" onChange={(event) => setReason(event.target.value)} placeholder="Explain why this booking must be cancelled" required value={reason} /></label><div className="mt-4 grid gap-3 sm:grid-cols-2"><label><span className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">Payment outcome</span><select className={`mt-2 w-full ${inputClass}`} onChange={(event) => setPaymentStatus(event.target.value)} value={paymentStatus}><option value="REFUND_PENDING">Send refund to owner</option><option value="REFUNDED">Mark refunded</option><option value="NO_REFUND">No refund</option><option value="FAILED">Payment not completed</option></select></label><label><span className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">Slot after cancellation</span><select className={`mt-2 w-full ${inputClass}`} onChange={(event) => setSlotAction(event.target.value)} value={slotAction}><option value="AVAILABLE">Release slot</option><option value="BLOCK">Keep slot blocked</option></select></label></div><div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button className="min-h-11 rounded-lg border border-slate-200 px-4 text-sm font-black text-sportNavy hover:bg-slate-50" onClick={onClose} type="button">Keep booking</button><button className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-black text-white hover:bg-red-700 disabled:opacity-50" disabled={isSaving || !reason.trim()} type="submit">{isSaving ? "Cancelling..." : "Confirm cancellation"}</button></div></form></div>;
}

function formatTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;
  const period = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, "0")} ${period}`;
}

function RefreshIcon() { return <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.8-4L4 9m0 0V4m0 5h5M4 13a8 8 0 0 0 14.8 4L20 15m0 0v5m0-5h-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>; }
