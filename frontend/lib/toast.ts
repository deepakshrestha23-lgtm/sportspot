import type { ToastType } from "@/components/ToastProvider";

export type ToastEventDetail = {
  message: string;
  type?: ToastType;
  dedupeKey?: string;
};

export function emitToast(detail: ToastEventDetail) {
  if (typeof window === "undefined" || !detail.message.trim()) return;
  window.dispatchEvent(new CustomEvent<ToastEventDetail>("sportspot-toast", { detail }));
}
