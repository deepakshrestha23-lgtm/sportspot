"""Explainable, profile-based recommendations for public matchmaking games.

This is intentionally deterministic.  Discovery remains the source of truth
for filtering and lifecycle state; this module only ranks the already eligible
results when a player explicitly chooses the recommended sort.
"""

from collections import Counter

from django.utils import timezone

from players.models import PlayerProfile

from .models import ACTIVE_PARTICIPANT_STATUSES, Game, GameParticipant
from .services import player_has_overlapping_commitment


MATCH_WEIGHTS = {
    "availability": 30,
    "location": 25,
    "skill": 20,
    "role": 15,
    # There is no structured game-mood preference on PlayerProfile yet.  Keep
    # this neutral so recommendations never infer a preference from free text.
    "game_preference": 10,
}

SKILL_RANK = {
    PlayerProfile.SkillLevel.BEGINNER: 0,
    PlayerProfile.SkillLevel.INTERMEDIATE: 1,
    PlayerProfile.SkillLevel.ADVANCED: 2,
    Game.SkillLevel.OPEN: -1,
}

DAY_CODES = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")
PERIOD_BOUNDS = {
    "MORNING": (0, 12),
    "AFTERNOON": (12, 17),
    "EVENING": (17, 24),
}

ACTIVE_REQUEST_STATUSES = {"PENDING", "WAITLISTED", "INVITED", "ACCEPTED"}

MISSING_PROFILE_LABELS = {
    "location": "home district",
    "availability_days": "available days",
    "availability_time_periods": "preferred time",
    "skill_level": "skill level",
    "preferred_cricksal_role": "playing role",
}


def recommend_games_for_player(player, games):
    """Return `(ranked_games, metadata)` for a player and public candidates.

    Hard safety rules (own listing, existing request/participation, schedule
    conflict, and an explicitly higher required skill) remove a candidate.
    Soft profile matches rank everything left.  Reliability and ratings are
    deliberately absent: they are trust and feedback signals, not a reason to
    hide a suitable game from discovery.
    """

    profile = PlayerProfile.objects.filter(user=player).first()
    if not profile:
        return list(games), {
            "available": False,
            "profile_complete": False,
            "missing": ["player profile"],
        }

    missing = _missing_profile_fields(profile)
    ranked = []
    for game in games:
        if not _is_recommendable_candidate(player, game):
            continue
        if not _is_skill_compatible(profile, game):
            continue

        factors = {
            "availability": _availability_fit(profile, game),
            "location": _location_fit(profile, game),
            "skill": _skill_fit(profile, game),
            "role": _role_fit(profile, game),
            "game_preference": 0.5,
        }
        score = sum(factors[name] * weight for name, weight in MATCH_WEIGHTS.items())
        ranked.append(
            {
                "game": game,
                "score": score,
                "recommendation": _recommendation_summary(profile, game, factors),
            }
        )

    ranked.sort(key=_ranking_key)
    return [item["game"] for item in ranked], {
        "available": True,
        "profile_complete": profile.is_profile_complete,
        "missing": missing,
        "matches": {str(item["game"].id): item["recommendation"] for item in ranked},
    }


def _ranking_key(item):
    game = item["game"]
    start_at = game.start_at
    published_at = game.published_at
    return (
        -item["score"],
        start_at.timestamp() if start_at else float("inf"),
        -(published_at.timestamp() if published_at else 0),
        game.id,
    )


def _is_recommendable_candidate(player, game):
    if game.status == Game.Status.FULL and not game.waitlist_enabled:
        return False
    if game.host_id == player.id:
        return False

    participants = list(game.participants.all())
    if any(
        participant.user_id == player.id and participant.status in ACTIVE_PARTICIPANT_STATUSES
        for participant in participants
    ):
        return False

    requests = list(game.join_requests.all())
    if any(
        join_request.player_id == player.id and join_request.status in ACTIVE_REQUEST_STATUSES
        for join_request in requests
    ):
        return False

    # Existing bookings, confirmed games, team fixtures, and reliability
    # commitments all use the same overlap guard as the join flow.
    return not player_has_overlapping_commitment(player, game.start_at, game.end_at)


def _is_skill_compatible(profile, game):
    required = SKILL_RANK.get(game.min_skill_level)
    current = SKILL_RANK.get(profile.skill_level)
    if required is None or current is None:
        return True
    return game.min_skill_level == Game.SkillLevel.OPEN or current >= required


def _availability_fit(profile, game):
    start_at = game.start_at
    if not start_at:
        return 0.5

    days = {_normalise_choice(value) for value in (profile.availability_days or [])}
    periods = {_normalise_choice(value) for value in (profile.availability_time_periods or [])}
    if not days and not periods:
        return 0.5

    local_start = timezone.localtime(start_at)
    day_match = DAY_CODES[local_start.weekday()] in days
    period = _period_for_hour(local_start.hour)
    period_match = "FLEXIBLE" in periods or period in periods

    if day_match and period_match:
        return 1.0
    if day_match or period_match:
        return 0.65
    return 0.15


def _location_fit(profile, game):
    player_location = _normalise_text(profile.location)
    if not player_location:
        return 0.5

    targets = {
        _normalise_text(value)
        for value in (
            game.preferred_district,
            game.preferred_area,
            game.booking.venue.city if game.booking_id else "",
            game.booking.venue.area if game.booking_id else "",
        )
        if value
    }
    if not targets:
        return 0.5
    if player_location in targets:
        return 1.0
    if any(player_location in target or target in player_location for target in targets):
        return 0.8
    return 0.2


def _skill_fit(profile, game):
    if game.min_skill_level == Game.SkillLevel.OPEN:
        return 1.0
    current = SKILL_RANK.get(profile.skill_level)
    required = SKILL_RANK.get(game.min_skill_level)
    if current is None or required is None:
        return 0.5
    return 1.0 if current == required else 0.85


def _role_fit(profile, game):
    preferred_role = profile.preferred_cricksal_role
    requirements = list(game.role_requirements.all())
    if not requirements:
        return 0.5
    if preferred_role == PlayerProfile.CricksalRole.NONE:
        return 0.65

    active_temporary = [
        participant
        for participant in game.participants.all()
        if participant.status in ACTIVE_PARTICIPANT_STATUSES
        and participant.participant_type in [
            GameParticipant.ParticipantType.TEMPORARY,
            GameParticipant.ParticipantType.GUEST,
        ]
    ]
    filled_by_role = Counter(participant.role for participant in active_temporary)
    exact_available = any(
        requirement.role == preferred_role
        and filled_by_role[requirement.role] < requirement.required_count
        for requirement in requirements
    )
    any_available = any(
        requirement.role == "ANY"
        and filled_by_role[requirement.role] < requirement.required_count
        for requirement in requirements
    )
    if exact_available:
        return 1.0
    if any_available:
        return 0.8
    if any(requirement.role == preferred_role for requirement in requirements):
        return 0.25
    return 0.45


def _recommendation_summary(profile, game, factors):
    reasons = []
    if factors["availability"] >= 0.99:
        reasons.append("Fits your availability")
    elif factors["availability"] >= 0.6:
        reasons.append("Works with part of your availability")

    if factors["location"] >= 0.8:
        reasons.append("In your preferred district")

    if factors["role"] >= 0.95 and profile.preferred_cricksal_role != PlayerProfile.CricksalRole.NONE:
        reasons.append(f"Needs your preferred role: {_role_label(profile.preferred_cricksal_role)}")
    elif factors["role"] >= 0.75:
        reasons.append("Flexible role opening")

    if factors["skill"] >= 0.99:
        reasons.append("Open to your skill level")
    elif factors["skill"] >= 0.8:
        reasons.append("Within your skill range")

    if game.is_booking_verified:
        reasons.append("Court already confirmed")
    elif game.available_spots > 0:
        reasons.append(f"{game.available_spots} spot{'s' if game.available_spots != 1 else ''} still open")

    if not reasons:
        reasons.append("A suitable open game for your profile")

    reasons = reasons[:3]
    score = factors["availability"] * MATCH_WEIGHTS["availability"]
    score += factors["location"] * MATCH_WEIGHTS["location"]
    score += factors["skill"] * MATCH_WEIGHTS["skill"]
    score += factors["role"] * MATCH_WEIGHTS["role"]
    score += factors["game_preference"] * MATCH_WEIGHTS["game_preference"]
    if score >= 80:
        fit_label = "Strong fit"
    elif score >= 60:
        fit_label = "Good fit"
    else:
        fit_label = "Worth a look"
    return {"fit_label": fit_label, "reasons": reasons}


def _missing_profile_fields(profile):
    missing = []
    checks = {
        "location": bool(str(profile.location or "").strip()),
        "availability_days": bool(profile.availability_days),
        "availability_time_periods": bool(profile.availability_time_periods),
        "skill_level": bool(profile.skill_level),
        "preferred_cricksal_role": profile.preferred_cricksal_role != PlayerProfile.CricksalRole.NONE,
    }
    for field, present in checks.items():
        if not present:
            missing.append(MISSING_PROFILE_LABELS[field])
    return missing


def _normalise_choice(value):
    return str(value or "").strip().upper().replace("-", "_").replace(" ", "_")


def _normalise_text(value):
    return " ".join(str(value or "").strip().casefold().split())


def _period_for_hour(hour):
    for period, (start_hour, end_hour) in PERIOD_BOUNDS.items():
        if start_hour <= hour < end_hour:
            return period
    return "EVENING"


def _role_label(role):
    return {
        "BATSMAN": "Batsman",
        "BOWLER": "Bowler",
        "ALL_ROUNDER": "All-rounder",
        "WICKETKEEPER": "Wicketkeeper",
    }.get(role, "your role")
