from collections import Counter
from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from django.db.models import Avg, Count

from .models import PlayerProfile, PlayerRating, PlayerRatingEligibility, ReliabilityEvent

MIN_RELIABILITY_SCORE = 60
MAX_RELIABILITY_SCORE = 100

COUNTER_UPDATES = {
    ReliabilityEvent.EventType.GAME_COMPLETED_ATTENDED: {"completed_matches_count": 1},
    ReliabilityEvent.EventType.GAME_LATE_CANCELLATION: {"late_cancellation_count": 1},
    ReliabilityEvent.EventType.GAME_NO_SHOW: {"no_show_count": 1},
}


def record_reliability_event(
    *,
    player,
    event_type,
    impact,
    title,
    description="",
    points_delta=0,
    related_entity_type="",
    related_entity_id=None,
    dedupe_key=None,
    metadata=None,
    occurred_at=None,
    created_by=None,
):
    """Record a sports-commitment reliability event for a player.

    This service is intentionally for game/team commitments only. Ordinary court
    booking cancellations should remain in booking history and refund records.
    """
    if not player or player.role != "PLAYER":
        return None, False

    with transaction.atomic():
        profile = PlayerProfile.objects.select_for_update().filter(user=player).first()
        if not profile:
            return None, False

        if dedupe_key:
            existing = ReliabilityEvent.objects.filter(dedupe_key=dedupe_key).first()
            if existing:
                return existing, False

        event_payload = {
            "player": player,
            "event_type": event_type,
            "impact": impact,
            "title": title,
            "description": description,
            "points_delta": points_delta,
            "related_entity_type": related_entity_type,
            "related_entity_id": related_entity_id,
            "dedupe_key": dedupe_key,
            "metadata": metadata or {},
            "created_by": created_by,
        }
        if occurred_at:
            event_payload["occurred_at"] = occurred_at

        event = ReliabilityEvent.objects.create(**event_payload)

        update_profile_reliability_from_event(profile, event)
        return event, True


def update_profile_reliability_from_event(profile, event):
    update_fields = []

    for field_name, increment in COUNTER_UPDATES.get(event.event_type, {}).items():
        setattr(profile, field_name, getattr(profile, field_name) + increment)
        update_fields.append(field_name)

    if event.points_delta:
        profile.reliability_score = min(
            MAX_RELIABILITY_SCORE,
            max(MIN_RELIABILITY_SCORE, profile.reliability_score + event.points_delta),
        )
        update_fields.append("reliability_score")

    if update_fields:
        update_fields.append("updated_at")
        profile.save(update_fields=list(dict.fromkeys(update_fields)))

def record_player_rating(
    *,
    rater,
    rated_player,
    rating,
    related_entity_type,
    related_entity_id,
    feedback_tags=None,
    comment="",
    metadata=None,
):
    """Record a verified participant rating.

    This is intentionally service-only for now. A public write API should be added
    only after completed games and rating eligibility are implemented.
    """
    if not rater or not rated_player or rater.role != "PLAYER" or rated_player.role != "PLAYER":
        return None, False
    if rater.id == rated_player.id:
        return None, False

    normalized_tags = normalize_feedback_tags(feedback_tags or [])

    with transaction.atomic():
        if not PlayerProfile.objects.select_for_update().filter(user=rated_player).exists():
            return None, False

        existing = PlayerRating.objects.filter(
            rater=rater,
            rated_player=rated_player,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
        ).first()
        if existing:
            return existing, False

        player_rating = PlayerRating.objects.create(
            rater=rater,
            rated_player=rated_player,
            rating=rating,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
            feedback_tags=normalized_tags,
            comment=str(comment or "").strip()[:500],
            metadata=metadata or {},
        )
        recalculate_player_average_rating(rated_player)
        return player_rating, True


def normalize_feedback_tags(tags):
    normalized = []
    for tag in tags:
        value = str(tag or "").strip().upper()
        if not value:
            continue
        if value not in PlayerRating.ALLOWED_FEEDBACK_TAGS:
            continue
        if value not in normalized:
            normalized.append(value)
    return normalized[:5]


def recalculate_player_average_rating(player):
    profile = PlayerProfile.objects.select_for_update().filter(user=player).first()
    if not profile:
        return None

    average = PlayerRating.objects.filter(rated_player=player).aggregate(value=Avg("rating"))["value"] or 0
    profile.average_rating = Decimal(str(average)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    profile.save(update_fields=["average_rating", "updated_at"])
    return profile.average_rating


def get_player_rating_summary(player):
    ratings_queryset = PlayerRating.objects.filter(rated_player=player)
    ratings = list(ratings_queryset.order_by("-created_at", "-id")[:50])
    rating_stats = ratings_queryset.aggregate(total=Count("id"), average=Avg("rating"))
    distribution_counts = {
        row["rating"]: row["count"]
        for row in ratings_queryset.values("rating").annotate(count=Count("id"))
    }
    total_ratings = rating_stats["total"] or 0
    average = rating_stats["average"] if total_ratings else None
    distribution = [{"rating": value, "count": distribution_counts.get(value, 0)} for value in [5, 4, 3, 2, 1]]
    tag_counter = Counter(tag for rating in ratings for tag in rating.feedback_tags)
    completed_contexts = (
        PlayerRating.objects.filter(rated_player=player)
        .values("related_entity_type", "related_entity_id")
        .distinct()
        .count()
    )

    return {
        "average": Decimal(str(average)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if average else None,
        "has_rating": total_ratings > 0,
        "total_ratings": total_ratings,
        "completed_games_represented": completed_contexts,
        "distribution": distribution,
        "feedback_tags": [format_feedback_tag(tag) for tag, _count in tag_counter.most_common(5)],
        "recent": [serialize_recent_rating(rating) for rating in ratings[:5]],
    }


def serialize_recent_rating(rating):
    return {
        "id": rating.id,
        "value": str(rating.rating),
        "related_game": format_related_rating_context(rating),
        "match_date": rating.created_at.isoformat(),
        "feedback_tags": [format_feedback_tag(tag) for tag in rating.feedback_tags],
        "comment": rating.comment,
    }


def format_feedback_tag(tag):
    labels = {
        "PUNCTUAL": "Punctual",
        "RESPECTFUL": "Respectful",
        "TEAM_PLAYER": "Team Player",
        "GOOD_COMMUNICATION": "Good Communication",
        "RELIABLE": "Reliable",
        "SPORTSMANLIKE": "Sportsmanlike",
    }
    return labels.get(tag, str(tag).replace("_", " ").title())


def format_related_rating_context(rating):
    context = rating.related_entity_type.replace("_", " ").title()
    return f"{context} #{rating.related_entity_id}"

def create_rating_eligibility(
    *,
    rater,
    rated_player,
    title,
    related_entity_type,
    related_entity_id,
    match_date=None,
    deadline_at=None,
    metadata=None,
):
    if not rater or not rated_player or rater.role != "PLAYER" or rated_player.role != "PLAYER":
        return None, False
    if rater.id == rated_player.id:
        return None, False

    with transaction.atomic():
        eligibility, created = PlayerRatingEligibility.objects.get_or_create(
            rater=rater,
            rated_player=rated_player,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
            defaults={
                "title": title,
                "match_date": match_date,
                "deadline_at": deadline_at,
                "metadata": metadata or {},
            },
        )
        return eligibility, created


def get_pending_rating_items(player):
    expire_due_rating_eligibilities(player)
    eligibilities = (
        PlayerRatingEligibility.objects.filter(rater=player, status=PlayerRatingEligibility.Status.PENDING)
        .select_related("rated_player", "rated_player__player_profile")
        .order_by("deadline_at", "-created_at", "id")[:10]
    )
    return [serialize_pending_rating_eligibility(eligibility) for eligibility in eligibilities]


def expire_due_rating_eligibilities(player=None):
    queryset = PlayerRatingEligibility.objects.filter(
        status=PlayerRatingEligibility.Status.PENDING,
        deadline_at__isnull=False,
        deadline_at__lte=timezone.now(),
    )
    if player:
        queryset = queryset.filter(rater=player)
    queryset.update(status=PlayerRatingEligibility.Status.EXPIRED, updated_at=timezone.now())


def submit_player_rating_eligibility(*, eligibility_id, rater, rating, feedback_tags=None, comment=""):
    expired_error = ""

    with transaction.atomic():
        eligibility = (
            PlayerRatingEligibility.objects.select_for_update()
            .select_related("rated_player")
            .filter(id=eligibility_id, rater=rater)
            .first()
        )
        if not eligibility:
            raise ValidationError("This rating request is no longer available.")
        if eligibility.status == PlayerRatingEligibility.Status.SUBMITTED:
            raise ValidationError("You have already submitted this rating.")
        if eligibility.status != PlayerRatingEligibility.Status.PENDING:
            raise ValidationError("This rating request is no longer active.")
        if eligibility.deadline_at and eligibility.deadline_at <= timezone.now():
            eligibility.status = PlayerRatingEligibility.Status.EXPIRED
            eligibility.save(update_fields=["status", "updated_at"])
            expired_error = "The rating period for this game has ended."
        else:
            player_rating, created = record_player_rating(
                rater=rater,
                rated_player=eligibility.rated_player,
                rating=rating,
                related_entity_type=eligibility.related_entity_type,
                related_entity_id=eligibility.related_entity_id,
                feedback_tags=feedback_tags or [],
                comment=comment,
                metadata={"eligibility_id": eligibility.id, **(eligibility.metadata or {})},
            )
            if not player_rating:
                raise ValidationError("We could not submit this rating. Please try again.")

            eligibility.status = PlayerRatingEligibility.Status.SUBMITTED
            eligibility.submitted_rating = player_rating
            eligibility.save(update_fields=["status", "submitted_rating", "updated_at"])
            return player_rating, created

    raise ValidationError(expired_error or "This rating request is no longer active.")

def serialize_pending_rating_eligibility(eligibility):
    rated_profile = getattr(eligibility.rated_player, "player_profile", None)
    return {
        "id": eligibility.id,
        "title": eligibility.title,
        "match_date": eligibility.match_date.isoformat() if eligibility.match_date else eligibility.created_at.isoformat(),
        "participants_awaiting_feedback": 1,
        "action_url": f"/dashboard/player/ratings?rate={eligibility.id}",
        "rated_player_name": eligibility.rated_player.full_name,
        "rated_player_sportspot_id": rated_profile.sportspot_id if rated_profile else "",
        "rated_player_role": rated_profile.get_preferred_cricksal_role_display() if rated_profile else "Cricksal player",
        "deadline_at": eligibility.deadline_at.isoformat() if eligibility.deadline_at else None,
        "related_entity_type": eligibility.related_entity_type,
        "related_entity_id": eligibility.related_entity_id,
    }
