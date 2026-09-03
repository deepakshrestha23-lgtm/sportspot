from math import asin, cos, radians, sin, sqrt


SPORTSPOT_DISTRICTS = ["Kathmandu", "Lalitpur", "Bhaktapur"]

# A service area is a stable planning zone, not a precise meeting point.  The
# coordinates are only used to translate a map click into the same controlled
# location vocabulary used by venues, filters, and recommendation ranking.
SPORTSPOT_SERVICE_AREAS = (
    {"code": "baneshwor", "label": "Baneshwor", "district": "Kathmandu", "latitude": 27.6914, "longitude": 85.3420, "aliases": ("new baneshwor",)},
    {"code": "boudha", "label": "Boudha", "district": "Kathmandu", "latitude": 27.7210, "longitude": 85.3610, "aliases": ("boudhanath",)},
    {"code": "chabahil", "label": "Chabahil", "district": "Kathmandu", "latitude": 27.7172, "longitude": 85.3462, "aliases": ()},
    {"code": "kageshwori", "label": "Kageshwori", "district": "Kathmandu", "latitude": 27.7004, "longitude": 85.4060, "aliases": ("kageshwori manohara",)},
    {"code": "kalanki", "label": "Kalanki", "district": "Kathmandu", "latitude": 27.6935, "longitude": 85.2807, "aliases": ()},
    {"code": "kirtipur", "label": "Kirtipur", "district": "Kathmandu", "latitude": 27.6798, "longitude": 85.2776, "aliases": ()},
    {"code": "koteshwor", "label": "Koteshwor", "district": "Kathmandu", "latitude": 27.6799, "longitude": 85.3480, "aliases": ("koteshwar",)},
    {"code": "maharajgunj", "label": "Maharajgunj", "district": "Kathmandu", "latitude": 27.7382, "longitude": 85.3292, "aliases": ()},
    {"code": "maitidevi", "label": "Maitidevi", "district": "Kathmandu", "latitude": 27.6988, "longitude": 85.3414, "aliases": ("maiti devi",)},
    {"code": "new-road", "label": "New Road", "district": "Kathmandu", "latitude": 27.7045, "longitude": 85.3133, "aliases": ("newroad",)},
    {"code": "thamel", "label": "Thamel", "district": "Kathmandu", "latitude": 27.7150, "longitude": 85.3123, "aliases": ()},
    {"code": "tripureshwor", "label": "Tripureshwor", "district": "Kathmandu", "latitude": 27.6978, "longitude": 85.3146, "aliases": ("tripureshwar",)},
    {"code": "gwarko", "label": "Gwarko", "district": "Lalitpur", "latitude": 27.6663, "longitude": 85.3336, "aliases": ("gwarko chowk",)},
    {"code": "imadol", "label": "Imadol", "district": "Lalitpur", "latitude": 27.6376, "longitude": 85.3421, "aliases": ()},
    {"code": "jawalakhel", "label": "Jawalakhel", "district": "Lalitpur", "latitude": 27.6700, "longitude": 85.3134, "aliases": ()},
    {"code": "lagankhel", "label": "Lagankhel", "district": "Lalitpur", "latitude": 27.6650, "longitude": 85.3221, "aliases": ()},
    {"code": "patan", "label": "Patan", "district": "Lalitpur", "latitude": 27.6730, "longitude": 85.3250, "aliases": ("patan dhoka",)},
    {"code": "pulchowk", "label": "Pulchowk", "district": "Lalitpur", "latitude": 27.6810, "longitude": 85.3160, "aliases": ()},
    {"code": "satdobato", "label": "Satdobato", "district": "Lalitpur", "latitude": 27.6500, "longitude": 85.3270, "aliases": ()},
    {"code": "bhaktapur-durbar-square", "label": "Bhaktapur Durbar Square", "district": "Bhaktapur", "latitude": 27.6729, "longitude": 85.4298, "aliases": ("bhaktapur durbar",)},
    {"code": "duwakot", "label": "Duwakot", "district": "Bhaktapur", "latitude": 27.6745, "longitude": 85.4680, "aliases": ()},
    {"code": "lokanthali", "label": "Lokanthali", "district": "Bhaktapur", "latitude": 27.6668, "longitude": 85.3629, "aliases": ()},
    {"code": "madhyapur-thimi", "label": "Madhyapur Thimi", "district": "Bhaktapur", "latitude": 27.6820, "longitude": 85.3870, "aliases": ("thimi",)},
    {"code": "suryabinayak", "label": "Suryabinayak", "district": "Bhaktapur", "latitude": 27.6600, "longitude": 85.4400, "aliases": ()},
)

SPORTSPOT_AREAS_BY_DISTRICT = {
    district: [area["label"] for area in SPORTSPOT_SERVICE_AREAS if area["district"] == district]
    for district in SPORTSPOT_DISTRICTS
}

SERVICE_AREA_BY_CODE = {area["code"]: area for area in SPORTSPOT_SERVICE_AREAS}


def _normalise_service_area_value(value):
    return " ".join(str(value or "").strip().casefold().replace("-", " ").split())


def _haversine_km(latitude_one, longitude_one, latitude_two, longitude_two):
    lat_one = radians(float(latitude_one))
    lat_two = radians(float(latitude_two))
    latitude_delta = lat_two - lat_one
    longitude_delta = radians(float(longitude_two) - float(longitude_one))
    haversine = sin(latitude_delta / 2) ** 2 + cos(lat_one) * cos(lat_two) * sin(longitude_delta / 2) ** 2
    return 6371.0088 * 2 * asin(sqrt(min(1.0, haversine)))


def canonical_service_area(*, code="", area="", district="", latitude=None, longitude=None, max_distance_km=18):
    """Return a controlled service area for a code, text value, or map point.

    Text values preserve compatibility with existing records and APIs.  New
    map-backed flows pass a point, which is accepted only within SportSpot's
    supported Kathmandu Valley operating zones.
    """
    normalised_code = str(code or "").strip().casefold()
    normalised_district = _normalise_service_area_value(district)
    if normalised_code:
        candidate = SERVICE_AREA_BY_CODE.get(normalised_code)
        if candidate and (
            not normalised_district
            or _normalise_service_area_value(candidate["district"]) == normalised_district
        ):
            return {**candidate, "distance_km": None}
        return None

    normalised_area = _normalise_service_area_value(area)
    if normalised_area:
        for candidate in SPORTSPOT_SERVICE_AREAS:
            candidate_values = {candidate["label"], *candidate["aliases"]}
            if (
                any(_normalise_service_area_value(value) == normalised_area for value in candidate_values)
                and (
                    not normalised_district
                    or _normalise_service_area_value(candidate["district"]) == normalised_district
                )
            ):
                return {**candidate, "distance_km": None}

    if latitude is None or longitude is None:
        return None
    try:
        latitude_value = float(latitude)
        longitude_value = float(longitude)
    except (TypeError, ValueError):
        return None

    candidates = [
        candidate
        for candidate in SPORTSPOT_SERVICE_AREAS
        if not normalised_district or _normalise_service_area_value(candidate["district"]) == normalised_district
    ]
    if not candidates:
        candidates = list(SPORTSPOT_SERVICE_AREAS)
    nearest = min(
        candidates,
        key=lambda candidate: _haversine_km(latitude_value, longitude_value, candidate["latitude"], candidate["longitude"]),
    )
    distance_km = _haversine_km(latitude_value, longitude_value, nearest["latitude"], nearest["longitude"])
    if distance_km > max_distance_km:
        return None
    return {**nearest, "distance_km": distance_km}


def service_area_distance_km(first, second):
    if not first or not second:
        return None
    return _haversine_km(first["latitude"], first["longitude"], second["latitude"], second["longitude"])

SPORTSPOT_FACILITIES = [
    "Parking",
    "Changing Room",
    "Washroom",
    "Drinking Water",
    "Lighting",
    "Seating",
    "Shower",
    "Locker",
    "Cafe",
    "Equipment Rental",
]

SPORTSPOT_TIME_PERIODS = [
    {"value": "morning", "label": "Morning", "start": "00:00", "end": "12:00", "description": "Before 12:00 PM"},
    {"value": "afternoon", "label": "Afternoon", "start": "12:00", "end": "17:00", "description": "12:00 PM to 5:00 PM"},
    {"value": "evening", "label": "Evening", "start": "17:00", "end": "23:59", "description": "After 5:00 PM"},
]

SPORTSPOT_DURATIONS = [60, 120, 180]

# Planning times are preferences used before a specific venue is selected.
# Actual bookability is checked later against the selected venue's slots.
SPORTSPOT_PLANNING_START_TIMES = [
    f"{hour:02d}:{minute:02d}"
    for hour in range(6, 24)
    for minute in (0, 30)
]

# Plan-first games use explicit cutoffs. These values describe the safe
# handoff window; they do not limit the host to a fixed number of hours.
SPORTSPOT_MATCHMAKING_DEADLINE_CONFIG = {
    "minimum_booking_lead_minutes": 60,
    "minimum_recruitment_to_booking_minutes": 30,
    "minimum_plan_lead_minutes": 120,
    "recommended_recruitment_lead_minutes": 24 * 60,
    "recommended_booked_game_recruitment_lead_minutes": 2 * 60,
    "recommended_booking_lead_minutes": 12 * 60,
    # A changed schedule needs a finite response window. The deadline is also
    # capped before the game starts so an unresolved participant cannot block
    # a valid roster at the last minute.
    "minimum_reconfirmation_notice_minutes": 30,
    "maximum_reconfirmation_response_hours": 24,
}
