"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { AdminLoadingScreen } from "@/components/admin-dashboard/AdminDashboardLayout";
import { AdminPageHeader, AdminPanel } from "@/components/admin-dashboard/AdminUi";
import LoadingIndicator from "@/components/LoadingIndicator";
import { api } from "@/lib/api";
import { getApiErrorField, getApiErrorMessage } from "@/lib/apiErrors";
import { clearAuthSession } from "@/lib/auth";
import { emitToast } from "@/lib/toast";
import type { User } from "@/types/auth";

type PasswordForm = {
  current_password: string;
  new_password: string;
  confirm_password: string;
};

const emptyPasswordForm: PasswordForm = {
  current_password: "",
  new_password: "",
  confirm_password: "",
};

export default function AdminSettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [passwordForm, setPasswordForm] = useState<PasswordForm>(emptyPasswordForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [visibleFields, setVisibleFields] = useState<Record<keyof PasswordForm, boolean>>({
    current_password: false,
    new_password: false,
    confirm_password: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    loadAdminAccount();
  }, []);

  const requirements = useMemo(() => [
    { label: "At least 8 characters", met: passwordForm.new_password.length >= 8 },
    { label: "At least one letter", met: /[A-Za-z]/.test(passwordForm.new_password) },
    { label: "At least one number", met: /\d/.test(passwordForm.new_password) },
    { label: "Passwords match", met: Boolean(passwordForm.confirm_password) && passwordForm.new_password === passwordForm.confirm_password },
  ], [passwordForm.confirm_password, passwordForm.new_password]);

  const isReady = Boolean(
    passwordForm.current_password &&
    passwordForm.new_password &&
    passwordForm.confirm_password &&
    requirements.every((requirement) => requirement.met),
  );

  async function loadAdminAccount() {
    setIsLoading(true);
    setLoadError("");
    try {
      const response = await api.get<User>("/api/auth/me/");
      setUser(response.data);
    } catch (requestError) {
      setLoadError(getApiErrorMessage(requestError, "We could not load your admin account."));
    } finally {
      setIsLoading(false);
    }
  }

  function updateField(field: keyof PasswordForm, value: string) {
    setPasswordForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: "" }));
    setFormError("");
  }

  function clearForm() {
    setPasswordForm(emptyPasswordForm);
    setFieldErrors({});
    setFormError("");
  }

  async function submitPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setFormError("");

    if (!isReady) {
      setFormError("Complete every password requirement before continuing.");
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post("/api/auth/settings/password/", passwordForm);
      emitToast({ message: "Your admin password has been changed. Please sign in again.", type: "success", dedupeKey: "admin-settings-password-changed" });
      clearAuthSession();
      router.push("/login?password_changed=1");
    } catch (requestError) {
      setFieldErrors({
        current_password: getApiErrorField(requestError, "current_password") || "",
        new_password: getApiErrorField(requestError, "new_password") || "",
        confirm_password: getApiErrorField(requestError, "confirm_password") || "",
      });
      setFormError(getApiErrorMessage(requestError, "We could not change your password. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) return <AdminLoadingScreen label="Loading admin security" />;

  if (loadError || !user) {
    return (
      <div className="space-y-6">
        <AdminPageHeader title="Settings" description="Manage your admin account and security." />
        <AdminPanel>
          <div className="admin-empty-state" role="alert">
            <span aria-hidden="true" className="admin-empty-icon"><LockIcon /></span>
            <h2>Settings unavailable</h2>
            <p>{loadError || "We could not load your admin account."}</p>
            <button className="sport-primary-button mt-5" onClick={() => void loadAdminAccount()} type="button">Try again</button>
          </div>
        </AdminPanel>
      </div>
    );
  }

  return (
    <div className="admin-settings-page space-y-6">
      <AdminPageHeader
        actions={<Link className="sport-secondary-button" href="/dashboard/admin">Back to overview</Link>}
        description="Keep the administrator account protected and recoverable from one focused workspace."
        eyebrow="Admin workspace"
        title="Settings"
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <AdminPanel className="admin-settings-panel">
          <div className="admin-settings-panel-heading">
            <div>
              <p className="sport-eyebrow">Account security</p>
              <h2>Change admin password</h2>
              <p>Confirm your current password, then choose a new password for future admin sign-ins.</p>
            </div>
            <span className="admin-settings-heading-icon" aria-hidden="true"><ShieldIcon /></span>
          </div>

          <form className="admin-settings-form" onSubmit={submitPasswordChange}>
            <div className="admin-settings-form-grid">
              <PasswordField
                autoComplete="current-password"
                error={fieldErrors.current_password}
                id="admin-current-password"
                label="Current password"
                onChange={(value) => updateField("current_password", value)}
                onToggle={() => setVisibleFields((current) => ({ ...current, current_password: !current.current_password }))}
                value={passwordForm.current_password}
                visible={visibleFields.current_password}
              />
              <PasswordField
                autoComplete="new-password"
                error={fieldErrors.new_password}
                id="admin-new-password"
                label="New password"
                onChange={(value) => updateField("new_password", value)}
                onToggle={() => setVisibleFields((current) => ({ ...current, new_password: !current.new_password }))}
                value={passwordForm.new_password}
                visible={visibleFields.new_password}
              />
              <PasswordField
                autoComplete="new-password"
                error={fieldErrors.confirm_password}
                id="admin-confirm-password"
                label="Confirm new password"
                onChange={(value) => updateField("confirm_password", value)}
                onToggle={() => setVisibleFields((current) => ({ ...current, confirm_password: !current.confirm_password }))}
                value={passwordForm.confirm_password}
                visible={visibleFields.confirm_password}
              />
            </div>

            <div className="admin-settings-requirements" aria-live="polite">
              <div>
                <strong>Password requirements</strong>
                <span>Use a unique password that you do not use elsewhere.</span>
              </div>
              <div className="admin-settings-requirement-list">
                {requirements.map((requirement) => (
                  <span className={requirement.met ? "is-met" : ""} key={requirement.label}>
                    <b aria-hidden="true">{requirement.met ? <CheckIcon /> : null}</b>
                    {requirement.label}
                  </span>
                ))}
              </div>
            </div>

            {formError ? <p className="admin-settings-form-error" role="alert">{formError}</p> : null}

            <div className="admin-settings-actions">
              <button className="sport-secondary-button" disabled={isSubmitting || !Object.values(passwordForm).some(Boolean)} onClick={clearForm} type="button">Clear</button>
              <button className="sport-primary-button" disabled={isSubmitting || !isReady} type="submit">
                {isSubmitting ? <LoadingIndicator label="Changing password" size="sm" tone="inverse" /> : "Change password"}
              </button>
            </div>
          </form>
        </AdminPanel>

        <div className="space-y-6">
          <AdminPanel className="admin-settings-info-panel">
            <div className="admin-settings-info-heading">
              <span className="admin-settings-info-icon" aria-hidden="true"><UserIcon /></span>
              <div>
                <p className="sport-eyebrow">Signed-in account</p>
                <h2>{user.full_name || "Admin account"}</h2>
              </div>
            </div>
            <dl className="admin-settings-account-list">
              <div><dt>Email address</dt><dd>{user.email}</dd></div>
              <div><dt>Access level</dt><dd>Platform administrator</dd></div>
              <div><dt>Account status</dt><dd><span className="admin-settings-status"><span aria-hidden="true" />{user.is_active ? "Active" : "Inactive"}</span></dd></div>
            </dl>
            <div className="admin-settings-session-note"><LockIcon /><p>Changing your password signs out this browser and invalidates existing login sessions.</p></div>
          </AdminPanel>

          <AdminPanel className="admin-settings-recovery-panel">
            <p className="sport-eyebrow">Can&apos;t sign in?</p>
            <h2>Password recovery</h2>
            <p>Use the verified admin email address to receive a secure reset link.</p>
            <Link className="admin-settings-recovery-link" href="/forgot-password">Go to password recovery <span aria-hidden="true">&rarr;</span></Link>
          </AdminPanel>
        </div>
      </div>
    </div>
  );
}

function PasswordField({ autoComplete, error, id, label, onChange, onToggle, value, visible }: { autoComplete: string; error?: string; id: string; label: string; onChange: (value: string) => void; onToggle: () => void; value: string; visible: boolean }) {
  return (
    <label className="admin-settings-field" htmlFor={id}>
      <span>{label}</span>
      <div className="admin-settings-input-wrap">
        <input aria-describedby={error ? `${id}-error` : undefined} aria-invalid={Boolean(error)} autoComplete={autoComplete} className="sport-input pr-12" id={id} onChange={(event) => onChange(event.target.value)} type={visible ? "text" : "password"} value={value} />
        <button aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} className="admin-settings-visibility" onClick={onToggle} title={visible ? "Hide password" : "Show password"} type="button"><EyeIcon visible={visible} /></button>
      </div>
      {error ? <small id={`${id}-error`}>{error}</small> : null}
    </label>
  );
}

function EyeIcon({ visible }: { visible: boolean }) {
  return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />{!visible ? <path d="m4 4 16 16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /> : null}</svg>;
}

function CheckIcon() { return <svg aria-hidden="true" className="h-3 w-3" fill="none" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" /></svg>; }
function LockIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><rect height="10" rx="2" stroke="currentColor" strokeWidth="1.8" width="14" x="5" y="10" /><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>; }
function ShieldIcon() { return <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24"><path d="m12 3 7 3v5c0 4.5-2.8 8-7 10-4.2-2-7-5.5-7-10V6l7-3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /><path d="m9 12 2 2 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>; }
function UserIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" /><path d="M5 20a7 7 0 0 1 14 0" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>; }
