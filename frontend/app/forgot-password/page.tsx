"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import AuthShell from "@/components/AuthShell";
import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";

const neutralMessage =
  "If this email belongs to a verified SportSpot account, reset instructions have been sent.";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      await api.post("/api/auth/forgot-password/", { email: email.trim() });
      setMessage(neutralMessage);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "The request could not be completed. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Reset your password"
      subtitle="Enter your SportSpot account email and we will send a secure password reset link."
    >
      <form className="w-full" onSubmit={handleSubmit}>
        <FeedbackToast message={error || message} onClose={() => { setError(""); setMessage(""); }} type={error ? "error" : "success"} />

        <label className="block text-sm font-black text-sportNavy" htmlFor="recovery-email">
          Email address
        </label>
        <input
          autoComplete="email"
          className="mt-2 h-12 w-full rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sportGreen focus:ring-4 focus:ring-green-100"
          id="recovery-email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />

        <button
          className="mt-7 inline-flex h-12 w-full items-center justify-center rounded-lg bg-green-700 px-5 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-green-900/15 transition hover:-translate-y-0.5 hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:hover:translate-y-0"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Sending..." : "Send Reset Link ->"}
        </button>

        <div className="mt-8 text-center">
          <Link className="text-sm font-black text-sportGreen hover:text-green-700" href="/login">
            Back to login
          </Link>
          <p className="mt-4 text-xs font-semibold text-slate-400">For security, reset links expire quickly and can be used only once.</p>
        </div>
      </form>
    </AuthShell>
  );
}
