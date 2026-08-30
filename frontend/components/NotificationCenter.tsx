"use client";

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import LoadingIndicator from "@/components/LoadingIndicator";
import { api, refreshAccessTokenForRealtime } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getAccessToken } from "@/lib/auth";
import { emitToast } from "@/lib/toast";
import { getNotificationWebSocketUrl } from "@/lib/realtime";
import type {
  NotificationAction,
  NotificationActionResponse,
  NotificationCategory,
  NotificationCountResponse,
  NotificationsResponse,
  SportSpotNotification,
} from "@/types/notification";

type FilterKey = "ALL" | "UNSEEN" | "ACTION" | NotificationCategory;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "UNSEEN", label: "Unseen" },
  { key: "ACTION", label: "Action Required" },
  { key: "BOOKINGS", label: "Bookings" },
  { key: "TEAMS", label: "Teams" },
  { key: "CHALLENGES", label: "Challenges" },
  { key: "MATCHES", label: "Matches" },
  { key: "SYSTEM", label: "System" },
];

export default function NotificationCenter({
  isOpen,
  onClose,
  onUnseenCountChange,
  onNewNotification,
  triggerRef,
  userId,
}: {
  isOpen: boolean;
  onClose: () => void;
  onUnseenCountChange?: (count: number) => void;
  onNewNotification?: (title: string) => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  userId: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const drawerRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seenQueueRef = useRef(new Set<number>());
  const seenBatchTimerRef = useRef<number | null>(null);
  const [notifications, setNotifications] = useState<SportSpotNotification[]>([]);
  const [unseenCount, setUnseenCount] = useState(0);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("ALL");
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const latestNotificationIdRef = useRef(0);

  useEffect(() => {
    latestNotificationIdRef.current = 0;
  }, [userId]);

  const updateUnseenCount = useCallback((count: number) => {
    setUnseenCount(count);
    onUnseenCountChange?.(count);
  }, [onUnseenCountChange]);

  const loadCount = useCallback(async () => {
    try {
      const response = await api.get<NotificationCountResponse>("/api/notifications/unseen-count/");
      updateUnseenCount(response.data.unseen_count);

      const latest = response.data.latest_notification;
      if (!latest || typeof window === "undefined") return;
      const storageKey = `sportspot_notification_latest_${userId}`;
      const previousLatestId = Math.max(
        Number(window.sessionStorage.getItem(storageKey) || 0),
        latestNotificationIdRef.current,
      );
      if (previousLatestId > 0 && latest.id > previousLatestId) {
        onNewNotification?.(latest.title);
      }
      if (latest.id > previousLatestId) {
        window.sessionStorage.setItem(storageKey, String(latest.id));
      }
      latestNotificationIdRef.current = Math.max(latestNotificationIdRef.current, latest.id);
    } catch {
      // A failed background refresh should not clear a previously correct badge.
    }
  }, [onNewNotification, updateUnseenCount, userId]);

  const loadNotifications = useCallback(async (filter: FilterKey, showLoading = true) => {
    if (showLoading) setIsLoading(true);
    setError("");
    try {
      const params = getFilterParams(filter);
      const response = await api.get<NotificationsResponse>("/api/notifications/", { params });
      setNotifications(response.data.results);
      setNextPage(response.data.next);
      updateUnseenCount(response.data.unseen_count);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load notifications."));
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [updateUnseenCount]);

  const activeFilterRef = useRef(activeFilter);
  const isOpenRef = useRef(isOpen);
  const loadCountRef = useRef(loadCount);
  const loadNotificationsRef = useRef(loadNotifications);

  useEffect(() => {
    activeFilterRef.current = activeFilter;
    isOpenRef.current = isOpen;
    loadCountRef.current = loadCount;
    loadNotificationsRef.current = loadNotifications;
  }, [activeFilter, isOpen, loadCount, loadNotifications]);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let reconnectAttempt = 0;

    function clearConnectionTimers() {
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      reconnectTimer = null;
      heartbeatTimer = null;
    }

    function scheduleReconnect() {
      if (disposed || reconnectTimer !== null) return;
      const delay = Math.min(30000, 1000 * (2 ** reconnectAttempt));
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    }

    async function connect() {
      if (disposed || typeof window === "undefined" || !window.WebSocket) return;
      const accessToken = getAccessToken();
      if (!accessToken) {
        setIsRealtimeConnected(false);
        return;
      }

      clearConnectionTimers();
      socket = new WebSocket(getNotificationWebSocketUrl());

      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: "authenticate", access_token: accessToken }));
      };

      socket.onmessage = (event) => {
        let payload: { type?: string };
        try {
          payload = JSON.parse(event.data) as { type?: string };
        } catch {
          return;
        }

        if (payload.type === "ready") {
          reconnectAttempt = 0;
          setIsRealtimeConnected(true);
          void loadCountRef.current();
          heartbeatTimer = window.setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "ping" }));
            }
          }, 30000);
          return;
        }

        if (payload.type === "notification.created") {
          // The event is only an invalidation signal. The authenticated REST
          // endpoint returns the complete, permission-checked notification.
          void loadCountRef.current();
          if (isOpenRef.current) {
            void loadNotificationsRef.current(activeFilterRef.current, false);
          }
        }
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = async (event) => {
        clearConnectionTimers();
        setIsRealtimeConnected(false);
        if (disposed) return;

        if (event.code === 4401) {
          const refreshedToken = await refreshAccessTokenForRealtime();
          if (!refreshedToken || disposed) return;
        }
        scheduleReconnect();
      };
    }

    void connect();
    return () => {
      disposed = true;
      clearConnectionTimers();
      setIsRealtimeConnected(false);
      socket?.close(1000, "Component closed");
    };
  }, [userId]);

  useEffect(() => {
    loadCount();
    const intervalId = window.setInterval(loadCount, isRealtimeConnected ? 30000 : 10000);
    const handleFocus = () => loadCount();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") loadCount();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isRealtimeConnected, loadCount]);

  useEffect(() => {
    api
      .post<{ unseen_count: number }>("/api/notifications/read-related/", { target_url: pathname })
      .then((response) => updateUnseenCount(response.data.unseen_count))
      .catch(() => undefined);
  }, [pathname, updateUnseenCount]);

  useEffect(() => {
    if (!isOpen) return;
    loadNotifications(activeFilter);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => drawerRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, activeFilter, pathname, loadNotifications]);

  useEffect(() => {
    if (!isOpen) return;
    const intervalId = window.setInterval(() => {
      loadNotifications(activeFilter, false);
    }, 10000);
    return () => window.clearInterval(intervalId);
  }, [activeFilter, isOpen, loadNotifications]);

  useEffect(() => {
    return () => {
      if (seenBatchTimerRef.current) window.clearTimeout(seenBatchTimerRef.current);
    };
  }, []);

  function closeDrawer() {
    onClose();
    window.setTimeout(() => triggerRef?.current?.focus(), 0);
  }

  const flushSeenQueue = useCallback(async () => {
    const ids = Array.from(seenQueueRef.current);
    if (ids.length === 0) return;
    seenQueueRef.current.clear();
    seenBatchTimerRef.current = null;

    const newlySeenIds = ids.filter((id) => notifications.some((item) => item.id === id && !item.is_seen));
    if (newlySeenIds.length === 0) return;
    setNotifications((items) => items.map((item) => (
      newlySeenIds.includes(item.id)
        ? { ...item, is_seen: true, seen_at: new Date().toISOString() }
        : item
    )));
    updateUnseenCount(Math.max(unseenCount - newlySeenIds.length, 0));

    try {
      const response = await api.post<{ unseen_count: number }>("/api/notifications/seen/", {
        notification_ids: newlySeenIds,
      });
      updateUnseenCount(response.data.unseen_count);
      if (activeFilter === "UNSEEN") {
        setNotifications((items) => items.filter((item) => !newlySeenIds.includes(item.id)));
      }
    } catch {
      await loadCount();
      await loadNotifications(activeFilter, false);
    }
  }, [activeFilter, loadCount, loadNotifications, notifications, unseenCount, updateUnseenCount]);

  const queueSeen = useCallback((notificationId: number) => {
    seenQueueRef.current.add(notificationId);
    if (seenBatchTimerRef.current) return;
    seenBatchTimerRef.current = window.setTimeout(flushSeenQueue, 500);
  }, [flushSeenQueue]);

  async function loadMore() {
    if (!nextPage) return;
    setIsLoadingMore(true);
    setError("");
    try {
      const response = await api.get<NotificationsResponse>(nextPage);
      setNotifications((items) => {
        const existingIds = new Set(items.map((item) => item.id));
        return [...items, ...response.data.results.filter((item) => !existingIds.has(item.id))];
      });
      setNextPage(response.data.next);
      updateUnseenCount(response.data.unseen_count);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load more notifications."));
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function markAllRead() {
    setError("");
    try {
      await api.post("/api/notifications/mark-all-read/");
      setNotifications((items) => items.map((item) => ({
        ...item,
        is_seen: true,
        is_read: true,
        seen_at: item.seen_at || new Date().toISOString(),
        read_at: new Date().toISOString(),
      })));
      updateUnseenCount(0);
      if (activeFilter === "UNSEEN") setNotifications([]);
      emitToast({ message: "All notifications marked as read.", type: "success", dedupeKey: "notifications-marked-read" });
    } catch (requestError) {
      emitToast({
        message: getApiErrorMessage(requestError, "Could not mark notifications as read."),
        type: "error",
        dedupeKey: "notifications-mark-read-error",
      });
    }
  }

  async function performAction(notification: SportSpotNotification, action: NotificationAction) {
    setActionId(notification.id);
    setError("");
    try {
      const response = await api.post<NotificationActionResponse>(
        `/api/notifications/${notification.id}/action/`,
        { action: action.key },
      );
      setNotifications((items) => items.map((item) => (
        item.id === notification.id ? response.data.notification : item
      )));
      updateUnseenCount(response.data.unseen_count);
      emitToast({ message: response.data.detail, type: "success", dedupeKey: `notification-action-${notification.id}-${action.key}` });
      if (action.key === "open" && response.data.target_url) {
        closeDrawer();
        router.push(response.data.target_url);
      }
      if (action.key !== "open") {
        await loadNotifications(activeFilter, false);
      }
    } catch (requestError) {
      emitToast({
        message: getApiErrorMessage(requestError, `Could not ${action.label.toLowerCase()}.`),
        type: "error",
        dedupeKey: `notification-action-error-${notification.id}-${action.key}`,
      });
    } finally {
      setActionId(null);
    }
  }

  function handleDrawerKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab" || !drawerRef.current) return;
    const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!isOpen) return null;

  const emptyMessage = activeFilter === "UNSEEN"
    ? "You are all caught up."
    : "You have no notifications yet.";

  return (
    <div className="fixed inset-0 z-50">
      <button
        aria-label="Close Notification Centre"
        className="absolute inset-0 hidden bg-slate-950/45 backdrop-blur-[1px] sm:block"
        onClick={closeDrawer}
        type="button"
      />

      <aside
        aria-label="Notification Centre"
        aria-modal="true"
        className="absolute inset-0 flex h-full w-full flex-col bg-slate-50 shadow-2xl outline-none sm:inset-y-0 sm:left-auto sm:right-0 sm:max-w-2xl"
        id="sportspot-notification-centre"
        onKeyDown={handleDrawerKeyDown}
        ref={drawerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-black text-sportNavy sm:text-2xl">Notifications</h2>
                {unseenCount > 0 ? (
                  <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-black text-green-800">
                    {unseenCount > 99 ? "99+" : unseenCount} unseen
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-slate-500">Important updates and actions across SportSpot.</p>
            </div>
            <button
              aria-label="Close notifications"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              onClick={closeDrawer}
              type="button"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              className="text-sm font-black text-sportGreen hover:text-green-700 disabled:text-slate-400"
              disabled={notifications.length === 0}
              onClick={markAllRead}
              type="button"
            >
              Mark all as read
            </button>
            <button
              className="text-sm font-bold text-slate-500 hover:text-sportNavy"
              onClick={() => loadNotifications(activeFilter)}
              type="button"
            >
              Refresh
            </button>
          </div>
          <div aria-label="Notification filters" className="mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist">
            {FILTERS.map((filter) => (
              <button
                aria-selected={activeFilter === filter.key}
                className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-black transition ${
                  activeFilter === filter.key
                    ? "bg-sportNavy text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:border-green-300 hover:text-sportGreen"
                }`}
                key={filter.key}
                onClick={() => setActiveFilter(filter.key)}
                role="tab"
                type="button"
              >
                {filter.label}
              </button>
            ))}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-3 sm:p-5" ref={scrollRef}>
          {error ? (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
              <span>{error}</span>
              <button className="shrink-0 font-black underline" onClick={() => loadNotifications(activeFilter)} type="button">
                Retry
              </button>
            </div>
          ) : null}

          {isLoading ? (
            <NotificationSkeletons />
          ) : notifications.length === 0 ? (
            <div className="flex min-h-[55vh] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-sportGreen">
                <BellSmallIcon />
              </div>
              <h3 className="mt-4 text-lg font-black text-sportNavy">{emptyMessage}</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
                Important team, booking, venue, and system updates will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {notifications.map((notification) => (
                <NotificationCard
                  actionId={actionId}
                  key={notification.id}
                  notification={notification}
                  onAction={performAction}
                  onSeen={queueSeen}
                  scrollRoot={scrollRef}
                />
              ))}
              {nextPage ? (
                <button
                  className="w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-black text-sportNavy hover:border-green-300 hover:text-sportGreen disabled:text-slate-400"
                  disabled={isLoadingMore}
                  onClick={loadMore}
                  type="button"
                >
                  {isLoadingMore ? <LoadingIndicator label="Loading more" size="sm" /> : "Load More"}
                </button>
              ) : null}
            </div>
          )}
        </div>

      </aside>
    </div>
  );
}

function NotificationCard({
  notification,
  onAction,
  onSeen,
  scrollRoot,
  actionId,
}: {
  notification: SportSpotNotification;
  onAction: (notification: SportSpotNotification, action: NotificationAction) => void;
  onSeen: (id: number) => void;
  scrollRoot: RefObject<HTMLDivElement | null>;
  actionId: number | null;
}) {
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (notification.is_seen || !cardRef.current || !scrollRoot.current) return;
    let visibleTimer: number | null = null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
          if (!visibleTimer) {
            visibleTimer = window.setTimeout(() => onSeen(notification.id), 1000);
          }
        } else if (visibleTimer) {
          window.clearTimeout(visibleTimer);
          visibleTimer = null;
        }
      },
      { root: scrollRoot.current, threshold: [0.35] },
    );
    observer.observe(cardRef.current);
    return () => {
      observer.disconnect();
      if (visibleTimer) window.clearTimeout(visibleTimer);
    };
  }, [notification.id, notification.is_seen, onSeen, scrollRoot]);

  const openAction = notification.actions.find((action) => action.key === "open");
  return (
    <article
      className={`relative overflow-hidden rounded-lg border bg-white p-4 transition sm:p-5 ${
        notification.is_seen
          ? "border-slate-200"
          : "border-green-300 bg-green-50/40 shadow-sm"
      } ${notification.priority === "URGENT" ? "border-l-4 border-l-red-500" : notification.priority === "IMPORTANT" ? "border-l-4 border-l-sportGreen" : ""}`}
      ref={cardRef}
    >
      <div className="flex gap-3 sm:gap-4">
        <ActorAvatar notification={notification} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <button
              className="min-w-0 flex-1 text-left disabled:cursor-default"
              disabled={!openAction}
              onClick={() => openAction && onAction(notification, openAction)}
              type="button"
            >
              <div className="flex flex-wrap items-center gap-2">
                {!notification.is_seen ? (
                  <>
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-sportGreen" />
                    <span className="sr-only">Unseen notification.</span>
                  </>
                ) : null}
                <h3 className="font-black text-sportNavy">{notification.title}</h3>
                {notification.priority === "URGENT" ? <PriorityBadge label="Urgent" /> : null}
                {notification.action_status !== "NONE" ? <StatusBadge status={notification.action_status} /> : null}
              </div>
              <p className="mt-1.5 text-sm leading-6 text-slate-600">{notification.message}</p>
            </button>
            <time
              className="shrink-0 text-xs font-semibold text-slate-400"
              dateTime={notification.created_at}
              title={notification.full_time}
            >
              {notification.time_label}
            </time>
          </div>
          {notification.actor_name ? (
            <p className="mt-2 text-xs font-semibold text-slate-400">From {notification.actor_name}</p>
          ) : null}
          {notification.actions.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {notification.actions.map((action) => (
                <button
                  className={getActionClass(action.style)}
                  disabled={actionId === notification.id}
                  key={action.key}
                  onClick={() => onAction(notification, action)}
                  type="button"
                >
                  {actionId === notification.id ? "Working..." : action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ActorAvatar({ notification }: { notification: SportSpotNotification }) {
  if (notification.actor_avatar) {
    return (
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-white">
        <Image alt="" fill sizes="44px" src={notification.actor_avatar} unoptimized />
      </div>
    );
  }
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sportNavy text-xs font-black text-white">
      {notification.actor_name ? getInitials(notification.actor_name) : getCategoryInitials(notification.category)}
    </div>
  );
}

function NotificationSkeletons() {
  return (
    <div className="sport-loading-inline-panel min-h-[16rem]" aria-label="Loading notifications">
      <LoadingIndicator label="Loading notifications" />
    </div>
  );
}

function getFilterParams(filter: FilterKey) {
  if (filter === "UNSEEN") return { unseen: true };
  if (filter === "ACTION") return { action_required: true };
  if (["TEAMS", "CHALLENGES", "MATCHES", "BOOKINGS", "SYSTEM"].includes(filter)) {
    return { category: filter };
  }
  return {};
}

function getActionClass(style: NotificationAction["style"]) {
  if (style === "danger") {
    return "min-h-10 rounded-md border border-red-200 bg-white px-3.5 py-2 text-xs font-black text-red-600 hover:bg-red-50 disabled:opacity-60";
  }
  if (style === "secondary") {
    return "min-h-10 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-black text-sportNavy hover:border-green-300 hover:text-sportGreen disabled:opacity-60";
  }
  return "min-h-10 rounded-md bg-sportGreen px-3.5 py-2 text-xs font-black text-white hover:bg-green-700 disabled:bg-slate-400";
}

function PriorityBadge({ label }: { label: string }) {
  return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black uppercase text-red-700">{label}</span>;
}

function StatusBadge({ status }: { status: SportSpotNotification["action_status"] }) {
  const styles = status === "ACCEPTED" || status === "COMPLETED"
    ? "bg-green-100 text-green-800"
    : status === "PENDING"
      ? "bg-amber-100 text-amber-800"
      : "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${styles}`}>
      {status.toLowerCase()}
    </span>
  );
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function getCategoryInitials(category: NotificationCategory) {
  if (category === "BOOKINGS") return "BK";
  if (category === "TEAMS") return "TM";
  if (category === "CHALLENGES") return "CH";
  if (category === "MATCHES") return "MT";
  return "SS";
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
      <path d="M15 17H9m9-2v-4a6 6 0 1 0-12 0v4l-2 2h16l-2-2Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}
