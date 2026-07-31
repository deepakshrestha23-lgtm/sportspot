"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import AuthShell from "@/components/AuthShell";
import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorField, getApiErrorMessage } from "@/lib/apiErrors";
import { getDashboardPath, saveAuthSession } from "@/lib/auth";
import { savePendingEmailVerification } from "@/lib/emailVerification";
import type { LoginResponse } from "@/types/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await api.post<LoginResponse>("/api/auth/login/", {
        email: email.trim(),
        password,
      });
      saveAuthSession(response.data);
      router.push(getDashboardPath(response.data.user.role));
    } catch (requestError) {
      if (getApiErrorField(requestError, "code") === "EMAIL_NOT_VERIFIED") {
        savePendingEmailVerification(
          email.trim(),
          getApiErrorField(requestError, "masked_email") || email.trim(),
        );
        router.push("/verify-email");
        return;
      }
      setError(getApiErrorMessage(requestError, "Invalid email or password."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Secure access"
      title="Welcome back"
      subtitle="Log in to manage your games, teams, bookings, venue operations, and notifications."
    >
      <form className="w-full" onSubmit={handleSubmit}>
        <FeedbackToast message={error} onClose={() => setError("")} type="error" />

        <label className="block text-sm font-black text-sportNavy" htmlFor="email">
          Email address
        </label>
        <input
          autoComplete="email"
          className="mt-2 h-12 w-full rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sportGreen focus:ring-4 focus:ring-green-100"
          id="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="athlete@sportspot.com"
          required
          type="email"
          value={email}
        />

        <label className="mt-5 block text-sm font-black text-sportNavy" htmlFor="password">
          Password
        </label>
        <div className="relative mt-2">
          <input
            autoComplete="current-password"
            className="h-12 w-full rounded-lg border border-slate-300 bg-white px-4 pr-12 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sportGreen focus:ring-4 focus:ring-green-100"
            id="password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            required
            type={showPassword ? "text" : "password"}
            value={password}
          />
          <button
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-sportNavy"
            onClick={() => setShowPassword((value) => !value)}
            type="button"
          >
            <EyeIcon isOpen={showPassword} />
          </button>
        </div>

        <div className="mt-5 flex items-center justify-between gap-4">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
            <input
              checked={rememberMe}
              className="h-4 w-4 rounded border-slate-300 text-sportGreen focus:ring-sportGreen"
              onChange={(event) => setRememberMe(event.target.checked)}
              type="checkbox"
            />
            Remember me
          </label>
          <Link className="text-sm font-black text-sportGreen hover:text-green-700" href="/forgot-password">
            Forgot Password?
          </Link>
        </div>

        <button
          className="mt-7 inline-flex h-12 w-full items-center justify-center rounded-lg bg-green-700 px-5 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-green-900/15 transition hover:-translate-y-0.5 hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:hover:translate-y-0"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Logging in..." : "Log In ->"}
        </button>

        <div className="mt-8 text-center">
          <p className="text-sm text-slate-600">
            Don&apos;t have an account?{" "}
            <Link className="font-black text-sportGreen hover:text-green-700" href="/register">
              Sign Up
            </Link>
          </p>
          <p className="mt-4 text-xs font-semibold text-slate-400">Your account information is securely protected.</p>
        </div>
      </form>
    </AuthShell>
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
