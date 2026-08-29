"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { DashboardPageHeader } from "@/components/player-dashboard/DashboardPageHeader";
import { api } from "@/lib/api";
import { getApiErrorField, getApiErrorMessage } from "@/lib/apiErrors";
import { clearAuthSession, saveCurrentUser } from "@/lib/auth";
import { savePendingEmailVerification } from "@/lib/emailVerification";
import { emitToast } from "@/lib/toast";
import type { User } from "@/types/auth";

type SettingsSection = "account" | "security" | "notifications" | "privacy" | "management";

type PlayerSettingsResponse = {
  account: {
    full_name: string;
    email: string;
    phone: string;
    role: string;
    email_verified: boolean;
    email_verified_at: string | null;
    pending_email: string;
    pending_email_requested_at: string | null;
    sportspot_id: string;
    is_active: boolean;
  };
  notifications: NotificationSettings;
  privacy: PrivacySettings;
};

type NotificationSettings = {
  team_invitations: boolean;
  join_requests: boolean;
  team_challenges: boolean;
  game_updates: boolean;
  booking_updates: boolean;
  cancellation_refunds: boolean;
  rating_reminders: boolean;
  email_notifications: boolean;
};

type PrivacySettings = {
  public_profile_visible: boolean;
  location_visible: boolean;
  reliability_visible: boolean;
  rating_visible: boolean;
  allow_team_invitations: boolean;
  allow_team_challenges: boolean;
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
  { id: "privacy", label: "Privacy" },
  { id: "management", label: "Account Management" },
];

const defaultNotifications: NotificationSettings = {
  team_invitations: true,
  join_requests: true,
  team_challenges: true,
  game_updates: true,
  booking_updates: true,
  cancellation_refunds: true,
  rating_reminders: true,
  email_notifications: true,
};

const defaultPrivacy: PrivacySettings = {
  public_profile_visible: true,
  location_visible: true,
  reliability_visible: true,
  rating_visible: true,
  allow_team_invitations: true,
  allow_team_challenges: true,
};

const emptyPasswordForm: PasswordForm = {
  current_password: "",
  new_password: "",
  confirm_password: "",
};

export default function PlayerSettingsPage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <PlayerSettingsContent />
    </Suspense>
  );
}

function PlayerSettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sectionParam = searchParams.get("section") as SettingsSection | null;
  const activeSection = sections.some((section) => section.id === sectionParam) ? sectionParam! : "account";

  const [settings, setSettings] = useState<PlayerSettingsResponse | null>(null);
  const [accountForm, setAccountForm] = useState<AccountForm>({ full_name: "", email: "", phone: "", current_password: "" });
  const [passwordForm, setPasswordForm] = useState<PasswordForm>(emptyPasswordForm);
  const [notifications, setNotifications] = useState<NotificationSettings>(defaultNotifications);
  const [privacy, setPrivacy] = useState<PrivacySettings>(defaultPrivacy);
  const [accountErrors, setAccountErrors] = useState<Record<string, string>>({});
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [deactivatePassword, setDeactivatePassword] = useState("");
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [isEditingAccount, setIsEditingAccount] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [savingSection, setSavingSection] = useState<SettingsSection | "">("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadSettings();
  }, []);

  const dirtySection = useMemo(() => {
    if (!settings) return "";
    if (accountForm.full_name !== settings.account.full_name || accountForm.email !== settings.account.email || accountForm.phone !== settings.account.phone || accountForm.current_password) return "account";
    if (JSON.stringify(notifications) !== JSON.stringify(settings.notifications)) return "notifications";
    if (JSON.stringify(privacy) !== JSON.stringify(settings.privacy)) return "privacy";
    if (passwordForm.current_password || passwordForm.new_password || passwordForm.confirm_password) return "security";
    return "";
  }, [accountForm, notifications, passwordForm, privacy, settings]);

  const isAccountEmailChanged = settings ? accountForm.email.trim().toLowerCase() !== settings.account.email.toLowerCase() : false;
  const accountHasChanges = settings
    ? accountForm.full_name !== settings.account.full_name ||
      accountForm.email !== settings.account.email ||
      accountForm.phone !== settings.account.phone
    : false;
  const canSaveAccount = accountHasChanges && (!isAccountEmailChanged || Boolean(accountForm.current_password.trim()));

  async function loadSettings() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<PlayerSettingsResponse>("/api/auth/settings/player/");
      hydrateSettings(response.data);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load your settings. Please try again."));
    } finally {
      setIsLoading(false);
    }
  }

  function hydrateSettings(nextSettings: PlayerSettingsResponse) {
    setSettings(nextSettings);
    setAccountForm({
      full_name: nextSettings.account.full_name,
      email: nextSettings.account.email,
      phone: nextSettings.account.phone || "",
      current_password: "",
    });
    setNotifications(nextSettings.notifications);
    setPrivacy(nextSettings.privacy);
  }

  function changeSection(nextSection: SettingsSection) {
    if (dirtySection && dirtySection !== nextSection) {
      const canLeave = window.confirm("You have unsaved changes in this section. Leave without saving?");
      if (!canLeave) return;
      if (settings) hydrateSettings(settings);
      setPasswordForm(emptyPasswordForm);
      setAccountErrors({});
      setPasswordErrors({});
    }
    if (dirtySection === "account" || (!dirtySection && activeSection === "account")) {
      setIsEditingAccount(false);
    }
    router.push(`/dashboard/player/settings?section=${nextSection}`);
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

  function cancelSecurityChanges() {
    setPasswordForm(emptyPasswordForm);
    setPasswordErrors({});
  }

  function cancelNotificationChanges() {
    if (settings) setNotifications(settings.notifications);
  }

  function cancelPrivacyChanges() {
    if (settings) setPrivacy(settings.privacy);
  }

  async function saveAccount() {
    setSavingSection("account");
    setAccountErrors({});
    try {
      const response = await api.patch<{
        detail: string;
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
        emitToast({ message: "Please verify your new email address.", type: "info", dedupeKey: "settings-email-verification" });
        router.push("/verify-email");
        return;
      }

      saveCurrentUser(response.data.user);
      emitToast({ message: "Your account settings have been updated.", type: "success", dedupeKey: "settings-account-saved" });
      await loadSettings();
      setIsEditingAccount(false);
    } catch (requestError) {
      setAccountErrors({
        full_name: getApiErrorField(requestError, "full_name") || "",
        email: getApiErrorField(requestError, "email") || "",
        phone: getApiErrorField(requestError, "phone") || "",
        current_password: getApiErrorField(requestError, "current_password") || "",
      });
      emitToast({ message: getApiErrorMessage(requestError, "We could not update your account settings. Please try again."), type: "error", dedupeKey: "settings-account-error" });
    } finally {
      setSavingSection("");
    }
  }

  async function changePassword() {
    setSavingSection("security");
    setPasswordErrors({});
    try {
      await api.post("/api/auth/settings/password/", passwordForm);
      emitToast({ message: "Your password has been changed. Please sign in again.", type: "success", dedupeKey: "settings-password-changed" });
      setPasswordForm(emptyPasswordForm);
      clearAuthSession();
      router.push("/login?password_changed=1");
    } catch (requestError) {
      setPasswordErrors({
        current_password: getApiErrorField(requestError, "current_password") || "",
        new_password: getApiErrorField(requestError, "new_password") || "",
        confirm_password: getApiErrorField(requestError, "confirm_password") || "",
      });
      emitToast({ message: getApiErrorMessage(requestError, "We could not change your password. Please try again."), type: "error", dedupeKey: "settings-password-error" });
    } finally {
      setSavingSection("");
    }
  }

  async function saveNotifications() {
    setSavingSection("notifications");
    try {
      await api.patch("/api/auth/settings/notifications/", notifications);
      emitToast({ message: "Your notification preferences have been saved.", type: "success", dedupeKey: "settings-notifications-saved" });
      await loadSettings();
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not save your notification preferences. Please try again."), type: "error", dedupeKey: "settings-notifications-error" });
    } finally {
      setSavingSection("");
    }
  }

  async function savePrivacy() {
    setSavingSection("privacy");
    try {
      await api.patch("/api/auth/settings/privacy/", privacy);
      emitToast({ message: "Your privacy settings have been saved.", type: "success", dedupeKey: "settings-privacy-saved" });
      await loadSettings();
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not save your privacy settings. Please try again."), type: "error", dedupeKey: "settings-privacy-error" });
    } finally {
      setSavingSection("");
    }
  }

  async function deactivateAccount() {
    setSavingSection("management");
    try {
      await api.post("/api/auth/settings/deactivate/", { password: deactivatePassword });
      emitToast({ message: "Your account has been deactivated.", type: "success", dedupeKey: "settings-account-deactivated" });
      clearAuthSession();
      router.push("/login?account_deactivated=1");
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not deactivate your account. Please check your password and try again."), type: "error", dedupeKey: "settings-deactivate-error" });
    } finally {
      setSavingSection("");
    }
  }

  if (isLoading) return <SettingsSkeleton />;

  if (error || !settings) {
    return (
      <div className="space-y-5">
        <DashboardPageHeader title="Settings" description="Manage your account, security, notifications and privacy." />
        <section className="sport-error-state">
          <p className="text-sm font-semibold text-red-700">{error || "We could not load your settings."}</p>
          <button className="sport-primary-button mt-4" onClick={loadSettings} type="button">
            Retry
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <DashboardPageHeader title="Settings" description="Manage your account, security, notifications and privacy." />

      <nav aria-label="Settings sections" className="sport-surface overflow-x-auto p-1">
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

      {dirtySection ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          You have unsaved changes in this section.
        </div>
      ) : null}

      {activeSection === "account" ? (
        <SettingsCard
          title="Account"
          description="Review the account details used for sign-in and SportSpot identification."
          actions={
            !isEditingAccount ? (
              <button
                className="sport-secondary-button min-h-11"
                onClick={startAccountEdit}
                type="button"
              >
                Edit Account
              </button>
            ) : null
          }
        >
          {!isEditingAccount ? (
            <div className="grid gap-4 md:grid-cols-2">
              <ReadOnlyField label="Full name" value={settings.account.full_name || "Not added yet"} />
              <ReadOnlyField label="SportSpot ID" value={settings.account.sportspot_id || "Created with your player profile"} />
              <ReadOnlyField label="Email address" value={settings.account.email} />
              <ReadOnlyField label="Phone number" value={settings.account.phone || "Not added yet"} />
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <TextField error={accountErrors.full_name} label="Full name" onChange={(value) => setAccountForm((current) => ({ ...current, full_name: value }))} value={accountForm.full_name} />
                <ReadOnlyField label="SportSpot ID" value={settings.account.sportspot_id || "Created with your player profile"} />
                <TextField error={accountErrors.email} label="Email address" onChange={(value) => setAccountForm((current) => ({ ...current, email: value }))} type="email" value={accountForm.email} />
                <TextField error={accountErrors.phone} label="Phone number" onChange={(value) => setAccountForm((current) => ({ ...current, phone: value }))} value={accountForm.phone} />
              </div>
              {isAccountEmailChanged ? (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <PasswordField error={accountErrors.current_password} label="Current password" onChange={(value) => setAccountForm((current) => ({ ...current, current_password: value }))} show={showPasswords} value={accountForm.current_password} />
                  <button className="mt-2 text-sm font-black text-sportGreen hover:text-green-700" onClick={() => setShowPasswords((current) => !current)} type="button">
                    {showPasswords ? "Hide password" : "Show password"}
                  </button>
                  <p className="mt-2 text-xs font-semibold text-amber-900">Your current email remains active until the new email is verified.</p>
                </div>
              ) : null}
            </>
          )}
          {settings.account.pending_email ? (
            <StatusNote tone="warning">
              Verification is pending for {settings.account.pending_email}. Your current email remains active until the new address is verified.
            </StatusNote>
          ) : (
            <StatusNote tone={settings.account.email_verified ? "success" : "warning"}>
              {settings.account.email_verified ? "Your email address is verified." : "Email verification is pending. Some protected actions may require verification."}
            </StatusNote>
          )}
          {isEditingAccount ? (
            <SectionActions>
              <button className="sport-secondary-button min-h-11" onClick={cancelAccountEdit} type="button">
                Cancel
              </button>
              <button className="sport-primary-button min-h-11" disabled={!canSaveAccount || savingSection === "account"} onClick={saveAccount} type="button">
                {savingSection === "account" ? "Saving..." : "Save Changes"}
              </button>
            </SectionActions>
          ) : null}
        </SettingsCard>
      ) : null}
      {activeSection === "security" ? (
        <SettingsCard title="Security" description="Change your password using your current password for protection.">
          <div className="grid gap-4">
            <PasswordField error={passwordErrors.current_password} label="Current password" onChange={(value) => setPasswordForm((current) => ({ ...current, current_password: value }))} show={showPasswords} value={passwordForm.current_password} />
            <PasswordField error={passwordErrors.new_password} label="New password" onChange={(value) => setPasswordForm((current) => ({ ...current, new_password: value }))} show={showPasswords} value={passwordForm.new_password} />
            <PasswordField error={passwordErrors.confirm_password} label="Confirm new password" onChange={(value) => setPasswordForm((current) => ({ ...current, confirm_password: value }))} show={showPasswords} value={passwordForm.confirm_password} />
          </div>
          <button className="mt-3 text-sm font-black text-sportGreen hover:text-green-700" onClick={() => setShowPasswords((current) => !current)} type="button">
            {showPasswords ? "Hide passwords" : "Show passwords"}
          </button>
          <PasswordRequirements password={passwordForm.new_password} confirmPassword={passwordForm.confirm_password} />
          <SectionActions>
            <button className="sport-secondary-button min-h-11" disabled={dirtySection !== "security" || savingSection === "security"} onClick={cancelSecurityChanges} type="button">
              Cancel
            </button>
            <button className="sport-primary-button" disabled={savingSection === "security"} onClick={changePassword} type="button">
              {savingSection === "security" ? "Changing..." : "Change Password"}
            </button>
          </SectionActions>
        </SettingsCard>
      ) : null}

      {activeSection === "notifications" ? (
        <SettingsCard title="Notifications" description="Choose which SportSpot updates should appear in your Notification Centre.">
          <div className="divide-y divide-slate-100">
            <SwitchRow checked={notifications.team_invitations} description="Invites to join registered Cricksal teams." label="Team invitations" onChange={(value) => setNotifications((current) => ({ ...current, team_invitations: value }))} />
            <SwitchRow checked={notifications.join_requests} description="Requests from players who want to join games you manage." label="Join requests" onChange={(value) => setNotifications((current) => ({ ...current, join_requests: value }))} />
            <SwitchRow checked={notifications.team_challenges} description="Challenge requests, responses and counter-proposals." label="Team challenges" onChange={(value) => setNotifications((current) => ({ ...current, team_challenges: value }))} />
            <SwitchRow checked={notifications.game_updates} description="Confirmed games, reminders and game-room updates." label="Game confirmations and reminders" onChange={(value) => setNotifications((current) => ({ ...current, game_updates: value }))} />
            <SwitchRow checked={notifications.booking_updates} description="Booking confirmations, reminders and venue messages." label="Booking confirmations and reminders" onChange={(value) => setNotifications((current) => ({ ...current, booking_updates: value }))} />
            <SwitchRow checked={notifications.cancellation_refunds} description="Cancellation and refund-status updates related to your bookings." label="Cancellation and refund updates" onChange={(value) => setNotifications((current) => ({ ...current, cancellation_refunds: value }))} />
            <SwitchRow checked={notifications.rating_reminders} description="Completed games waiting for verified participant feedback." label="Rating reminders" onChange={(value) => setNotifications((current) => ({ ...current, rating_reminders: value }))} />
            <SwitchRow checked={notifications.email_notifications} description="Important account and activity emails where email delivery is supported." label="Email notifications" onChange={(value) => setNotifications((current) => ({ ...current, email_notifications: value }))} />
          </div>
          <SectionActions>
            <button className="sport-secondary-button min-h-11" disabled={dirtySection !== "notifications" || savingSection === "notifications"} onClick={cancelNotificationChanges} type="button">
              Cancel
            </button>
            <button className="sport-primary-button" disabled={savingSection === "notifications"} onClick={saveNotifications} type="button">
              {savingSection === "notifications" ? "Saving..." : "Save Notification Preferences"}
            </button>
          </SectionActions>
        </SettingsCard>
      ) : null}

      {activeSection === "privacy" ? (
        <SettingsCard title="Privacy" description="Control what other players and teams can see or request.">
          <div className="divide-y divide-slate-100">
            <SwitchRow checked={privacy.public_profile_visible} description="Allow other players to view your public SportSpot profile." label="Public profile visibility" onChange={(value) => setPrivacy((current) => ({ ...current, public_profile_visible: value }))} />
            <SwitchRow checked={privacy.location_visible} description="Show your location on your player profile and recruitment previews." label="Location visibility" onChange={(value) => setPrivacy((current) => ({ ...current, location_visible: value }))} />
            <SwitchRow checked={privacy.reliability_visible} description="Show your reliability level to teams and game organisers." label="Reliability-score visibility" onChange={(value) => setPrivacy((current) => ({ ...current, reliability_visible: value }))} />
            <SwitchRow checked={privacy.rating_visible} description="Show verified rating summary on your player profile." label="Player-rating visibility" onChange={(value) => setPrivacy((current) => ({ ...current, rating_visible: value }))} />
            <SwitchRow checked={privacy.allow_team_invitations} description="Allow captains to invite you to Cricksal teams." label="Allow team invitations" onChange={(value) => setPrivacy((current) => ({ ...current, allow_team_invitations: value }))} />
            <SwitchRow checked={privacy.allow_team_challenges} description="Allow captains to include your teams in challenge activity where supported." label="Allow team challenges" onChange={(value) => setPrivacy((current) => ({ ...current, allow_team_challenges: value }))} />
          </div>
          <SectionActions>
            <button className="sport-secondary-button min-h-11" disabled={dirtySection !== "privacy" || savingSection === "privacy"} onClick={cancelPrivacyChanges} type="button">
              Cancel
            </button>
            <button className="sport-primary-button" disabled={savingSection === "privacy"} onClick={savePrivacy} type="button">
              {savingSection === "privacy" ? "Saving..." : "Save Privacy Settings"}
            </button>
          </SectionActions>
        </SettingsCard>
      ) : null}

      {activeSection === "management" ? (
        <SettingsCard title="Account Management" description="Deactivate your account if you no longer want to use SportSpot.">
          <div className="rounded-xl border border-red-200 bg-red-50 p-5">
            <p className="text-sm font-black uppercase tracking-[0.16em] text-red-700">Danger zone</p>
            <h2 className="mt-3 text-xl font-black text-red-950">Deactivate Account</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-red-900">
              Deactivation prevents sign-in and removes your account from normal activity. Existing bookings, payments, ratings and match history stay saved for records and safety.
            </p>
            <button className="sport-primary-button mt-5 bg-red-700 hover:bg-red-800 focus-visible:ring-red-300" onClick={() => setIsDeactivateOpen(true)} type="button">
              Deactivate Account
            </button>
          </div>
        </SettingsCard>
      ) : null}

      {isDeactivateOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-sportNavy/50 p-3 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-labelledby="deactivate-title">
          <div className="sport-surface w-full max-w-lg p-5 shadow-2xl sm:p-6">
            <h2 className="text-2xl font-black text-sportNavy" id="deactivate-title">Deactivate account?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Enter your password to confirm. Your booking, payment and reliability history will remain saved.</p>
            <PasswordField label="Password" onChange={setDeactivatePassword} show={showPasswords} value={deactivatePassword} />
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button className="min-h-11 rounded-xl border border-slate-300 bg-white px-5 text-sm font-black text-sportNavy hover:border-sportGreen hover:text-sportGreen" onClick={() => setIsDeactivateOpen(false)} type="button">Cancel</button>
              <button className="min-h-11 rounded-xl bg-red-700 px-5 text-sm font-black text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60" disabled={!deactivatePassword || savingSection === "management"} onClick={deactivateAccount} type="button">
                {savingSection === "management" ? "Deactivating..." : "Deactivate Account"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SettingsCard({ actions, children, description, title }: { actions?: ReactNode; children: ReactNode; description: string; title: string }) {
  return (
    <section className="sport-card sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-black text-sportNavy">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
function TextField({ error, label, onChange, type = "text", value }: { error?: string; label: string; onChange: (value: string) => void; type?: string; value: string }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-sportNavy">{label}</span>
      <input className={`sport-input mt-2 ${error ? "border-red-300 focus:border-red-400 focus:ring-red-100" : ""}`} onChange={(event) => onChange(event.target.value)} type={type} value={value} />
      {error ? <span className="sport-error-text">{error}</span> : null}
    </label>
  );
}

function PasswordField({ error, label, onChange, show, value }: { error?: string; label: string; onChange: (value: string) => void; show: boolean; value: string }) {
  return <TextField error={error} label={label} onChange={onChange} type={show ? "text" : "password"} value={value} />;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-black text-sportNavy">{label}</p>
      <div className="mt-2 flex min-h-11 items-center rounded-md border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-600">{value}</div>
    </div>
  );
}

function SwitchRow({ checked, description, label, onChange }: { checked: boolean; description: string; label: string; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-2xl">
        <p className="font-black text-sportNavy">{label}</p>
        <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
      </div>
      <button
        aria-checked={checked}
        className={`relative h-7 w-12 shrink-0 rounded-full transition focus:outline-none focus:ring-4 focus:ring-green-100 ${checked ? "bg-sportGreen" : "bg-slate-300"}`}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-6" : "left-1"}`} />
      </button>
    </div>
  );
}

function StatusNote({ children, tone }: { children: ReactNode; tone: "success" | "warning" }) {
  return <div className={`mt-5 rounded-lg border px-4 py-3 text-sm font-semibold ${tone === "success" ? "border-green-100 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{children}</div>;
}

function SectionActions({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">{children}</div>;
}

function PasswordRequirements({ confirmPassword, password }: { confirmPassword: string; password: string }) {
  const requirements = [
    { label: "At least 8 characters", met: password.length >= 8 },
    { label: "One letter", met: /[A-Za-z]/.test(password) },
    { label: "One number", met: /\d/.test(password) },
    { label: "Passwords match", met: Boolean(confirmPassword) && password === confirmPassword },
  ];
  return (
    <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-black text-sportNavy">Password must include</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {requirements.map((item) => (
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-600" key={item.label}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${item.met ? "bg-green-100 text-sportGreen" : "bg-white text-slate-400"}`}>{item.met ? "OK" : "-"}</span>
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="h-28 animate-pulse rounded-lg bg-white shadow-sm" />
      <div className="sport-surface h-14 animate-pulse" />
      <div className="sport-surface h-96 animate-pulse" />
    </div>
  );
}
