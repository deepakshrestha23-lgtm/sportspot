type CoordinateValue = number | string | null | undefined;

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
    const hostname = url.hostname.toLowerCase();
    const isGoogleMaps = hostname === "maps.google.com" || hostname === "maps.app.goo.gl" || hostname.endsWith(".google.com");
    return url.protocol === "https:" && isGoogleMaps ? url.toString() : "";
  } catch {
    return "";
  }
}
