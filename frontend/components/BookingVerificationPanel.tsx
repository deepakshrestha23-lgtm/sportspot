"use client";

import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { isAxiosError } from "axios";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateOnly } from "@/lib/dates";

type VerificationBooking = {
  id: number;
  booking_code: string;
  player_name: string;
  venue_name: string;
  venue_area: string;
  venue_city: string;
  court_name: string;
  slot_date: string;
  booking_display_time: string;
  amount: string;
  status: string;
  payment_status: string;
  matchmaking_game_title: string;
};

type VerificationResult = {
  valid: boolean;
  verification_status: string;
  message: string;
  booking?: VerificationBooking;
  check_in?: {
    status: string;
    checked_in_at: string;
    checked_in_by_name: string;
    scan_count: number;
    last_scanned_at: string;
  } | null;
  already_checked_in?: boolean;
};

export default function BookingVerificationPanel({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const verificationRequestedRef = useRef(false);
  const scannerCancelledRef = useRef(false);
  const [bookingCode, setBookingCode] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<VerificationResult | null>(null);

  const verify = useCallback(async (payload: { token?: string; booking_code?: string }) => {
    setIsVerifying(true);
    setError("");
    setResult(null);
    try {
      const response = await api.post<VerificationResult>("/api/venues/owner/bookings/verify/", payload);
      setResult(response.data);
    } catch (requestError) {
      const responseData = isAxiosError<VerificationResult>(requestError) ? requestError.response?.data : undefined;
      if (responseData?.verification_status) {
        setResult(responseData);
      } else {
        setError(getApiErrorMessage(requestError, "We could not verify this booking."));
      }
    } finally {
      setIsVerifying(false);
    }
  }, []);

  useEffect(() => {
    if (!isScanning || !videoRef.current) return;

    let cancelled = false;
    const reader = new BrowserMultiFormatReader();
    const videoElement = videoRef.current;

    void reader
      .decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: "environment" } } },
        videoElement,
        (decoded, _decodeError, callbackControls) => {
          if (cancelled || !decoded || verificationRequestedRef.current) return;
          verificationRequestedRef.current = true;
          scannerCancelledRef.current = true;
          callbackControls.stop();
          controlsRef.current = null;
          setIsScanning(false);
          void verify({ token: decoded.getText() });
        },
      )
      .then((controls) => {
        if (cancelled || scannerCancelledRef.current) controls.stop();
        else controlsRef.current = controls;
      })
      .catch((requestError) => {
        if (cancelled || scannerCancelledRef.current) return;
        setIsScanning(false);
        setScannerError(getScannerErrorMessage(requestError));
      });

    return () => {
      cancelled = true;
      scannerCancelledRef.current = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [isScanning, verify]);

  useEffect(() => () => {
    scannerCancelledRef.current = true;
    controlsRef.current?.stop();
    controlsRef.current = null;
  }, []);

  function stopScanner() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    scannerCancelledRef.current = true;
    setIsScanning(false);
  }

  async function startScanner() {
    if (isScanning) return;
    if (typeof window !== "undefined" && !window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      setScannerError("Camera scanning requires a secure HTTPS connection. Enter the booking code manually instead.");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia) {
      setScannerError("This browser cannot access a camera. Enter the booking code manually instead.");
      return;
    }
    setScannerError("");
    setError("");
    setResult(null);
    verificationRequestedRef.current = false;
    scannerCancelledRef.current = false;
    setIsScanning(true);
  }

  function verifyManual() {
    const normalizedCode = bookingCode.replace(/\s+/g, "").trim().toUpperCase();
    if (!normalizedCode) {
      setError("Enter the booking code shown on the player’s booking pass.");
      return;
    }
    stopScanner();
    void verify({ booking_code: normalizedCode });
  }

  const isSuccess = Boolean(result?.valid);
  const resultBooking = result?.booking;

  return (
    <section className="sport-surface overflow-hidden border-slate-300 shadow-sm" aria-labelledby="booking-verification-title">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
        <div>
          <p className="sport-eyebrow">Venue operations</p>
          <h2 className="mt-1 text-xl font-black text-sportNavy" id="booking-verification-title">Verify a booking</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">Scan the player’s pass or enter the booking code. This verifies court access only; player attendance is managed separately.</p>
        </div>
        <button aria-label="Close booking verification" className="sport-icon-button" onClick={onClose} title="Close" type="button">×</button>
      </div>

      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div>
          <div className="flex flex-wrap gap-2">
            <button className="sport-primary-button" disabled={isScanning || isVerifying} onClick={() => void startScanner()} type="button">
              {isScanning ? "Scanning..." : "Scan QR pass"}
            </button>
            {isScanning ? <button className="sport-secondary-button" onClick={stopScanner} type="button">Stop camera</button> : null}
          </div>

          {isScanning ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-950 p-2">
              <video aria-label="Booking QR scanner camera" autoPlay className="aspect-video w-full rounded-lg object-cover" muted playsInline ref={videoRef} />
              <p className="px-2 pb-1 pt-2 text-xs font-semibold text-slate-300">Keep the QR code inside the camera frame.</p>
            </div>
          ) : null}
          {scannerError ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold leading-5 text-amber-900" role="alert">{scannerError}</p> : null}

          <div className="my-5 flex items-center gap-3 text-xs font-black uppercase tracking-[0.16em] text-slate-400"><span className="h-px flex-1 bg-slate-200" />Or enter code<span className="h-px flex-1 bg-slate-200" /></div>
          <label className="block">
            <span className="text-sm font-black text-sportNavy">Booking code</span>
            <input autoCapitalize="characters" className="sport-input mt-2 w-full font-mono uppercase tracking-wide" onChange={(event) => { setBookingCode(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") verifyManual(); }} placeholder="SSB-20260830-XXXXXXXXXXXX" value={bookingCode} />
          </label>
          <button className="sport-secondary-button mt-3" disabled={isVerifying} onClick={verifyManual} type="button">{isVerifying ? "Checking..." : "Verify code"}</button>
          {error ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold leading-5 text-red-800" role="alert">{error}</p> : null}
        </div>

        <div className={`rounded-xl border p-4 ${result ? isSuccess ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`} aria-live="polite">
          {!result ? (
            <div className="flex min-h-44 flex-col justify-center">
              <p className="text-sm font-black text-sportNavy">Ready to verify</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">A successful check-in is recorded once per booking. Scanning again is safe and will show the original check-in.</p>
            </div>
          ) : (
            <>
              <p className={`text-xs font-black uppercase tracking-[0.16em] ${isSuccess ? "text-green-700" : "text-amber-800"}`}>{isSuccess ? result.already_checked_in ? "Already checked in" : "Booking verified" : formatVerificationStatus(result.verification_status || "UNAVAILABLE")}</p>
              <h3 className="mt-2 text-lg font-black text-sportNavy">{result.message || "This booking could not be verified."}</h3>
              {resultBooking ? <div className="mt-4 space-y-2 border-t border-current/10 pt-4 text-sm"><SummaryLine label="Booking" value={resultBooking.booking_code} mono /><SummaryLine label="Player" value={resultBooking.player_name} /><SummaryLine label="Court" value={`${resultBooking.venue_name} · ${resultBooking.court_name}`} /><SummaryLine label="When" value={`${formatDateOnly(resultBooking.slot_date)} · ${resultBooking.booking_display_time}`} />{result.check_in ? <SummaryLine label="Checked in" value={`${formatDateTime(result.check_in.checked_in_at)} · ${result.check_in.scan_count} scan${result.check_in.scan_count === 1 ? "" : "s"}`} /> : null}</div> : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function SummaryLine({ label, mono = false, value }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex items-start justify-between gap-3"><span className="text-slate-600">{label}</span><span className={`text-right font-black text-sportNavy ${mono ? "font-mono text-xs" : ""}`}>{value}</span></div>;
}

function formatVerificationStatus(status: string) {
  return status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-NP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Katmandu" }).format(new Date(value));
}

function getScannerErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") return "Camera access was blocked. Allow camera access or enter the booking code manually.";
  if (error instanceof DOMException && error.name === "NotFoundError") return "No camera was found. Enter the booking code manually.";
  return "We could not start the camera. Enter the booking code manually instead.";
}
