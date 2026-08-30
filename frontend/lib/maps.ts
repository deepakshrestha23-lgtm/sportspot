type CoordinateValue = number | string | null | undefined;

const supportedMapHosts = [
  "maps.google.com",
  "maps.app.goo.gl",
  "goo.gl",
  "google.com",
  "openstreetmap.org",
  "maps.apple.com",
  "bing.com",
];

function parseCoordinate(value: CoordinateValue) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildVenueDirectionsHref(
  latitude: CoordinateValue,
  longitude: CoordinateValue,
  legacyUrl = "",
) {
  const parsedLatitude = parseCoordinate(latitude);
  const parsedLongitude = parseCoordinate(longitude);
  if (parsedLatitude !== null && parsedLongitude !== null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${parsedLatitude},${parsedLongitude}`)}`;
  }

  if (!legacyUrl) return "";
  try {
    const url = new URL(legacyUrl);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const isSupportedMap = supportedMapHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    return url.protocol === "https:" && isSupportedMap ? url.toString() : "";
  } catch {
    return "";
  }
}

export function isVenueMapUrl(value: string) {
  return Boolean(buildVenueDirectionsHref(null, null, value));
}
