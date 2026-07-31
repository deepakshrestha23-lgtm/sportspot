const VERIFICATION_KEY = "sportspot_pending_email_verification";

export interface PendingEmailVerification {
  email: string;
  maskedEmail: string;
  expiresAt: number;
  resendAt: number;
}

function isBrowser() {
  return typeof window !== "undefined";
}

export function savePendingEmailVerification(
  email: string,
  maskedEmail: string,
  expiresIn = 600,
  resendAvailableIn = 60,
) {
  if (!isBrowser()) return;

  const now = Date.now();
  const value: PendingEmailVerification = {
    email,
    maskedEmail,
    expiresAt: now + expiresIn * 1000,
    resendAt: now + resendAvailableIn * 1000,
  };
  sessionStorage.setItem(VERIFICATION_KEY, JSON.stringify(value));
}

export function getPendingEmailVerification(): PendingEmailVerification | null {
  if (!isBrowser()) return null;

  const stored = sessionStorage.getItem(VERIFICATION_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as PendingEmailVerification;
  } catch {
    sessionStorage.removeItem(VERIFICATION_KEY);
    return null;
  }
}

export function clearPendingEmailVerification() {
  if (!isBrowser()) return;
  sessionStorage.removeItem(VERIFICATION_KEY);
}
