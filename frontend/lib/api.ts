import axios from "axios";

import { clearAuthSession, getAccessToken, getRefreshToken, saveAccessToken } from "@/lib/auth";
import { getApiBaseUrl } from "@/lib/media";

export const api = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 15000,
});

const refreshClient = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 15000,
});

let refreshPromise: Promise<string> | null = null;
const retryableMethods = new Set(["get", "head", "options"]);

function refreshAccessToken(refreshToken: string) {
  if (!refreshPromise) {
    refreshPromise = refreshClient
      .post<{ access: string }>("/api/auth/token/refresh/", { refresh: refreshToken })
      .then((response) => response.data.access)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

export async function refreshAccessTokenForRealtime() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const accessToken = await refreshAccessToken(refreshToken);
    saveAccessToken(accessToken);
    return accessToken;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      clearAuthSession();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.assign("/login");
      }
    }
    return null;
  }
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  if (config.data instanceof FormData) {
    delete config.headers["Content-Type"];
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      originalRequest &&
      !error.response &&
      error.code !== "ERR_CANCELED" &&
      retryableMethods.has(String(originalRequest.method || "get").toLowerCase()) &&
      !originalRequest._sportspotNetworkRetry
    ) {
      originalRequest._sportspotNetworkRetry = true;
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      return api(originalRequest);
    }

    if (error.response?.status !== 401 || originalRequest?._retry) {
      return Promise.reject(error);
    }

    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      clearAuthSession();
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      const accessToken = await refreshAccessToken(refreshToken);
      saveAccessToken(accessToken);
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return api(originalRequest);
    } catch (refreshError) {
      clearAuthSession();

      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }

      return Promise.reject(refreshError);
    }
  },
);
