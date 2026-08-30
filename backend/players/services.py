from collections import Counter
from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from django.db.models import Avg, Count

from .models import (
    ParticipationCommitment,
    PlayerProfile,
    PlayerRating,
    PlayerRatingEligibility,
    ReliabilityEvent,
)

MIN_RELIABILITY_SCORE = 60
MAX_RELIABILITY_SCORE = 100
LATE_CANCELLATION_HOURS = 4
ATTENDANCE_REVIEW_HOURS = 24
RELIABILITY_HISTORY_SIZE = 20
RELIABILITY_SCORE_VALUES = {
    ParticipationCommitment.Status.ATTENDED: 100,
    ParticipationCommitment.Status.LATE_CANCELLED: 60,
    ParticipationCommitment.Status.FINALIZED_NO_SHOW: 0,
}

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


def create_participation_commitment(
    *,
    player,
    source_type,
    source_id,
    source_participant_id,
    start_at,
    end_at,
    metadata=None,
    created_by=None,
):
    """Create one idempotent commitment after a schedule is truly confirmed.

    This is intentionally source-agnostic. Matchmaking games and team fixtures
    call it from their own services, while reliability and dispute handling stay
    in one place.
    """
    if not player or player.role != "PLAYER" or not start_at or not end_at:
        return None, False

    now = timezone.now()
    if timezone.is_naive(start_at):
        start_at = timezone.make_aware(start_at, timezone.get_current_timezone())
    if timezone.is_naive(end_at):
        end_at = timezone.make_aware(end_at, timezone.get_current_timezone())
    if end_at <= start_at:
        raise ValidationError("A game commitment must have a valid time window.")

    with transaction.atomic():
        profile = PlayerProfile.objects.select_for_update().filter(user=player).first()
        if not profile:
            return None, False
        latest = (
            ParticipationCommitment.objects.select_for_update()
            .filter(player=player, source_type=source_type, source_id=source_id)
            .order_by("-source_version", "-id")
            .first()
        )
        if latest and latest.status in {
            ParticipationCommitment.Status.COMMITTED,
            ParticipationCommitment.Status.ATTENDANCE_PENDING,
            ParticipationCommitment.Status.NO_SHOW_REPORTED,
        }:
            if latest.start_at == start_at and latest.end_at == end_at:
                return latest, False
            latest.status = ParticipationCommitment.Status.VOID
            latest.resolved_at = now
            latest.resolved_by = created_by
            latest.save(update_fields=["status", "resolved_at", "resolved_by", "updated_at"])

        version = (latest.source_version + 1) if latest else 1
        commitment = ParticipationCommitment.objects.create(
            player=player,
            source_type=source_type,
            source_id=source_id,
            source_participant_id=source_participant_id,
            source_version=version,
            start_at=start_at,
            end_at=end_at,
            late_cutoff_at=start_at - timezone.timedelta(hours=LATE_CANCELLATION_HOURS),
            status=ParticipationCommitment.Status.COMMITTED,
            metadata=metadata or {},
        )
        return commitment, True


def _latest_commitment_for_source(*, source_type, source_id, player_id=None, commitment_id=None, lock=True):
    queryset = ParticipationCommitment.objects
    if lock:
        queryset = queryset.select_for_update()
    if commitment_id:
        return queryset.filter(pk=commitment_id).first()
    queryset = queryset.filter(source_type=source_type, source_id=source_id)
    if player_id:
        queryset = queryset.filter(player_id=player_id)
    return queryset.order_by("-source_version", "-id").first()


def _record_commitment_outcome(commitment, *, outcome, actor=None):
    event_type = {
        ParticipationCommitment.Status.ATTENDED: ReliabilityEvent.EventType.GAME_COMPLETED_ATTENDED,
        ParticipationCommitment.Status.LATE_CANCELLED: ReliabilityEvent.EventType.GAME_LATE_CANCELLATION,
        ParticipationCommitment.Status.FINALIZED_NO_SHOW: ReliabilityEvent.EventType.GAME_NO_SHOW,
    }.get(outcome)
    if not event_type:
        return None, False

    title = {
        ParticipationCommitment.Status.ATTENDED: "Attended a confirmed game",
        ParticipationCommitment.Status.LATE_CANCELLED: "Cancelled a confirmed game late",
        ParticipationCommitment.Status.FINALIZED_NO_SHOW: "Missed a confirmed game",
    }[outcome]
    description = {
        ParticipationCommitment.Status.ATTENDED: "Attendance was finalized for a completed SportSpot game.",
        ParticipationCommitment.Status.LATE_CANCELLED: "The player cancelled after the four-hour commitment cutoff.",
        ParticipationCommitment.Status.FINALIZED_NO_SHOW: "A no-show report remained undisputed through the review window.",
    }[outcome]
    event, created = record_reliability_event(
        player=commitment.player,
        event_type=event_type,
        impact=(ReliabilityEvent.Impact.POSITIVE if outcome == ParticipationCommitment.Status.ATTENDED else ReliabilityEvent.Impact.NEGATIVE),
        title=title,
        description=description,
        points_delta=0,
        related_entity_type=commitment.source_type.lower(),
        related_entity_id=commitment.source_id,
        dedupe_key=f"commitment:{commitment.id}:outcome:{outcome.lower()}",
        metadata={
            **(commitment.metadata or {}),
            "commitment_id": commitment.id,
            "commitment_outcome": outcome,
        },
        occurred_at=commitment.resolved_at or commitment.attendance_recorded_at or timezone.now(),
        created_by=actor,
    )
    if created:
        recompute_reliability_profile(commitment.player)
    return event, created


@transaction.atomic
def cancel_participation_commitment(*, source_type, source_id, player, actor=None, now=None, reason=""):
    """Resolve a player withdrawal without confusing it with a no-show."""
    now = now or timezone.now()
    commitment = _latest_commitment_for_source(
        source_type=source_type,
        source_id=source_id,
        player_id=getattr(player, "id", None),
    )
    if not commitment or commitment.status != ParticipationCommitment.Status.COMMITTED:
        return commitment, False
    commitment.status = (
        ParticipationCommitment.Status.LATE_CANCELLED
        if now >= commitment.late_cutoff_at
        else ParticipationCommitment.Status.CANCELLED_EARLY
    )
    commitment.resolved_at = now
    commitment.resolved_by = actor or player
    commitment.metadata = {**(commitment.metadata or {}), "cancellation_reason": str(reason or "").strip()[:500]}
    commitment.save(update_fields=["status", "resolved_at", "resolved_by", "metadata", "updated_at"])
    if commitment.status == ParticipationCommitment.Status.LATE_CANCELLED:
        _record_commitment_outcome(commitment, outcome=commitment.status, actor=actor or player)
    return commitment, True


@transaction.atomic
def void_participation_commitment(*, source_type, source_id, player_id=None, commitment_id=None, actor=None, reason=""):
    """Remove a commitment without assigning blame to the player."""
    commitment = _latest_commitment_for_source(
        source_type=source_type,
        source_id=source_id,
        player_id=player_id,
        commitment_id=commitment_id,
    )
    if not commitment or commitment.status not in {
        ParticipationCommitment.Status.COMMITTED,
        ParticipationCommitment.Status.ATTENDANCE_PENDING,
        ParticipationCommitment.Status.NO_SHOW_REPORTED,
    }:
        return commitment, False
    commitment.status = ParticipationCommitment.Status.VOID
    commitment.resolved_at = timezone.now()
    commitment.resolved_by = actor
    commitment.metadata = {
        **(commitment.metadata or {}),
        "void_reason": str(reason or "outside_player_control")[:500],
    }
    commitment.save(update_fields=["status", "resolved_at", "resolved_by", "metadata", "updated_at"])
    return commitment, True


@transaction.atomic
def record_commitment_attendance(*, commitment_id, actor, attended):
    """Record attendance, keeping a no-show report reversible for review."""
    commitment = ParticipationCommitment.objects.select_for_update().select_related("player").filter(pk=commitment_id).first()
    if not commitment:
        raise ValidationError("This attendance record is no longer available.")
    if commitment.status == ParticipationCommitment.Status.NO_SHOW_REPORTED:
        if not attended:
            commitment._idempotent_replay = True
            return commitment
        raise ValidationError("This no-show report is under review and cannot be changed by the host.")
    if commitment.status == ParticipationCommitment.Status.DISPUTED:
        raise ValidationError("This attendance report is under review and cannot be changed by the host.")
    if commitment.status in {
        ParticipationCommitment.Status.CANCELLED_EARLY,
        ParticipationCommitment.Status.LATE_CANCELLED,
        ParticipationCommitment.Status.ATTENDED,
        ParticipationCommitment.Status.FINALIZED_NO_SHOW,
        ParticipationCommitment.Status.EXCUSED,
        ParticipationCommitment.Status.VOID,
    }:
        if attended and commitment.status == ParticipationCommitment.Status.ATTENDED:
            commitment._idempotent_replay = True
            return commitment
        raise ValidationError("Attendance for this commitment has already been resolved.")

    now = timezone.now()
    commitment.attendance_recorded_by = actor
    commitment.attendance_recorded_at = now
    if attended:
        commitment.status = ParticipationCommitment.Status.ATTENDED
        commitment.review_deadline_at = None
        commitment.resolved_at = now
        commitment.resolved_by = actor
        commitment.save(update_fields=[
            "status", "attendance_recorded_by", "attendance_recorded_at",
            "review_deadline_at", "resolved_at", "resolved_by", "updated_at",
        ])
        _record_commitment_outcome(commitment, outcome=commitment.status, actor=actor)
    else:
        commitment.status = ParticipationCommitment.Status.NO_SHOW_REPORTED
        commitment.review_deadline_at = now + timezone.timedelta(hours=ATTENDANCE_REVIEW_HOURS)
        commitment.save(update_fields=[
            "status", "attendance_recorded_by", "attendance_recorded_at",
            "review_deadline_at", "updated_at",
        ])
        _notify_commitment_player(
            commitment,
            title="Attendance needs your review",
            message="A host recorded that you did not attend a completed game. Dispute this report within 24 hours if it is incorrect.",
            action_required=True,
        )
    return commitment


@transaction.atomic
def dispute_commitment(*, commitment_id, player, reason):
    commitment = ParticipationCommitment.objects.select_for_update().select_related("player").filter(
        pk=commitment_id,
        player=player,
        status=ParticipationCommitment.Status.NO_SHOW_REPORTED,
    ).first()
    if not commitment:
        raise ValidationError("This attendance report cannot be disputed.")
    if commitment.review_deadline_at and commitment.review_deadline_at <= timezone.now():
        raise ValidationError("The attendance review window has closed.")
    normalized_reason = str(reason or "").strip()
    if len(normalized_reason) < 5:
        raise ValidationError("Explain briefly why this attendance report is incorrect.")
    commitment.status = ParticipationCommitment.Status.DISPUTED
    commitment.disputed_at = timezone.now()
    commitment.dispute_reason = normalized_reason[:500]
    commitment.save(update_fields=["status", "disputed_at", "dispute_reason", "updated_at"])
    _notify_commitment_reporter(
        commitment,
        title="Attendance report disputed",
        message="The player disputed the no-show report. It will not affect reliability until reviewed.",
    )
    return commitment


def finalize_pending_attendance(*, now=None, limit=100):
    """Finalize undisputed no-show reports from the maintenance worker."""
    now = now or timezone.now()
    ids = list(
        ParticipationCommitment.objects.filter(
            status=ParticipationCommitment.Status.NO_SHOW_REPORTED,
            review_deadline_at__isnull=False,
            review_deadline_at__lte=now,
        ).order_by("review_deadline_at", "id").values_list("id", flat=True)[:limit]
    )
    finalized = 0
    for commitment_id in ids:
        with transaction.atomic():
            commitment = ParticipationCommitment.objects.select_for_update().select_related("player").filter(
                pk=commitment_id,
                status=ParticipationCommitment.Status.NO_SHOW_REPORTED,
            ).first()
            if not commitment or not commitment.review_deadline_at or commitment.review_deadline_at > now:
                continue
            commitment.status = ParticipationCommitment.Status.FINALIZED_NO_SHOW
            commitment.resolved_at = now
            commitment.resolved_by = None
            commitment.save(update_fields=["status", "resolved_at", "resolved_by", "updated_at"])
            _record_commitment_outcome(commitment, outcome=commitment.status)
            _notify_commitment_player(
                commitment,
                title="Attendance report finalized",
                message="The no-show report was finalized after the review window closed and has been included in your reliability history.",
            )
            finalized += 1
    return finalized


@transaction.atomic
def resolve_commitment_dispute(*, commitment_id, actor, outcome):
    """Allow staff to resolve a disputed attendance record safely."""
    if not getattr(actor, "is_staff", False):
        raise ValidationError("Only SportSpot staff can resolve attendance disputes.")
    commitment = ParticipationCommitment.objects.select_for_update().select_related("player").filter(
        pk=commitment_id,
        status=ParticipationCommitment.Status.DISPUTED,
    ).first()
    if not commitment:
        raise ValidationError("This attendance dispute is no longer open.")
    normalized = str(outcome or "").upper()
    if normalized == "ATTENDED":
        commitment.status = ParticipationCommitment.Status.ATTENDED
    elif normalized == "NO_SHOW":
        commitment.status = ParticipationCommitment.Status.FINALIZED_NO_SHOW
    elif normalized == "EXCUSED":
        commitment.status = ParticipationCommitment.Status.EXCUSED
    else:
        raise ValidationError("Choose attended, no-show, or excused.")
    commitment.resolved_by = actor
    commitment.resolved_at = timezone.now()
    commitment.save(update_fields=["status", "resolved_by", "resolved_at", "updated_at"])
    if commitment.status in RELIABILITY_SCORE_VALUES:
        _record_commitment_outcome(commitment, outcome=commitment.status, actor=actor)
    _notify_commitment_player(
        commitment,
        title="Attendance dispute resolved",
        message="SportSpot reviewed your attendance dispute and updated the record.",
    )
    return commitment


def recompute_reliability_profile(player):
    """Derive the cached public score from the latest resolved commitments."""
    profile = PlayerProfile.objects.select_for_update().filter(user=player).first()
    if not profile:
        return None
    commitments = list(
        ParticipationCommitment.objects.filter(
            player=player,
            status__in=list(RELIABILITY_SCORE_VALUES),
        ).order_by("-resolved_at", "-id")[:RELIABILITY_HISTORY_SIZE]
    )
    if commitments:
        score = round(sum(RELIABILITY_SCORE_VALUES[item.status] for item in commitments) / len(commitments))
        profile.reliability_score = max(0, min(MAX_RELIABILITY_SCORE, score))
        profile.save(update_fields=["reliability_score", "updated_at"])
    return profile.reliability_score


def get_player_commitment_summary(player):
    """Return product-facing reliability metrics from the commitment ledger."""
    queryset = ParticipationCommitment.objects.filter(player=player)
    accountable = queryset.filter(status__in=list(RELIABILITY_SCORE_VALUES))
    attended = accountable.filter(status=ParticipationCommitment.Status.ATTENDED).count()
    late_cancelled = accountable.filter(status=ParticipationCommitment.Status.LATE_CANCELLED).count()
    finalized_no_shows = accountable.filter(status=ParticipationCommitment.Status.FINALIZED_NO_SHOW).count()
    accountable_count = attended + late_cancelled + finalized_no_shows
    pending_reviews = queryset.filter(
        status__in=[
            ParticipationCommitment.Status.NO_SHOW_REPORTED,
            ParticipationCommitment.Status.DISPUTED,
        ]
    ).count()
    return {
        "accountable_commitments": accountable_count,
        "attended": attended,
        "late_cancellations": late_cancelled,
        "finalized_no_shows": finalized_no_shows,
        "pending_reviews": pending_reviews,
        "commitments_honoured_rate": round((attended / accountable_count) * 100) if accountable_count else None,
    }


def get_pending_attendance_reviews(player):
    """Return only the player's own unresolved attendance reviews."""
    now = timezone.now()
    reviews = []
    for commitment in ParticipationCommitment.objects.filter(
        player=player,
        status__in=[
            ParticipationCommitment.Status.NO_SHOW_REPORTED,
            ParticipationCommitment.Status.DISPUTED,
        ],
    ).order_by("review_deadline_at", "-start_at", "-id"):
        metadata = commitment.metadata or {}
        if commitment.source_type == ParticipationCommitment.SourceType.MATCHMAKING_GAME:
            title = "Pickup or Fill My Squad attendance review"
            action_url = f"/dashboard/player/games/{commitment.source_id}/room"
        else:
            title = "Team Challenge attendance review"
            challenge_id = metadata.get("challenge_id")
            action_url = f"/challenge-teams/{challenge_id}/room" if challenge_id else "/dashboard/player/ratings"
        reviews.append({
            "id": commitment.id,
            "title": title,
            "source_type": commitment.source_type,
            "source_id": commitment.source_id,
            "source_participant_id": commitment.source_participant_id,
            "start_at": commitment.start_at.isoformat(),
            "status": commitment.status,
            "review_deadline_at": commitment.review_deadline_at.isoformat() if commitment.review_deadline_at else None,
            "action_url": action_url,
            "can_dispute": commitment.status == ParticipationCommitment.Status.NO_SHOW_REPORTED and (
                not commitment.review_deadline_at or commitment.review_deadline_at > now
            ),
        })
    return reviews


def _notify_commitment_player(commitment, *, title, message, action_required=False):
    from notifications.models import Notification
    from notifications.services import create_notification

    metadata = commitment.metadata or {}
    if commitment.source_type == ParticipationCommitment.SourceType.MATCHMAKING_GAME:
        action_url = f"/dashboard/player/games/{commitment.source_id}/room"
    elif metadata.get("challenge_id"):
        action_url = f"/challenge-teams/{metadata['challenge_id']}/room"
    else:
        action_url = "/dashboard/player/ratings"

    create_notification(
        recipient=commitment.player,
        actor=commitment.attendance_recorded_by,
        notification_type=Notification.NotificationType.MATCH_UPDATED,
        title=title,
        message=message,
        action_url=action_url,
        related_entity_type="participation_commitment",
        related_entity_id=commitment.id,
        action_required=action_required,
        action_status=Notification.ActionStatus.PENDING if action_required else Notification.ActionStatus.COMPLETED,
        metadata={"commitment_id": commitment.id, "source_type": commitment.source_type, "source_id": commitment.source_id},
        deduplication_key=f"commitment:{commitment.id}:{title.lower().replace(' ', '-')}",
    )


def _notify_commitment_reporter(commitment, *, title, message):
    from notifications.models import Notification
    from notifications.services import create_notification

    if not commitment.attendance_recorded_by_id:
        return
    create_notification(
        recipient=commitment.attendance_recorded_by,
        actor=commitment.player,
        notification_type=Notification.NotificationType.MATCH_UPDATED,
        title=title,
        message=message,
        action_url="",
        related_entity_type="participation_commitment",
        related_entity_id=commitment.id,
        metadata={"commitment_id": commitment.id, "source_type": commitment.source_type, "source_id": commitment.source_id},
        deduplication_key=f"commitment:{commitment.id}:disputed",
    )

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
