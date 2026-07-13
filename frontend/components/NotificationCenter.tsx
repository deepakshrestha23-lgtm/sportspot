"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type NotificationAction = {
  label: string;
  variant?: "primary" | "secondary" | "danger";
  type: "toast" | "route" | "player-card";
  message?: string;
  href?: string;
};

type SportSpotNotification = {
  id: number;
  title: string;
  message: string;
  time: string;
  icon: string;
  unread: boolean;
  actions: NotificationAction[];
};

const placeholderNotifications: SportSpotNotification[] = [
  {
    id: 1,
    title: "Challenge Received",
    message: "Thamel Tigers want to challenge your team for Jun 22 at NCS Indoor Cricksal",
    time: "5 min ago",
    icon: "VS",
    unread: true,
    actions: [
      { label: "Accept", variant: "primary", type: "toast", message: "Challenge accepted." },
      { label: "Details", type: "route", href: "/challenge-teams/details" },
      { label: "Decline", variant: "danger", type: "toast", message: "Challenge declined." },
    ],
  },
  {
    id: 2,
    title: "Join Request",
    message: "Nisha Gurung requested to join Sunday's open game slot — Bowler · Intermediate",
    time: "18 min ago",
    icon: "JR",
    unread: true,
    actions: [
      { label: "Player Card", type: "player-card" },
      { label: "Accept", variant: "primary", type: "toast", message: "Join request accepted." },
      { label: "Reject", variant: "danger", type: "toast", message: "Join request rejected." },
    ],
  },
  {
    id: 3,
    title: "Match Tomorrow",
    message: "Baneshwor Bolters vs Thamel Tigers — 5:00 PM at NCS Indoor Cricksal",
    time: "1 hr ago",
    icon: "MT",
    unread: false,
    actions: [{ label: "View Match Room", variant: "primary", type: "route", href: "/dashboard/player/matches" }],
  },
  {
    id: 4,
    title: "Payment Confirmed",
    message: "Booking SS-2024-1847 confirmed. Rs 1,500 paid via eSewa",
    time: "Yesterday",
    icon: "Rs",
    unread: false,
    actions: [{ label: "View Booking", variant: "primary", type: "route", href: "/dashboard/player/bookings" }],
  },
  {
    id: 5,
    title: "Rate Your Match",
    message: "How was your last match? Share your rating now",
    time: "2 days ago",
    icon: "★",
    unread: false,
    actions: [{ label: "Rate Now", variant: "primary", type: "route", href: "/dashboard/player/ratings" }],
  },
];

export default function NotificationCenter({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(placeholderNotifications);
  const [toast, setToast] = useState("");
  const [isPlayerCardOpen, setIsPlayerCardOpen] = useState(false);

  if (!isOpen) return null;

  function markAllRead() {
    setNotifications((items) => items.map((item) => ({ ...item, unread: false })));
    showToast("All notifications marked as read.");
  }

  function markOneRead(id: number) {
    setNotifications((items) => items.map((item) => (item.id === id ? { ...item, unread: false } : item)));
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 1800);
  }

  function handleAction(notification: SportSpotNotification, action: NotificationAction) {
    markOneRead(notification.id);

    if (action.type === "route" && action.href) {
      onClose();
      router.push(action.href);
      return;
    }

    if (action.type === "player-card") {
      setIsPlayerCardOpen(true);
      return;
    }

    showToast(action.message || `${action.label} clicked.`);
  }

  return (
    <div className="fixed inset-0 z-50">
      <button aria-label="Close notifications overlay" className="absolute inset-0 bg-slate-950/35" onClick={onClose} type="button" />

      <aside className="absolute inset-0 flex h-full w-full flex-col bg-white shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:max-w-md">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-sportNavy">Notifications</h2>
              <p className="mt-1 text-sm text-slate-500">Alerts, match updates, and quick actions.</p>
            </div>
            <button className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900" onClick={onClose} type="button">
              <CloseIcon />
            </button>
          </div>
          <button className="mt-4 text-sm font-bold text-sportGreen hover:text-green-700" onClick={markAllRead} type="button">
            Mark all read
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50 p-4">
          {notifications.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-50 text-sportGreen">
                <BellSmallIcon />
              </div>
              <h3 className="mt-4 text-lg font-black text-sportNavy">No notifications</h3>
              <p className="mt-2 text-sm text-slate-500">You are all caught up for now.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {notifications.map((notification) => (
                <article key={notification.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-50 text-sm font-black text-sportGreen">
                      {notification.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            {notification.unread ? <span className="h-2.5 w-2.5 rounded-full bg-sportGreen" /> : null}
                            <h3 className="font-black text-sportNavy">{notification.title}</h3>
                          </div>
                          <p className="mt-1 text-sm leading-6 text-slate-600">{notification.message}</p>
                        </div>
                        <span className="shrink-0 text-xs font-semibold text-slate-400">{notification.time}</span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {notification.actions.map((action) => (
                          <button
                            className={getActionClassName(action.variant)}
                            key={action.label}
                            onClick={() => handleAction(notification, action)}
                            type="button"
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {toast ? (
          <div className="absolute bottom-5 left-1/2 w-[calc(100%-2rem)] -translate-x-1/2 rounded-md bg-sportNavy px-4 py-3 text-sm font-semibold text-white shadow-lg sm:w-auto">
            {toast}
          </div>
        ) : null}

        {isPlayerCardOpen ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/40 p-4">
            <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-black text-sportNavy">Nisha Gurung</h3>
                  <p className="mt-1 text-sm text-slate-500">Bowler · Intermediate · Kathmandu</p>
                </div>
                <button className="rounded-full p-2 text-slate-500 hover:bg-slate-100" onClick={() => setIsPlayerCardOpen(false)} type="button">
                  <CloseIcon />
                </button>
              </div>
              <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-md bg-slate-50 p-3">
                  <dt className="text-xs font-semibold text-slate-500">Rating</dt>
                  <dd className="mt-1 font-black text-sportNavy">4.7</dd>
                </div>
                <div className="rounded-md bg-slate-50 p-3">
                  <dt className="text-xs font-semibold text-slate-500">Reliability</dt>
                  <dd className="mt-1 font-black text-sportGreen">88</dd>
                </div>
                <div className="rounded-md bg-slate-50 p-3">
                  <dt className="text-xs font-semibold text-slate-500">Matches</dt>
                  <dd className="mt-1 font-black text-sportNavy">12</dd>
                </div>
              </dl>
              <p className="mt-4 text-sm leading-6 text-slate-600">Placeholder player card preview. Real player profile data will be added in a later phase.</p>
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function getActionClassName(variant: NotificationAction["variant"] = "secondary") {
  const baseClassName = "rounded-md px-3 py-2 text-xs font-black transition";

  if (variant === "primary") return `${baseClassName} bg-sportGreen text-white hover:bg-green-700`;
  if (variant === "danger") return `${baseClassName} bg-red-50 text-red-700 hover:bg-red-100`;
  return `${baseClassName} bg-slate-100 text-slate-700 hover:bg-slate-200`;
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

function BellSmallIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <path
        d="M15 17H9m9-2v-4a6 6 0 1 0-12 0v4l-2 2h16l-2-2Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}
