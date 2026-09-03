from functools import lru_cache
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.conf import settings

from .reference_data import SPORTSPOT_AREAS_BY_DISTRICT, canonical_service_area


class LocationProviderError(Exception):
    """Raised when the configured location provider cannot answer safely."""


# SportSpot currently serves venues in Nepal. Keeping this boundary here stops
# an accidental search or pin outside the supported operating area.
NEPAL_BOUNDS = {
    "min_latitude": 26.3,
    "max_latitude": 30.5,
    "min_longitude": 80.0,
    "max_longitude": 88.3,
}


def validate_coordinates(latitude, longitude):
    try:
        latitude_value = float(latitude)
        longitude_value = float(longitude)
    except (TypeError, ValueError):
        raise LocationProviderError("Choose a valid venue location on the map.")

    if not (
        NEPAL_BOUNDS["min_latitude"] <= latitude_value <= NEPAL_BOUNDS["max_latitude"]
        and NEPAL_BOUNDS["min_longitude"] <= longitude_value <= NEPAL_BOUNDS["max_longitude"]
    ):
        raise LocationProviderError("Choose a venue location within Nepal.")
    return latitude_value, longitude_value


def _request_json(path, params):
    base_url = getattr(settings, "LOCATION_GEOCODER_URL", "").rstrip("/")
    if not base_url:
        raise LocationProviderError("Location search is not available right now.")

    request = Request(
        f"{base_url}/{path.lstrip('/')}?{urlencode(params)}",
        headers={
            "Accept": "application/json",
            "Accept-Language": "en",
            "User-Agent": getattr(settings, "LOCATION_GEOCODER_USER_AGENT", "SportSpot"),
        },
    )
    try:
        with urlopen(request, timeout=getattr(settings, "LOCATION_GEOCODER_TIMEOUT", 5)) as response:
            return json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
        raise LocationProviderError("Location search is temporarily unavailable. You can place the pin manually.") from exc


def _normalize_result(item):
    try:
        latitude, longitude = validate_coordinates(item.get("lat"), item.get("lon"))
    except LocationProviderError:
        return None
    address = item.get("address") if isinstance(item.get("address"), dict) else {}
    searchable = " ".join(
        str(value or "")
        for value in [item.get("display_name"), *address.values()]
    ).casefold()
    district = ""
    area = ""
    for supported_district, supported_areas in SPORTSPOT_AREAS_BY_DISTRICT.items():
        matched_area = next(
            (supported_area for supported_area in supported_areas if supported_area.casefold() in searchable),
            "",
        )
        if matched_area or supported_district.casefold() in searchable:
            district = supported_district
            area = matched_area
            break
    if not district:
        district = _first_address_value(address, "state_district", "county", "city_district")
        district = re.sub(r"\s+district$", "", district, flags=re.IGNORECASE).strip()
    if not area:
        area = _first_address_value(
            address,
            "neighbourhood",
            "suburb",
            "quarter",
            "village",
            "town",
            "municipality",
            "city",
        )
        if area.casefold() == district.casefold():
            area = ""
    service_area = canonical_service_area(
        area=area,
        district=district,
        latitude=latitude,
        longitude=longitude,
    )
    if service_area:
        district = service_area["district"]
        area = service_area["label"]
    return {
        "latitude": latitude,
        "longitude": longitude,
        "display_name": str(item.get("display_name") or "Venue location").strip(),
        "place_type": str(item.get("type") or item.get("class") or "place").strip(),
        "district": district,
        "area": area,
        "service_area_code": service_area["code"] if service_area else "",
    }


def _first_address_value(address, *keys):
    for key in keys:
        value = " ".join(str(address.get(key) or "").split()).strip(" ,")
        if value:
            return value[:120]
    return ""


def _search_variants(query):
    """Return precise, Nepal-scoped, and recognised-area fallback queries."""
    variants = [query]
    if not re.search(r"\bnepal\b", query, flags=re.IGNORECASE):
        variants.append(f"{query}, Nepal")
    normalized_query = query.casefold()
    existing = {value.casefold() for value in variants}
    for district, areas in SPORTSPOT_AREAS_BY_DISTRICT.items():
        for area in areas:
            if area.casefold() in normalized_query:
                fallback = f"{area}, {district}, Nepal"
                if fallback.casefold() not in existing:
                    variants.append(fallback)
                    existing.add(fallback.casefold())
    return variants


@lru_cache(maxsize=128)
def search_locations(query):
    normalized_query = " ".join(str(query or "").split())
    if len(normalized_query) < 3:
        return []

    results = []
    seen = set()
    for provider_query in _search_variants(normalized_query):
        data = _request_json(
            "search",
            {
                "q": provider_query,
                "format": "jsonv2",
                "addressdetails": 1,
                "countrycodes": "np",
                "limit": 5,
            },
        )
        if not isinstance(data, list):
            continue
        for item in data:
            result = _normalize_result(item)
            if not result:
                continue
            key = (result["latitude"], result["longitude"], result["display_name"])
            if key not in seen:
                seen.add(key)
                results.append(result)
        if results:
            break
    return results


@lru_cache(maxsize=256)
def reverse_location(latitude, longitude):
    latitude_value, longitude_value = validate_coordinates(latitude, longitude)
    data = _request_json(
        "reverse",
        {
            "lat": latitude_value,
            "lon": longitude_value,
            "format": "jsonv2",
            "addressdetails": 1,
            "zoom": 18,
        },
    )
    result = _normalize_result(data)
    if not result:
        raise LocationProviderError("We could not identify that map location. You can keep the pin and enter the address manually.")
    return result
