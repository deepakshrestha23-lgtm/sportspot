"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";

import AuthShell from "@/components/AuthShell";
import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { clearAuthSession } from "@/lib/auth";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [tokenState, setTokenState] = useState<"checking" | "valid" | "invalid">("checking");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setTokenState("invalid");
      return;
    }

    api
      .post("/api/auth/reset-password/validate/", { token })
      .then(() => setTokenState("valid"))
      .catch(() => setTokenState("invalid"));
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const trimmedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter the SportSpot account email that received this reset link.");
      return;
    }
    if (!isPasswordReady(newPassword)) {
      setError("Password must be at least 8 characters and include a letter and a number.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post("/api/auth/reset-password/", {
        token,
        email: trimmedEmail,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      clearAuthSession();
      setSuccess("Password changed successfully. Please log in with your new password.");
      window.setTimeout(() => router.replace("/login?password_reset=1"), 1200);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "The password could not be reset."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell
      contentClassName="max-w-[560px]"
      contentPlacement="start"
      eyebrow="Secure reset"
      title="Create new password"
      subtitle="Confirm your account email and choose a strong new password for SportSpot."
    >
      <form className="w-full" onSubmit={handleSubmit}>
        {tokenState === "checking" ? (
          <div className="rounded-xl border border-slate-200 bg-white/70 p-4">
            <p className="text-sm font-black text-sportNavy">Checking secure link...</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">This only takes a moment.</p>
          </div>
        ) : null}

        {tokenState === "invalid" ? (
          <div className="sport-error-state" role="alert">
            <p className="text-sm font-black text-red-800">Reset link unavailable</p>
            <p className="mt-1 text-sm leading-6 text-red-700">This reset link is invalid, expired, or has already been used.</p>
            <Link className="sport-primary-button mt-4" href="/forgot-password">
              Request a new link
            </Link>
          </div>
        ) : null}
        <FeedbackToast message={error || success} onClose={() => { setError(""); setSuccess(""); }} type={error ? "error" : "success"} />

        {tokenState === "valid" ? (
          <>
            <label className="block text-sm font-black text-sportNavy" htmlFor="reset-email">
              Account email
            </label>
            <input
              autoComplete="email"
              className="sport-input mt-2"
              id="reset-email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />

            <PasswordField
              autoComplete="new-password"
              id="new-password"
              label="New password"
              onChange={setNewPassword}
              onToggle={() => setShowNewPassword((value) => !value)}
              show={showNewPassword}
              value={newPassword}
            />

            <PasswordField
              autoComplete="new-password"
              id="confirm-password"
              label="Confirm new password"
              onChange={setConfirmPassword}
              onToggle={() => setShowConfirmPassword((value) => !value)}
              show={showConfirmPassword}
              value={confirmPassword}
            />

            <PasswordChecklist password={newPassword} confirmPassword={confirmPassword} />

            <button
              className="sport-primary-button mt-6 w-full uppercase tracking-wide"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Updating..." : "Update Password ->"}
            </button>
          </>
        ) : null}

        <div className="mt-8 text-center">
          <Link className="text-sm font-black text-sportGreen hover:text-green-700" href="/login">
            Back to login
          </Link>
          <p className="mt-4 text-xs font-semibold text-slate-400">Never share password reset links with anyone.</p>
        </div>
      </form>
    </AuthShell>
  );
}

function PasswordField({
  autoComplete,
  id,
  label,
  onChange,
  onToggle,
  show,
  value,
}: {
  autoComplete: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  onToggle: () => void;
  show: boolean;
  value: string;
}) {
  return (
    <div className="mt-4">
      <label className="block text-sm font-black text-sportNavy" htmlFor={id}>
        {label}
      </label>
      <div className="relative mt-2">
        <input
          autoComplete={autoComplete}
          className="sport-input pr-12"
          id={id}
          maxLength={128}
          minLength={8}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Min. 8 characters"
          required
          type={show ? "text" : "password"}
          value={value}
        />
        <button
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-sportNavy"
          onClick={onToggle}
          type="button"
        >
          <EyeIcon isOpen={show} />
        </button>
      </div>
    </div>
  );
}

function PasswordChecklist({ confirmPassword, password }: { confirmPassword: string; password: string }) {
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white/60 p-4 shadow-sm shadow-slate-200/50">
      <p className="text-sm font-black text-sportNavy">Password must include</p>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <Requirement isMet={password.length >= 8} label="At least 8 characters" />
        <Requirement isMet={/[A-Za-z]/.test(password)} label="One letter" />
        <Requirement isMet={/\d/.test(password)} label="One number" />
        <Requirement isMet={Boolean(confirmPassword) && password === confirmPassword} label="Passwords match" />
      </div>
    </div>
  );
}

function Requirement({ isMet, label }: { isMet: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 font-semibold ${isMet ? "text-green-700" : "text-slate-500"}`}>
      <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-black ${isMet ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"}`}>
        {isMet ? "OK" : "-"}
      </span>
      {label}
    </div>
  );
}

function EyeIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      {!isOpen ? (
        <path
          d="M4 4l16 16"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      ) : null}
    </svg>
  );
}

function isPasswordReady(password: string) {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main className="min-h-[calc(100vh-73px)] bg-[#f4f7fb]" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
