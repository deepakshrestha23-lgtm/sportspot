"use client";

import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { api, refreshAccessTokenForRealtime } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateTimeInNepal } from "@/lib/dates";
import { getGameChatWebSocketUrl } from "@/lib/realtime";
import type { GameChatMessage, GameChatResponse } from "@/types/matchmaking";

type ConnectionState = "connecting" | "connected" | "offline";

export default function GameRoomChat({
  canSend,
  embedded = false,
  gameId,
  onClose,
}: {
  canSend: boolean;
  embedded?: boolean;
  gameId: number;
  onClose?: () => void;
}) {
  const [messages, setMessages] = useState<GameChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [chatError, setChatError] = useState("");
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const messagesRef = useRef<GameChatMessage[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  function addMessage(message: GameChatMessage) {
    setMessages((current) => mergeMessages(current, [message]));
    if (!shouldStickToBottomRef.current) setHasNewMessages(true);
  }

  useEffect(() => {
    let active = true;

    async function loadMessages() {
      setIsLoading(true);
      setChatError("");
      try {
        const response = await api.get<GameChatResponse>(`/api/matchmaking/games/${gameId}/chat/`, { params: { limit: 50 } });
        if (!active) return;
        setMessages((current) => mergeMessages(current, response.data.messages));
        setHasMore(response.data.has_more);
      } catch (requestError) {
        if (active) setChatError(getApiErrorMessage(requestError, "We could not load the game chat."));
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadMessages();
    return () => { active = false; };
  }, [gameId]);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let reconnectAttempt = 0;

    function clearTimers() {
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
        setConnectionState("offline");
        return;
      }

      clearTimers();
      setConnectionState("connecting");
      socket = new WebSocket(getGameChatWebSocketUrl(gameId));
      socketRef.current = socket;

      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: "authenticate", access_token: accessToken }));
      };

      socket.onmessage = (event) => {
        let payload: { type?: string; message?: GameChatMessage | string };
        try {
          payload = JSON.parse(event.data) as typeof payload;
        } catch {
          return;
        }

        if (payload.type === "ready") {
          reconnectAttempt = 0;
          setConnectionState("connected");
          heartbeatTimer = window.setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
          }, 30000);
          return;
        }

        if (payload.type === "chat.message" && payload.message && typeof payload.message !== "string") {
          addMessage(payload.message);
          return;
        }

        if (payload.type === "chat.error") {
          setChatError(typeof payload.message === "string" ? payload.message : "We could not send that message.");
          setIsSending(false);
        }
      };

      socket.onerror = () => socket?.close();
      socket.onclose = async (event) => {
        clearTimers();
        socketRef.current = null;
        setConnectionState("offline");
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
      clearTimers();
      socketRef.current = null;
      socket?.close(1000, "Game room closed");
    };
  }, [gameId]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !shouldStickToBottomRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    const isAtBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    shouldStickToBottomRef.current = isAtBottom;
    if (isAtBottom) setHasNewMessages(false);
  }

  async function loadOlderMessages() {
    const firstMessage = messagesRef.current[0];
    if (!firstMessage || isLoadingMore || !hasMore) return;
    const element = scrollRef.current;
    const previousHeight = element?.scrollHeight || 0;
    setIsLoadingMore(true);
    try {
      const response = await api.get<GameChatResponse>(`/api/matchmaking/games/${gameId}/chat/`, { params: { limit: 50, before: firstMessage.id } });
      setMessages((current) => mergeMessages(current, response.data.messages));
      setHasMore(response.data.has_more);
      window.requestAnimationFrame(() => {
        if (element) element.scrollTop += element.scrollHeight - previousHeight;
      });
    } catch (requestError) {
      setChatError(getApiErrorMessage(requestError, "We could not load earlier messages."));
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!canSend || !body || isSending) return;

    const clientMessageId = createClientMessageId();
    setIsSending(true);
    setChatError("");
    const socket = socketRef.current;
    if (connectionState === "connected" && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "message.send", body, client_message_id: clientMessageId }));
      setDraft("");
      setIsSending(false);
      return;
    }

    try {
      const response = await api.post<{ message: GameChatMessage }>(`/api/matchmaking/games/${gameId}/chat/`, { body, client_message_id: clientMessageId });
      addMessage(response.data.message);
      setDraft("");
    } catch (requestError) {
      setChatError(getApiErrorMessage(requestError, "We could not send that message."));
    } finally {
      setIsSending(false);
    }
  }

  function jumpToLatest() {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    shouldStickToBottomRef.current = true;
    setHasNewMessages(false);
  }

  return (
    <section className={embedded ? "flex min-h-0 flex-col bg-white p-4 sm:p-5" : "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"} aria-labelledby="game-chat-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="sport-eyebrow">Live coordination</p>
          <h2 className="mt-1 text-xl font-black text-sportNavy" id="game-chat-heading">Game chat</h2>
          <p className="mt-1 text-sm font-semibold text-slate-600">Coordinate arrival, lineup changes, and match-day details with the players in this room.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-black ${connectionState === "connected" ? "bg-green-50 text-green-800" : connectionState === "connecting" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
            <span aria-hidden="true">●</span> {connectionState === "connected" ? "Live" : connectionState === "connecting" ? "Connecting" : "Offline · retrying"}
          </span>
          {onClose ? <button aria-label="Close game chat" className="sport-icon-button" onClick={onClose} title="Close chat" type="button"><CloseIcon /></button> : null}
        </div>
      </div>

      {chatError ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800" role="alert">{chatError}</p> : null}

      <div className="relative mt-4">
        <div className="h-[22rem] overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3" onScroll={handleScroll} ref={scrollRef}>
          {hasMore ? <div className="mb-3 text-center"><button className="text-xs font-black text-sportGreen underline underline-offset-2 disabled:opacity-50" disabled={isLoadingMore} onClick={() => void loadOlderMessages()} type="button">{isLoadingMore ? "Loading earlier messages..." : "Load earlier messages"}</button></div> : null}
          {isLoading ? <div className="space-y-3" aria-label="Loading chat" role="status"><div className="h-12 w-3/4 animate-pulse rounded-xl bg-white" /><div className="ml-auto h-12 w-2/3 animate-pulse rounded-xl bg-green-100" /></div> : messages.length ? <div className="space-y-3">{messages.map((message) => <ChatMessage key={message.id} message={message} />)}</div> : <div className="flex h-full flex-col items-center justify-center px-6 text-center"><p className="font-black text-sportNavy">No messages yet</p><p className="mt-1 max-w-sm text-sm font-semibold leading-6 text-slate-500">Start with the arrival time, equipment, or who is bringing the ball.</p></div>}
        </div>
        {hasNewMessages ? <button className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-green-200 bg-white px-3 py-1.5 text-xs font-black text-sportGreen shadow-sm" onClick={jumpToLatest} type="button">New messages</button> : null}
      </div>

      {canSend ? <form className="mt-3 flex items-end gap-2" onSubmit={sendMessage}>
        <label className="min-w-0 flex-1"><span className="sr-only">Write a message</span><textarea className="min-h-12 w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-sportNavy outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100" maxLength={1000} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Message the game room..." value={draft} /></label>
        <button className="min-h-12 shrink-0 rounded-xl bg-sportGreen px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={!draft.trim() || isSending} type="submit">{isSending ? "Sending..." : "Send"}</button>
      </form> : <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">This chat is read-only because the game is closed. You can still review the conversation.</p>}
      {canSend ? <p className="mt-2 text-right text-xs font-semibold text-slate-400">{draft.length}/1,000 · Enter to send</p> : null}
    </section>
  );
}

function CloseIcon() {
  return <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
}

function ChatMessage({ message }: { message: GameChatMessage }) {
  const initials = message.sender_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <div className={`flex items-end gap-2 ${message.is_mine ? "justify-end" : ""}`}>
    {!message.is_mine ? <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 text-xs font-black text-green-800">{initials || "SP"}</span> : null}
    <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 ${message.is_mine ? "rounded-br-md bg-sportGreen text-white" : "rounded-bl-md bg-white text-sportNavy shadow-sm"}`}>
      {!message.is_mine ? <p className="text-xs font-black text-green-800">{message.sender_name}</p> : null}
      <p className="whitespace-pre-wrap break-words text-sm font-semibold leading-5">{message.body}</p>
      <p className={`mt-1 text-[0.68rem] font-semibold ${message.is_mine ? "text-green-100" : "text-slate-400"}`}>{formatDateTimeInNepal(message.created_at, { dateStyle: "medium", timeStyle: "short" })}</p>
    </div>
  </div>;
}

function mergeMessages(current: GameChatMessage[], incoming: GameChatMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => byId.set(message.id, message));
  return Array.from(byId.values()).sort((left, right) => left.id - right.id);
}

function createClientMessageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
