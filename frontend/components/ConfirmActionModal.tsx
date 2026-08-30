"use client";

import LoadingIndicator from "@/components/LoadingIndicator";

type ConfirmActionModalProps = {
  actionLabel: string;
  body: string;
  confirmTone?: "danger" | "warning";
  isWorking?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
};

export default function ConfirmActionModal({
  actionLabel,
  body,
  confirmTone = "danger",
  isWorking = false,
  onCancel,
  onConfirm,
  title,
}: ConfirmActionModalProps) {
  const confirmClass =
    confirmTone === "warning"
      ? "bg-amber-600 text-white hover:bg-amber-700 disabled:bg-slate-400"
      : "bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-400";

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 px-4 py-6">
      <section className="w-full max-w-lg rounded-lg bg-white p-6 shadow-2xl">
        <p className="text-xs font-black uppercase tracking-wide text-red-600">Confirm Action</p>
        <h2 className="mt-2 text-2xl font-black text-sportNavy">{title}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">{body}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button className="rounded-md border border-slate-300 px-5 py-3 text-sm font-black text-slate-700 hover:bg-slate-50" disabled={isWorking} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className={`rounded-md px-5 py-3 text-sm font-black ${confirmClass}`} disabled={isWorking} onClick={onConfirm} type="button">
            {isWorking ? <LoadingIndicator label="Working" size="sm" tone="inverse" /> : actionLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
