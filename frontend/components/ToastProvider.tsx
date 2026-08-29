"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { ToastEventDetail } from "@/lib/toast";

export type ToastType = "success" | "error" | "warning" | "info";

type Toast = {
  id: string;
  message: string;
  type: ToastType;
  isLeaving: boolean;
};

type ToastInput = {
  message: string;
  type?: ToastType;
  dedupeKey?: string;
};

type ToastContextValue = {
  showToast: (toast: ToastInput) => void;
  dismissToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const durationMap: Record<ToastType, number> = {
  success: 4000,
  info: 4000,
  warning: 5000,
  error: 6000,
};

const toneMap: Record<ToastType, string> = {
  success: "border-green-200 bg-green-50 text-green-950",
  error: "border-red-200 bg-red-50 text-red-950",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  info: "border-slate-200 bg-white text-slate-950",
};

const iconMap: Record<ToastType, string> = {
  success: "check",
  error: "error",
  warning: "warning",
  info: "info",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const recentKeys = useRef<Map<string, number>>(new Map());
  const timers = useRef<Map<string, number[]>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, isLeaving: true } : toast)));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      const toastTimers = timers.current.get(id) || [];
      toastTimers.forEach((timer) => window.clearTimeout(timer));
      timers.current.delete(id);
    }, 220);
  }, []);

  const showToast = useCallback(
    ({ dedupeKey, message, type = "info" }: ToastInput) => {
      const cleanMessage = message.trim();
      if (!cleanMessage) return;

      const key = dedupeKey || `${type}:${cleanMessage}`;
      const now = Date.now();
      const lastShownAt = recentKeys.current.get(key);
      if (lastShownAt && now - lastShownAt < 1800) return;
      recentKeys.current.set(key, now);

      const id = `${key}:${now}`;
      const toast: Toast = { id, message: cleanMessage, type, isLeaving: false };
      setToasts((current) => [toast, ...current].slice(0, 4));

      const leaveTimer = window.setTimeout(() => dismissToast(id), durationMap[type]);
      const cleanupTimer = window.setTimeout(() => {
        recentKeys.current.delete(key);
      }, durationMap[type] + 1200);
      timers.current.set(id, [leaveTimer, cleanupTimer]);
    },
    [dismissToast],
  );

  useEffect(() => {
    function handleToast(event: Event) {
      const customEvent = event as CustomEvent<ToastEventDetail>;
      showToast(customEvent.detail);
    }

    window.addEventListener("sportspot-toast", handleToast);
    return () => window.removeEventListener("sportspot-toast", handleToast);
  }, [showToast]);

  const value = useMemo(() => ({ dismissToast, showToast }), [dismissToast, showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside ToastProvider.");
  }
  return context;
}

function ToastViewport({ onDismiss, toasts }: { onDismiss: (id: string) => void; toasts: Toast[] }) {
  if (!toasts.length) return null;

  return (
    <div
      aria-live="polite"
      aria-relevant="additions removals"
      className="pointer-events-none fixed left-1/2 top-4 z-[100] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-col gap-3 sm:left-auto sm:right-4 sm:translate-x-0"
      role="status"
    >
      {toasts.map((toast) => (
        <div
          className={`pointer-events-auto rounded-xl border p-4 shadow-2xl transition-all duration-200 ${
            toast.isLeaving ? "-translate-y-2 opacity-0" : "translate-y-0 opacity-100"
          } ${toneMap[toast.type]}`}
          key={toast.id}
        >
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
              <ToastIcon name={iconMap[toast.type]} />
            </span>
            <p className="min-w-0 flex-1 text-sm font-semibold leading-6">{toast.message}</p>
            <button
              aria-label="Dismiss message"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white hover:text-slate-900"
              onClick={() => onDismiss(toast.id)}
              type="button"
              >
              <CloseIcon />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ToastIcon({ name }: { name: string }) {
  const color = name === "error" ? "text-red-700" : name === "warning" ? "text-amber-700" : name === "info" ? "text-slate-700" : "text-sportGreen";
  if (name === "check") {
    return <svg aria-hidden="true" className={`h-4 w-4 ${color}`} fill="none" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" /></svg>;
  }
  return <span aria-hidden="true" className={`text-sm font-black ${color}`}>{name === "info" ? "i" : "!"}</span>;
}

function CloseIcon() {
  return <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></svg>;
}
