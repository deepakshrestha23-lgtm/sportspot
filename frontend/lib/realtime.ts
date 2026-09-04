import { getApiBaseUrl } from "@/lib/media";

function getRealtimeBaseUrl() {
  return getApiBaseUrl();
}

export function getNotificationWebSocketUrl() {
  const url = new URL(getRealtimeBaseUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws/notifications/`;
  url.search = "";
  return url.toString();
}

export function getGameChatWebSocketUrl(gameId: number) {
  const url = new URL(getRealtimeBaseUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws/games/${gameId}/chat/`;
  url.search = "";
  return url.toString();
}

export function getTeamFixtureChatWebSocketUrl(fixtureId: number) {
  const url = new URL(getRealtimeBaseUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws/team-fixtures/${fixtureId}/chat/`;
  url.search = "";
  return url.toString();
}
