"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { OwnerDashboardIcon } from "@/components/owner/VenueOwnerSidebar";
import LoadingIndicator from "@/components/LoadingIndicator";
import { api } from "@/lib/api";
import { getApiErrorField, getApiErrorMessage } from "@/lib/apiErrors";
import { clearAuthSession, saveCurrentUser } from "@/lib/auth";
import { savePendingEmailVerification } from "@/lib/emailVerification";
import { emitToast } from "@/lib/toast";
import type { User } from "@/types/auth";

type SettingsSection = "account" | "security" | "notifications" | "operations";

type OwnerSettingsResponse = {
  account: {
    full_name: string;
    email: string;
    phone: string;
    role: string;
    email_verified: boolean;
    email_verified_at: string | null;
    pending_email: string;
    pending_email_requested_at: string | null;
    is_active: boolean;
  };
  notifications: OwnerNotificationSettings;
};

type OwnerNotificationSettings = {
  booking_updates: boolean;
  cancellation_refunds: boolean;
  email_notifications: boolean;
};

type AccountForm = {
  full_name: string;
  email: string;
  phone: string;
  current_password: string;
};

type PasswordForm = {
  current_password: string;
  new_password: string;
  confirm_password: string;
};

const sections: Array<{ id: SettingsSection; label: string }> = [
  { id: "account", label: "Account" },
  { id: "security", label: "Security" },
  { id: "notifications", label: "Notifications" },
  { id: "operations", label: "Venue Operations" },
];

const defaultNotifications: OwnerNotificationSettings = {
  booking_updates: true,
  cancellation_refunds: true,
  email_notifications: true,
};

const emptyPasswordForm: PasswordForm = {
  current_password: "",
  new_password: "",
  confirm_password: "",
};

export default function OwnerSettingsPage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <OwnerSettingsContent />
    </Suspense>
  );
}

function OwnerSettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sectionParam = searchParams.get("section") as SettingsSection | null;
  const activeSection = sections.some((section) => section.id === sectionParam) ? sectionParam! : "account";

  const [settings, setSettings] = useState<OwnerSettingsResponse | null>(null);
  const [accountForm, setAccountForm] = useState<AccountForm>({ full_name: "", email: "", phone: "", current_password: "" });
  const [passwordForm, setPasswordForm] = useState<PasswordForm>(emptyPasswordForm);
  const [notifications, setNotifications] = useState<OwnerNotificationSettings>(defaultNotifications);
  const [accountErrors, setAccountErrors] = useState<Record<string, string>>({});
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [isEditingAccount, setIsEditingAccount] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [savingSection, setSavingSection] = useState<SettingsSection | "">("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadSettings();
  }, []);

  const dirtySection = useMemo<SettingsSection | "">(() => {
    if (!settings) return "";
    if (
      accountForm.full_name !== settings.account.full_name ||
      accountForm.email !== settings.account.email ||
      accountForm.phone !== settings.account.phone ||
      accountForm.current_password
    ) return "account";
    if (JSON.stringify(notifications) !== JSON.stringify(settings.notifications)) return "notifications";
    if (passwordForm.current_password || passwordForm.new_password || passwordForm.confirm_password) return "security";
    return "";
  }, [accountForm, notifications, passwordForm, settings]);

  const isAccountEmailChanged = settings ? accountForm.email.trim().toLowerCase() !== settings.account.email.toLowerCase() : false;
  const accountHasChanges = settings
    ? accountForm.full_name !== settings.account.full_name || accountForm.email !== settings.account.email || accountForm.phone !== settings.account.phone
    : false;
  const canSaveAccount = accountHasChanges && Boolean(accountForm.full_name.trim()) && (!isAccountEmailChanged || Boolean(accountForm.current_password.trim()));

  async function loadSettings() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<OwnerSettingsResponse>("/api/auth/settings/owner/");
      hydrateSettings(response.data);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load your settings. Please try again."));
    } finally {
      setIsLoading(false);
    }
  }

  function hydrateSettings(nextSettings: OwnerSettingsResponse) {
    setSettings(nextSettings);
    setAccountForm({
      full_name: nextSettings.account.full_name,
      email: nextSettings.account.email,
      phone: nextSettings.account.phone || "",
      current_password: "",
    });
    setNotifications(nextSettings.notifications);
  }

  function resetUnsavedChanges() {
    if (settings) hydrateSettings(settings);
    setPasswordForm(emptyPasswordForm);
    setAccountErrors({});
    setPasswordErrors({});
    setIsEditingAccount(false);
  }

  function changeSection(nextSection: SettingsSection) {
    if (dirtySection && dirtySection !== nextSection) {
      const canLeave = window.confirm("You have unsaved changes in this section. Leave without saving?");
      if (!canLeave) return;
      resetUnsavedChanges();
    }
    router.push(`/dashboard/owner/settings?section=${nextSection}`);
  }

  function startAccountEdit() {
    setAccountErrors({});
    setIsEditingAccount(true);
  }

  function cancelAccountEdit() {
    if (settings) hydrateSettings(settings);
    setAccountErrors({});
    setIsEditingAccount(false);
  }

  async function saveAccount() {
    setSavingSection("account");
    setAccountErrors({});
    try {
      const response = await api.patch<{
        email_verification_required: boolean;
        masked_email: string;
        expires_in: number;
        resend_available_in: number;
        user: User;
      }>("/api/auth/settings/account/", accountForm);

      if (response.data.email_verification_required) {
        savePendingEmailVerification(
          accountForm.email,
          response.data.masked_email,
          response.data.expires_in || 600,
          response.data.resend_available_in || 60,
        );
        emitToast({ message: "Please verify your new email address.", type: "info", dedupeKey: "owner-settings-email-verification" });
        router.push("/verify-email");
        return;
      }

      saveCurrentUser(response.data.user);
      emitToast({ message: "Your account settings have been updated.", type: "success", dedupeKey: "owner-settings-account-saved" });
      await loadSettings();
      setIsEditingAccount(false);
    } catch (requestError) {
      setAccountErrors({
        full_name: getApiErrorField(requestError, "full_name") || "",
        email: getApiErrorField(requestError, "email") || "",
        phone: getApiErrorField(requestError, "phone") || "",
        current_password: getApiErrorField(requestError, "current_password") || "",
      });
      emitToast({ message: getApiErrorMessage(requestError, "We could not update your account settings. Please try again."), type: "error", dedupeKey: "owner-settings-account-error" });
    } finally {
      setSavingSection("");
    }
  }

  async function changePassword() {
    setSavingSection("security");
    setPasswordErrors({});
    try {
      await api.post("/api/auth/settings/password/", passwordForm);
      emitToast({ message: "Your password has been changed. Please sign in again.", type: "success", dedupeKey: "owner-settings-password-changed" });
      clearAuthSession();
      router.push("/login?password_changed=1");
    } catch (requestError) {
      setPasswordErrors({
        current_password: getApiErrorField(requestError, "current_password") || "",
        new_password: getApiErrorField(requestError, "new_password") || "",
        confirm_password: getApiErrorField(requestError, "confirm_password") || "",
      });
      emitToast({ message: getApiErrorMessage(requestError, "We could not change your password. Please try again."), type: "error", dedupeKey: "owner-settings-password-error" });
    } finally {
      setSavingSection("");
    }
  }

  async function saveNotifications() {
    setSavingSection("notifications");
    try {
      await api.patch("/api/auth/settings/owner/notifications/", notifications);
      emitToast({ message: "Your notification preferences have been saved.", type: "success", dedupeKey: "owner-settings-notifications-saved" });
      await loadSettings();
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not save your notification preferences. Please try again."), type: "error", dedupeKey: "owner-settings-notifications-error" });
    } finally {
      setSavingSection("");
    }
  }

  if (isLoading) return <SettingsSkeleton />;

  if (error || !settings) {
    return (
      <div className="owner-settings-page space-y-6">
        <OwnerPageHeader title="Settings" description="Manage your account access, alerts, and venue operations." />
        <section className="owner-settings-error" role="alert">
          <p>{error || "We could not load your settings."}</p>
          <button className="owner-primary-button mt-4" onClick={loadSettings} type="button">Retry</button>
        </section>
      </div>
    );
  }

  return (
    <div className="owner-settings-page space-y-6">
      <OwnerPageHeader
        description="Manage the account used to run your venue. Venue details, courts, pricing, and public visibility stay in their operational workspaces."
        eyebrow="Venue Manager"
        title="Settings"
      />

      <nav aria-label="Settings sections" className="sport-surface dashboard-settings-tabs owner-settings-tabs overflow-x-auto p-1">
        <div className="flex min-w-max gap-1">
          {sections.map((section) => {
            const active = activeSection === section.id;
            return (
              <button
                aria-current={active ? "page" : undefined}
                className={`min-h-11 rounded-md px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-green-200 ${active ? "bg-green-50 text-sportGreen" : "text-slate-600 hover:bg-slate-50 hover:text-sportNavy"}`}
                key={section.id}
                onClick={() => changeSection(section.id)}
                type="button"
              >
                {section.label}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="owner-settings-content">
        {dirtySection ? <div className="owner-settings-unsaved" role="status">You have unsaved changes in {dirtySection === "operations" ? "this section" : `${dirtySection} settings`}.</div> : null}

          {activeSection === "account" ? (
            <SettingsCard
              title="Account details"
              description="These details identify the owner account used for venue management and important contact messages."
              actions={!isEditingAccount ? <button className="owner-secondary-button" onClick={startAccountEdit} type="button">Edit account</button> : null}
            >
              {!isEditingAccount ? (
                <div className="owner-settings-field-grid">
                  <ReadOnlyField label="Full name" value={settings.account.full_name || "Not added yet"} />
                  <ReadOnlyField label="Account type" value="Venue owner" />
                  <ReadOnlyField label="Email address" value={settings.account.email} />
                  <ReadOnlyField label="Phone number" value={settings.account.phone || "Not added yet"} />
                </div>
              ) : (
                <>
                  <div className="owner-settings-field-grid">
                    <TextField error={accountErrors.full_name} label="Full name" onChange={(value) => setAccountForm((current) => ({ ...current, full_name: value }))} value={accountForm.full_name} />
                    <ReadOnlyField label="Account type" value="Venue owner" />
                    <TextField error={accountErrors.email} label="Email address" onChange={(value) => setAccountForm((current) => ({ ...current, email: value }))} type="email" value={accountForm.email} />
                    <TextField error={accountErrors.phone} label="Phone number" onChange={(value) => setAccountForm((current) => ({ ...current, phone: value }))} value={accountForm.phone} />
                  </div>
                  {isAccountEmailChanged ? (
                    <div className="owner-settings-attention">
                      <PasswordField error={accountErrors.current_password} label="Current password" onChange={(value) => setAccountForm((current) => ({ ...current, current_password: value }))} show={showPasswords} value={accountForm.current_password} />
                      <p>Changing your email sends a verification code. Your current email stays active until the new address is verified.</p>
                    </div>
                  ) : null}
                </>
              )}
              {settings.account.pending_email ? (
                <StatusNote tone="warning">Verification is pending for {settings.account.pending_email}. Your current email remains active until verification is complete.</StatusNote>
              ) : (
                <StatusNote tone={settings.account.email_verified ? "success" : "warning"}>
                  {settings.account.email_verified ? "Your email address is verified." : "Email verification is pending. Verify it before using protected account actions."}
                </StatusNote>
              )}
              {isEditingAccount ? (
                <SectionActions>
                  <button className="owner-secondary-button" onClick={cancelAccountEdit} type="button">Cancel</button>
                  <button className="owner-primary-button" disabled={!canSaveAccount || savingSection === "account"} onClick={saveAccount} type="button">{savingSection === "account" ? <LoadingIndicator label="Saving changes" size="sm" tone="inverse" /> : "Save changes"}</button>
                </SectionActions>
              ) : null}
            </SettingsCard>
          ) : null}

          {activeSection === "security" ? (
            <SettingsCard title="Security" description="Change your password with your current password. You will be signed out after a successful change so every session is protected.">
              <div className="owner-settings-password-grid">
                <PasswordField error={passwordErrors.current_password} label="Current password" onChange={(value) => setPasswordForm((current) => ({ ...current, current_password: value }))} show={showPasswords} value={passwordForm.current_password} />
                <PasswordField error={passwordErrors.new_password} label="New password" onChange={(value) => setPasswordForm((current) => ({ ...current, new_password: value }))} show={showPasswords} value={passwordForm.new_password} />
                <PasswordField error={passwordErrors.confirm_password} label="Confirm new password" onChange={(value) => setPasswordForm((current) => ({ ...current, confirm_password: value }))} show={showPasswords} value={passwordForm.confirm_password} />
              </div>
              <button className="owner-settings-text-button" onClick={() => setShowPasswords((current) => !current)} type="button">{showPasswords ? "Hide passwords" : "Show passwords"}</button>
              <PasswordRequirements password={passwordForm.new_password} confirmPassword={passwordForm.confirm_password} />
              <SectionActions>
                <button className="owner-secondary-button" disabled={dirtySection !== "security" || savingSection === "security"} onClick={() => { setPasswordForm(emptyPasswordForm); setPasswordErrors({}); }} type="button">Clear</button>
                <button className="owner-primary-button" disabled={savingSection === "security" || !passwordForm.current_password || !passwordForm.new_password || !passwordForm.confirm_password} onClick={changePassword} type="button">{savingSection === "security" ? <LoadingIndicator label="Changing password" size="sm" tone="inverse" /> : "Change password"}</button>
              </SectionActions>
            </SettingsCard>
          ) : null}

          {activeSection === "notifications" ? (
            <SettingsCard title="Notifications" description="Choose which owner alerts are delivered to your SportSpot Notification Centre and email address.">
              <div className="owner-settings-switch-list">
                <SwitchRow checked={notifications.booking_updates} description="New reservations, payment results, reminders, check-ins, and venue messages." label="Booking activity" onChange={(value) => setNotifications((current) => ({ ...current, booking_updates: value }))} />
                <SwitchRow checked={notifications.cancellation_refunds} description="Player cancellations, refund requests, and refund-status changes that need your attention." label="Cancellations and refunds" onChange={(value) => setNotifications((current) => ({ ...current, cancellation_refunds: value }))} />
                <SwitchRow checked={notifications.email_notifications} description="Important account and operational messages when email delivery is supported." label="Email notifications" onChange={(value) => setNotifications((current) => ({ ...current, email_notifications: value }))} />
              </div>
              <SectionActions>
                <button className="owner-secondary-button" disabled={dirtySection !== "notifications" || savingSection === "notifications"} onClick={() => setNotifications(settings.notifications)} type="button">Cancel</button>
                <button className="owner-primary-button" disabled={savingSection === "notifications"} onClick={saveNotifications} type="button">{savingSection === "notifications" ? <LoadingIndicator label="Saving preferences" size="sm" tone="inverse" /> : "Save preferences"}</button>
              </SectionActions>
            </SettingsCard>
          ) : null}

        {activeSection === "operations" ? <OperationsSection /> : null}
      </div>
    </div>
  );
}

function OperationsSection() {
  return (
    <SettingsCard title="Venue operations" description="These settings affect what players can book and see. Each link opens the focused workspace responsible for that decision.">
      <div className="owner-settings-operation-list">
        <OperationLink href="/dashboard/owner/venue" icon="venue" title="Venue profile and visibility" description="Update venue details, photos, proof, location, status, and the public profile." />
        <OperationLink href="/dashboard/owner/courts" icon="courts" title="Courts, slots, and pricing" description="Manage physical courts, slot generation, prices, and court availability." />
        <OperationLink href="/dashboard/owner/calendar" icon="calendar" title="Calendar and blocked time" description="Review bookings and block maintenance or private-use periods." />
        <OperationLink href="/dashboard/owner/refunds" icon="payments" title="Payments and refunds" description="Review refund requests and record processed refund outcomes." />
        <OperationLink href="/dashboard/owner/reports" icon="reports" title="Reports" description="Review booking activity, paid value, check-ins, refunds, and utilisation." />
      </div>
      <div className="owner-settings-operation-note">
        <strong>Why these are separate</strong>
        <p>Operational changes can affect player availability, bookings, and refund decisions. Keeping them in dedicated workspaces makes each action easier to understand and audit.</p>
      </div>
    </SettingsCard>
  );
}

function OperationLink({ description, href, icon, title }: { description: string; href: string; icon: "venue" | "courts" | "calendar" | "payments" | "reports"; title: string }) {
  return (
    <Link className="owner-settings-operation-link" href={href}>
      <span className="owner-settings-operation-icon" aria-hidden="true"><OwnerDashboardIcon name={icon} /></span>
      <span className="min-w-0"><strong>{title}</strong><small>{description}</small></span>
      <span className="owner-settings-operation-arrow" aria-hidden="true">&rarr;</span>
    </Link>
  );
}

function SettingsCard({ actions, children, description, title }: { actions?: ReactNode; children: ReactNode; description: string; title: string }) {
  return (
    <section className="owner-settings-card">
      <div className="owner-settings-card-header">
        <div><h2>{title}</h2><p>{description}</p></div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function TextField({ error, label, onChange, type = "text", value }: { error?: string; label: string; onChange: (value: string) => void; type?: string; value: string }) {
  return <label className="owner-settings-field"><span>{label}</span><input className={error ? "has-error" : ""} onChange={(event) => onChange(event.target.value)} type={type} value={value} />{error ? <small className="owner-settings-error-text">{error}</small> : null}</label>;
}

function PasswordField({ error, label, onChange, show, value }: { error?: string; label: string; onChange: (value: string) => void; show: boolean; value: string }) {
  return <TextField error={error} label={label} onChange={onChange} type={show ? "text" : "password"} value={value} />;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <div className="owner-settings-field"><span>{label}</span><div className="owner-settings-readonly">{value}</div></div>;
}

function SwitchRow({ checked, description, label, onChange }: { checked: boolean; description: string; label: string; onChange: (checked: boolean) => void }) {
  return (
    <div className="owner-settings-switch-row">
      <div><strong>{label}</strong><p>{description}</p></div>
      <button aria-checked={checked} aria-label={`${label}: ${checked ? "on" : "off"}`} className={`owner-settings-switch ${checked ? "is-on" : ""}`} onClick={() => onChange(!checked)} role="switch" type="button"><span /></button>
    </div>
  );
}

function StatusNote({ children, tone }: { children: ReactNode; tone: "success" | "warning" }) {
  return <div className={`owner-settings-status-note ${tone}`}>{children}</div>;
}

function SectionActions({ children }: { children: ReactNode }) {
  return <div className="owner-settings-actions">{children}</div>;
}

function PasswordRequirements({ confirmPassword, password }: { confirmPassword: string; password: string }) {
  const requirements = [
    { label: "At least 8 characters", met: password.length >= 8 },
    { label: "One letter", met: /[A-Za-z]/.test(password) },
    { label: "One number", met: /\d/.test(password) },
    { label: "Passwords match", met: Boolean(confirmPassword) && password === confirmPassword },
  ];
  return <div className="owner-settings-password-requirements"><strong>Password must include</strong><div>{requirements.map((item) => <span key={item.label} className={item.met ? "met" : ""}><b>{item.met ? "OK" : "-"}</b>{item.label}</span>)}</div></div>;
}

function SettingsSkeleton() {
  return <div className="owner-settings-skeleton space-y-6" aria-label="Loading settings"><div className="h-24 animate-pulse rounded-lg bg-white" /><div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]"><div className="h-80 animate-pulse rounded-lg bg-white" /><div className="h-96 animate-pulse rounded-lg bg-white" /></div></div>;
}
