const DEFAULT_API_URL = "http://127.0.0.1:8000";

function isLocalHostname(hostname: string) {
  if (["localhost", "127.0.0.1", "::1"].includes(hostname)) return true;
  return /^(10|192\.168|172\.(1[6-9]|2\d|3[0-1]))(?:\.\d{1,3}){2}$/.test(hostname);
}

function isLoopbackApiUrl(value: string) {
  try {
    return isLocalHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}

function getConfiguredApiUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;

  // NEXT_PUBLIC_* values are compiled into browser bundles. If an old build
  // was created with the local .env.local value, recover on the public host
  // instead of sending authenticated requests to the user's own device.
  if (
    typeof window !== "undefined" &&
    !isLocalHostname(window.location.hostname) &&
    isLoopbackApiUrl(configuredUrl)
  ) {
    const hostname = window.location.hostname.startsWith("www.")
      ? window.location.hostname.slice(4)
      : window.location.hostname;
    return `${window.location.protocol}//api.${hostname}`;
  }

  return configuredUrl;
}

export function getApiBaseUrl() {
  const configuredUrl = getConfiguredApiUrl().replace(/\/+$/, "");

  try {
    const url = new URL(configuredUrl);
    return url.toString().replace(/\/+$/, "");
  } catch {
    return configuredUrl;
  }
}

export function getMediaSrc(value?: string | null) {
  const rawValue = value?.trim();
  if (!rawValue) return "";
  if (rawValue.startsWith("blob:") || rawValue.startsWith("data:")) return rawValue;

  try {
    const parsedUrl = new URL(rawValue);
    return parsedUrl.toString();
  } catch {
    // Accept both Django media URLs and legacy storage paths. Older API
    // responses may contain /team_photos/... instead of /media/team_photos/...
    // and those should still resolve against the API host.
    const normalizedPath = rawValue.startsWith("/media/")
      ? rawValue
      : rawValue.startsWith("media/")
        ? `/${rawValue}`
        : rawValue.startsWith("/")
          ? `/media${rawValue}`
          : `/media/${rawValue}`;
    return `${getApiBaseUrl()}${normalizedPath}`;
  }
}
