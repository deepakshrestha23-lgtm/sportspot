import type { LoginResponse, User, UserRole } from "@/types/auth";

const ACCESS_TOKEN_KEY = "sportspot_access_token";
const REFRESH_TOKEN_KEY = "sportspot_refresh_token";
const USER_KEY = "sportspot_user";

const isBrowser = () => typeof window !== "undefined";

export function saveAuthSession(session: LoginResponse) {
  if (!isBrowser()) return;

  localStorage.setItem(ACCESS_TOKEN_KEY, session.access);
  localStorage.setItem(REFRESH_TOKEN_KEY, session.refresh);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
}

export function getAccessToken() {
  if (!isBrowser()) return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function saveAccessToken(accessToken: string) {
  if (!isBrowser()) return;
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
}

export function getRefreshToken() {
  if (!isBrowser()) return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}


export function saveCurrentUser(user: User) {
  if (!isBrowser()) return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function getCurrentUser(): User | null {
  if (!isBrowser()) return null;

  const storedUser = localStorage.getItem(USER_KEY);
  if (!storedUser) return null;

  try {
    return JSON.parse(storedUser) as User;
  } catch {
    clearAuthSession();
    return null;
  }
}

export function clearAuthSession() {
  if (!isBrowser()) return;

  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getDashboardPath(role: UserRole) {
  if (role === "COURT_OWNER") return "/dashboard/owner";
  if (role === "ADMIN") return "/dashboard/admin";
  return "/dashboard/player";
}
