const DEFAULT_API_URL = "http://127.0.0.1:8000";

function getConfiguredApiUrl() {
  return process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;
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
