"""Deterministic, explainable ranking for court discovery results.

Discovery filters decide which venues a player can see. This module only
orders those already-valid cards when a signed-in player selects Recommended.
"""

from collections import Counter
from math import asin, cos, radians, sin, sqrt

from players.models import PlayerProfile

from .models import Booking
from .reference_data import canonical_service_area, service_area_distance_km


COURT_RECOMMENDATION_WEIGHTS = {
    "availability": 32,
    "location": 32,
    "schedule": 18,
    "price": 10,
    "familiarity": 8,
}

DAY_CODES = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")
PERIOD_BOUNDS = {
    "MORNING": (0, 12),
    "AFTERNOON": (12, 17),
    "EVENING": (17, 24),
}


def recommend_venue_cards_for_player(player, cards, params):
    """Rank public venue cards and attach short, player-facing reasons.

    The caller has already applied the requested date, time, duration, price,
    and location filters. Guests and non-player accounts retain the neutral
    availability-first discovery order.
    """

    if not getattr(player, "is_authenticated", False) or getattr(player, "role", "") != "PLAYER":
        return list(cards), _unavailable_metadata()

    profile = PlayerProfile.objects.filter(user=player).first()
    if not profile:
        return list(cards), _unavailable_metadata(missing=["player profile"])

    previous_venues = Counter(
        Booking.objects.filter(
            player=player,
            status__in=[Booking.BookingStatus.CONFIRMED, Booking.BookingStatus.COMPLETED],
        ).values_list("venue_id", flat=True)
    )
    available_prices = [float(card["starting_price"]) for card in cards if card.get("available_court_count") and card.get("starting_price") is not None]
    ranked = []

    for card in cards:
        score, recommendation = _score_card(profile, card, params, available_prices, previous_venues)
        ranked_card = {**card, "recommendation": recommendation}
        ranked.append({"card": ranked_card, "score": score})

    ranked.sort(key=_ranking_key)
    return [item["card"] for item in ranked], {
        "available": True,
        "profile_complete": profile.is_profile_complete,
        "missing": _missing_profile_fields(profile),
    }


def _score_card(profile, card, params, available_prices, previous_venues):
    availability = 1.0 if card.get("available_court_count", 0) > 0 else 0.05
    location, location_reason, distance_km = _location_fit(profile, card)
    schedule, schedule_reason = _schedule_fit(profile, card, params)
    price = _price_fit(card, available_prices)
    familiarity = min(previous_venues.get(card.get("id"), 0) / 2, 1.0)

    factors = {
        "availability": availability,
        "location": location,
        "schedule": schedule,
        "price": price,
        "familiarity": familiarity,
    }
    score = sum(factors[name] * weight for name, weight in COURT_RECOMMENDATION_WEIGHTS.items())

    reasons = []
    if availability >= 0.99:
        reasons.append("Available for your selected plan")
    if location_reason:
        reasons.append(location_reason)
    elif schedule_reason:
        reasons.append(schedule_reason)
    elif familiarity >= 0.5:
        reasons.append("A venue you have booked before")

    return score, {
        "fit_label": _fit_label(score),
        "reasons": reasons[:2],
        "distance_km": round(distance_km, 1) if distance_km is not None else None,
    }


def _ranking_key(item):
    card = item["card"]
    price = float(card["starting_price"]) if card.get("starting_price") is not None else float("inf")
    return (
        -item["score"],
        card.get("available_court_count", 0) <= 0,
        price,
        str(card.get("name") or "").casefold(),
        card.get("id", 0),
    )


def _location_fit(profile, card):
    if _has_confirmed_coordinates(profile) and card.get("location_confirmed") and card.get("latitude") is not None and card.get("longitude") is not None:
        distance_km = _haversine_km(profile.latitude, profile.longitude, card["latitude"], card["longitude"])
        radius = max(float(profile.travel_radius_km or 10), 1.0)
        if distance_km <= min(2, radius):
            return 1.0, f"{distance_km:.1f} km from your saved location", distance_km
        if distance_km <= radius:
            return 1.0 - (0.35 * ((distance_km - 2) / max(radius - 2, 1))), f"{distance_km:.1f} km from your saved location", distance_km
        if distance_km <= radius * 2:
            return 0.65 - (0.3 * ((distance_km - radius) / radius)), f"{distance_km:.1f} km from your saved location", distance_km
        return 0.15, f"{distance_km:.1f} km from your saved location", distance_km

    player_area = canonical_service_area(area=profile.preferred_area, district=profile.location)
    venue_area = canonical_service_area(area=card.get("area"), district=card.get("city"))
    if player_area and venue_area:
        if player_area["code"] == venue_area["code"]:
            return 1.0, "In your preferred playing area", None
        area_distance = service_area_distance_km(player_area, venue_area)
        if area_distance is not None and area_distance <= 3.5:
            return 0.82, "Near your preferred playing area", None
        if player_area["district"] == venue_area["district"]:
            return 0.58, "In your preferred district", None
        return 0.2, "", None
    return 0.5, "", None


def _schedule_fit(profile, card, params):
    days = {_normalise_choice(value) for value in profile.availability_days or []}
    periods = {_normalise_choice(value) for value in profile.availability_time_periods or []}
    if not days and not periods:
        return 0.5, ""

    day_match = DAY_CODES[params["date"].weekday()] in days
    selected_period = _selected_period(card, params)
    period_match = "FLEXIBLE" in periods or (selected_period and selected_period in periods)
    if day_match and period_match:
        return 1.0, f"Fits your {_period_label(selected_period).lower()} availability"
    if day_match or period_match:
        return 0.65, "Works with part of your usual availability"
    return 0.2, ""


def _selected_period(card, params):
    if params.get("time_window"):
        return str(params["time_window"]).upper()
    if params.get("start_time"):
        return _period_for_hour(params["start_time"].hour)
    next_time = str(card.get("next_available_time") or "")
    try:
        return _period_for_hour(int(next_time.split(":", 1)[0]))
    except (TypeError, ValueError):
        return ""


def _price_fit(card, available_prices):
    if card.get("available_court_count", 0) <= 0 or card.get("starting_price") is None or not available_prices:
        return 0.0
    low, high = min(available_prices), max(available_prices)
    if high <= low:
        return 0.7
    return 0.45 + (0.55 * ((high - float(card["starting_price"])) / (high - low)))


def _has_confirmed_coordinates(profile):
    return profile.location_confirmed and profile.latitude is not None and profile.longitude is not None


def _haversine_km(latitude_one, longitude_one, latitude_two, longitude_two):
    lat_one = radians(float(latitude_one))
    lat_two = radians(float(latitude_two))
    latitude_delta = lat_two - lat_one
    longitude_delta = radians(float(longitude_two) - float(longitude_one))
    haversine = sin(latitude_delta / 2) ** 2 + cos(lat_one) * cos(lat_two) * sin(longitude_delta / 2) ** 2
    return 6371.0088 * 2 * asin(sqrt(min(1.0, haversine)))


def _period_for_hour(hour):
    for period, (start_hour, end_hour) in PERIOD_BOUNDS.items():
        if start_hour <= hour < end_hour:
            return period
    return "EVENING"


def _period_label(period):
    return str(period or "preferred").replace("_", " ").title()


def _normalise_choice(value):
    return str(value or "").strip().upper().replace("-", "_").replace(" ", "_")


def _missing_profile_fields(profile):
    missing = []
    if not profile.location and not profile.preferred_area:
        missing.append("preferred playing area")
    if not profile.availability_days:
        missing.append("available days")
    if not profile.availability_time_periods:
        missing.append("preferred time")
    return missing


def _fit_label(score):
    if score >= 80:
        return "Strong fit"
    if score >= 60:
        return "Good fit"
    return "Worth a look"


def _unavailable_metadata(missing=None):
    return {
        "available": False,
        "profile_complete": False,
        "missing": missing or [],
    }
