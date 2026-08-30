const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export function getNotificationWebSocketUrl() {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws/notifications/`;
  url.search = "";
  return url.toString();
}

export function getGameChatWebSocketUrl(gameId: number) {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws/games/${gameId}/chat/`;
  url.search = "";
  return url.toString();
}

export function getTeamFixtureChatWebSocketUrl(fixtureId: number) {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws/team-fixtures/${fixtureId}/chat/`;
  url.search = "";
  return url.toString();
}
