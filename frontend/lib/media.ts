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
    // APIs should return a public /media/... URL, but accept legacy FieldFile
    // storage names too so a missing prefix never turns a real image into a fallback.
    const normalizedPath = rawValue.startsWith("/")
      ? rawValue
      : rawValue.startsWith("media/")
        ? `/${rawValue}`
        : `/media/${rawValue}`;
    return `${getApiBaseUrl()}${normalizedPath}`;
  }
}
