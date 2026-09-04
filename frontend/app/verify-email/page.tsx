"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

import AuthShell from "@/components/AuthShell";
import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { clearAuthSession } from "@/lib/auth";
import { getApiErrorField, getApiErrorMessage } from "@/lib/apiErrors";
import {
  clearPendingEmailVerification,
  getPendingEmailVerification,
  savePendingEmailVerification,
} from "@/lib/emailVerification";

const OTP_LENGTH = 6;

function secondsRemaining(timestamp: number) {
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
}

export default function VerifyEmailPage() {
  const router = useRouter();
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [email, setEmail] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [digits, setDigits] = useState(Array(OTP_LENGTH).fill(""));
  const [expiresAt, setExpiresAt] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [expirySeconds, setExpirySeconds] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);

  useEffect(() => {
    const pending = getPendingEmailVerification();
    if (!pending) return;
    setEmail(pending.email);
    setMaskedEmail(pending.maskedEmail);
    setExpiresAt(pending.expiresAt);
    setResendAt(pending.resendAt);
  }, []);

  useEffect(() => {
    const updateTimers = () => {
      setExpirySeconds(secondsRemaining(expiresAt));
      setResendSeconds(secondsRemaining(resendAt));
    };
    updateTimers();
    const timer = window.setInterval(updateTimers, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, resendAt]);

  function setOtpDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    setDigits((current) => current.map((item, itemIndex) => (itemIndex === index ? digit : item)));
    setError("");
    if (digit && index < OTP_LENGTH - 1) inputRefs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const value = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!value) return;
    event.preventDefault();
    const nextDigits = Array(OTP_LENGTH)
      .fill("")
      .map((_, index) => value[index] || "");
    setDigits(nextDigits);
    inputRefs.current[Math.min(value.length, OTP_LENGTH) - 1]?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const otp = digits.join("");
    if (!email) {
      setError("Your verification session is missing. Return to registration or sign in again.");
      return;
    }
    if (otp.length !== OTP_LENGTH) {
      setError("Enter the complete 6-digit verification code.");
      return;
    }

    setError("");
    setSuccess("");
    setIsSubmitting(true);
    try {
      await api.post("/api/auth/verify-email/", { email, otp });
      clearPendingEmailVerification();
      clearAuthSession();
      setSuccess("Email verified successfully. Redirecting you to sign in...");
      window.setTimeout(() => router.replace("/login?verified=1"), 1000);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "The code could not be verified."));
      if (["OTP_EXPIRED", "TOO_MANY_ATTEMPTS"].includes(getApiErrorField(requestError, "code") || "")) {
        setExpirySeconds(0);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResend() {
    if (!email || resendSeconds > 0 || isResending) return;
    setError("");
    setSuccess("");
    setIsResending(true);
    try {
      const response = await api.post<{
        detail: string;
        expires_in: number;
        resend_available_in: number;
      }>("/api/auth/verify-email/resend/", { email });
      const now = Date.now();
      const nextExpiresAt = now + response.data.expires_in * 1000;
      const nextResendAt = now + response.data.resend_available_in * 1000;
      setExpiresAt(nextExpiresAt);
      setResendAt(nextResendAt);
      setDigits(Array(OTP_LENGTH).fill(""));
      savePendingEmailVerification(email, maskedEmail, response.data.expires_in, response.data.resend_available_in);
      setSuccess("A new verification code has been sent. The previous code no longer works.");
      inputRefs.current[0]?.focus();
    } catch (requestError) {
      const retryAfter = Number(getApiErrorField(requestError, "retry_after"));
      if (retryAfter > 0) setResendAt(Date.now() + retryAfter * 1000);
      setError(getApiErrorMessage(requestError, "A new code could not be sent."));
    } finally {
      setIsResending(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Account security"
      heroDescription={null}
      heroEyebrow={null}
      title="Verify your email"
      subtitle={`Enter the six-digit code sent to ${maskedEmail || "your email"}. Delivery can take a moment.`}
    >
      <div className="w-full">

        {!email ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
            No pending verification was found in this browser. Return to registration, or try signing in to resume verification.
          </div>
        ) : null}
        <FeedbackToast message={error || success} onClose={() => { setError(""); setSuccess(""); }} type={error ? "error" : "success"} />

        <form className="mt-7" onSubmit={handleSubmit}>
          <div aria-label="Six digit verification code" className="grid grid-cols-6 gap-2" onPaste={handlePaste}>
            {digits.map((digit, index) => (
              <input
                aria-label={`Verification digit ${index + 1}`}
                autoComplete={index === 0 ? "one-time-code" : "off"}
                className="sport-input h-14 min-w-0 p-0 text-center text-xl font-black"
                inputMode="numeric"
                key={index}
                maxLength={1}
                onChange={(event) => setOtpDigit(index, event.target.value)}
                onKeyDown={(event) => handleKeyDown(index, event)}
                ref={(element) => {
                  inputRefs.current[index] = element;
                }}
                value={digit}
              />
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
            <span>{expirySeconds > 0 ? `Code expires in ${formatSeconds(expirySeconds)}` : "Code expired"}</span>
            <button
              className="font-black text-sportGreen disabled:cursor-not-allowed disabled:text-slate-400"
              disabled={!email || resendSeconds > 0 || isResending}
              onClick={handleResend}
              type="button"
            >
              {isResending ? "Sending..." : resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}
            </button>
          </div>

          <button
            className="sport-primary-button mt-7 w-full uppercase tracking-wide"
            disabled={!email || isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Verifying..." : "Verify email"}
          </button>
        </form>

        <div className="mt-7 flex flex-wrap justify-center gap-x-5 gap-y-2 border-t border-slate-200 pt-5 text-sm">
          <Link className="font-black text-sportGreen hover:text-green-700" href="/register">Use a different email</Link>
          <Link className="font-semibold text-slate-500 hover:text-sportNavy" href="/login">Return to login</Link>
        </div>
      </div>
    </AuthShell>
  );
}

function formatSeconds(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
